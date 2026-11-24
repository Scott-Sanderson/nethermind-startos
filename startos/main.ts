import { sdk } from './sdk'
import { i18n } from './i18n'
import { storeJson } from './fileModels/store.json'
import {
  DISK_CRITICAL_FREE_BYTES,
  DISK_PRUNING_FREE_BYTES,
  ENGINE_API_PORT,
  LOCAL_STORAGE_ID,
  PEER_HOST_ID,
  WALLET_RPC_PORT,
  SyncProgressTracker,
  asObject,
  computeMemoryBudget,
  formatStorageSize,
  parseDfBytes,
  storageReady,
} from './utils'

async function rpc(
  method: string,
  params: unknown[] = [],
  port = WALLET_RPC_PORT,
): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('RPC unavailable')
  const body = (await response.json()) as { result?: unknown; error?: unknown }
  if (body.error || body.result === undefined) throw new Error('RPC error')
  return body.result
}

function parseHexInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null
  const parsed = parseInt(value.slice(2), 16)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Reactive health-check trigger for Peer Network: wakes immediately when
 * `execution-peers` bindings/addresses or the service's outbound gateway
 * change (via `.onChange()`, so it never restarts Nethermind), with a
 * fallback polling interval for `admin_nodeInfo` changes.
 */
function peerNetworkTrigger(
  effects: Parameters<typeof sdk.getOutboundGateway>[0],
) {
  return async function* (getInput: () => { lastResult?: string }) {
    let done = false
    let pending = false
    let wake: (() => void) | null = null

    const notify = () => {
      if (wake) {
        const resolve = wake
        wake = null
        resolve()
      } else {
        pending = true
      }
    }

    sdk.getOutboundGateway(effects).onChange(() => {
      if (done) return { cancel: true }
      notify()
      return { cancel: false }
    })
    sdk.host.getOwn(effects, PEER_HOST_ID).onChange(() => {
      if (done) return { cancel: true }
      notify()
      return { cancel: false }
    })

    const intervals: Record<string, number> = {
      starting: 5_000,
      loading: 5_000,
      failure: 10_000,
    }

    try {
      while (true) {
        if (pending) {
          pending = false
        } else {
          const { lastResult } = getInput()
          const ms = lastResult
            ? (intervals[lastResult] ?? 30_000)
            : intervals.starting
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wake = null
              resolve()
            }, ms)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
        }
        yield
      }
    } finally {
      done = true
    }
  }
}

export const main = sdk.setupMain(async ({ effects }) =>
  sdk.Daemons.dynamic(effects, async ({ effects }) => {
    const config = await storeJson.read().const(effects)
    const grants = await sdk.getSharedVolumes(effects).const()
    if (!config?.storage || !storageReady(config.storage, grants))
      return sdk.Daemons.of(effects)

    const { containerRamBytes, memoryHintBytes, pruningCacheMb } =
      computeMemoryBudget()
    console.info(
      `Nethermind resource budget: container RAM ${formatStorageSize(containerRamBytes)}, Init.MemoryHint ${formatStorageSize(memoryHintBytes)}, Pruning.CacheMb ${pruningCacheMb} MB`,
    )

    const adminPort = config.executionPort === 8546 ? 8547 : 8546
    const base = sdk.Mounts.of().mountVolume({
      volumeId: 'engine-auth',
      subpath: null,
      mountpoint: '/run/engine-auth',
      readonly: true,
    })
    const mounts =
      config.storage === LOCAL_STORAGE_ID
        ? base.mountVolume({
            volumeId: 'chain',
            subpath: null,
            mountpoint: '/chain',
            readonly: false,
          })
        : base.mountSharedVolume({
            id: config.storage,
            subpath: null,
            mountpoint: '/chain',
            readonly: false,
          })
    const execution = sdk.SubContainer.of(
      effects,
      { imageId: 'nethermind' },
      mounts,
      'nethermind',
    )
    const syncProgress = new SyncProgressTracker()
    const history =
      config.history === 'rolling'
        ? ['--History.Pruning=Rolling', '--History.RetentionEpochs=33024']
        : config.history === 'post-merge'
          ? [
              '--Sync.AncientBodiesBarrier=15537394',
              '--Sync.AncientReceiptsBarrier=15537394',
              '--History.Pruning=UseAncientBarriers',
            ]
          : [
              '--Sync.AncientBodiesBarrier=0',
              '--Sync.AncientReceiptsBarrier=0',
              '--History.Pruning=Disabled',
            ]

    return sdk.Daemons.of(effects)
      .addOneshot('prepare-execution', {
        subcontainer: execution,
        exec: {
          command: [
            'sh',
            '-c',
            'test ! -L /chain/nethermind && mkdir -p /chain/nethermind',
          ],
          user: 'root',
        },
        requires: [],
      })
      .addDaemon('nethermind', {
        subcontainer: execution,
        exec: {
          command: [
            '/nethermind/nethermind',
            '--config=mainnet',
            '--data-dir=/chain/nethermind',
            `--Init.MemoryHint=${memoryHintBytes}`,
            `--Pruning.CacheMb=${pruningCacheMb}`,
            `--Network.P2PPort=${config.executionPort}`,
            `--Network.DiscoveryPort=${config.executionPort}`,
            `--Network.MaxActivePeers=${config.executionPeers}`,
            '--JsonRpc.Enabled=true',
            '--JsonRpc.Host=0.0.0.0',
            `--JsonRpc.Port=${WALLET_RPC_PORT}`,
            '--JsonRpc.EnabledModules=Eth,Net,Web3',
            `--JsonRpc.AdditionalRpcUrls=http://127.0.0.1:${adminPort}|http|admin`,
            '--JsonRpc.EngineHost=0.0.0.0',
            `--JsonRpc.EnginePort=${ENGINE_API_PORT}`,
            '--JsonRpc.JwtSecretFile=/run/engine-auth/jwt.hex',
            ...history,
          ],
          onStdout: (chunk) => {
            process.stdout.write(chunk)
            syncProgress.feed(chunk)
          },
          onStderr: (chunk) => {
            process.stderr.write(chunk)
            syncProgress.feed(chunk)
          },
          // Give RocksDB time to flush memtables cleanly on stop/restart.
          sigtermTimeout: 120_000,
        },
        ready: {
          display: i18n('Execution RPC'),
          gracePeriod: 120_000,
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, ENGINE_API_PORT, {
              successMessage: i18n('Execution engine is ready'),
              errorMessage: i18n('Waiting for the execution engine'),
            }),
        },
        requires: ['prepare-execution'],
      })
      .addHealthCheck('execution-sync', {
        ready: {
          display: i18n('Execution Sync'),
          trigger: sdk.trigger.statusTrigger(30_000, {
            starting: 5_000,
            loading: 10_000,
            failure: 10_000,
          }),
          fn: async () => {
            try {
              const syncing = await rpc('eth_syncing')
              if (syncing !== false) {
                const details = asObject(syncing)
                if (!details) throw new Error('Invalid sync status')
                const current = parseHexInt(details.currentBlock)
                const highest = parseHexInt(details.highestBlock)
                if (current === 0 && highest === 0)
                  return {
                    result: 'loading',
                    waiting: true,
                    message: i18n('Execution is ready; waiting for consensus'),
                  }
                const logSummary = syncProgress.summary()
                if (logSummary) {
                  return {
                    result: 'loading',
                    message: logSummary,
                  }
                }
                if (
                  current !== null &&
                  highest !== null &&
                  current > 0 &&
                  highest > 0
                ) {
                  const pct = Math.min(100, (current / highest) * 100).toFixed(
                    1,
                  )
                  return {
                    result: 'loading',
                    message: i18n(
                      'Syncing blocks: ${current} / ${highest} (${percentage}%)',
                      {
                        current: current.toLocaleString('en-US'),
                        highest: highest.toLocaleString('en-US'),
                        percentage: pct,
                      },
                    ),
                  }
                }
                if (highest !== null && highest > 0) {
                  return {
                    result: 'loading',
                    message: i18n('Syncing state (target block ${highest})', {
                      highest: highest.toLocaleString('en-US'),
                    }),
                  }
                }
                return {
                  result: 'loading',
                  message: i18n('Execution is syncing'),
                }
              }
              const latest = asObject(
                await rpc('eth_getBlockByNumber', ['latest', false]),
              )
              const timestamp = parseHexInt(latest?.timestamp)
              if (timestamp === null) throw new Error('Invalid block')
              const age = Date.now() / 1000 - timestamp
              if (age < -60 || age > 600)
                return {
                  result: 'loading',
                  waiting: true,
                  message: i18n('Execution is ready; waiting for consensus'),
                }
              syncProgress.clear()
              return { result: 'success', message: i18n('Execution is synced') }
            } catch {
              return {
                result: 'failure',
                message: i18n('Execution RPC is unavailable'),
              }
            }
          },
        },
        requires: ['nethermind'],
      })
      .addHealthCheck('peer-ports', {
        ready: {
          display: i18n('Peer Network'),
          trigger: peerNetworkTrigger(effects),
          fn: async () => {
            const peerInfo = await sdk.host
              .getOwn(effects, PEER_HOST_ID, (host) => {
                const binding = host?.bindings[config.executionPort]
                if (!binding) return null
                const enabledPublicIps = binding.addresses.effective
                  .filter((a) => a.public && a.metadata.kind === 'ipv4')
                  .map((a) => a.hostname)
                return {
                  assignedPort: binding.net.assignedPort ?? null,
                  enabledPublicIps: [...new Set(enabledPublicIps)],
                }
              })
              .once()

            if (!peerInfo || peerInfo.assignedPort === null)
              return {
                result: 'loading',
                waiting: true,
                message: i18n('Waiting for peer port assignments'),
              }

            if (peerInfo.assignedPort !== config.executionPort)
              return {
                result: 'failure',
                message: i18n(
                  'Peer port was reassigned to ${assigned} (configured ${configured}). Set the external port on Execution Peers to match.',
                  {
                    assigned: String(peerInfo.assignedPort),
                    configured: String(config.executionPort),
                  },
                ),
              }

            if (peerInfo.enabledPublicIps.length === 0)
              return {
                result: 'success',
                message: i18n(
                  'Outbound only on port ${port}. Enable a public IP on Execution Peers for inbound peers.',
                  { port: String(config.executionPort) },
                ),
              }

            // Compare enabled inbound gateways against the service's outbound
            // gateway using .once() reads so switching between StartTunnel and
            // local WAN never forces intermediate restarts.
            const gw = await sdk.host.getAddressGateways(
              effects,
              PEER_HOST_ID,
              peerInfo.enabledPublicIps,
            )
            const matchingOutbound = gw.addresses.filter(
              (entry) => entry.gateway === gw.outbound,
            )

            if (matchingOutbound.length === 0)
              return {
                result: 'loading',
                waiting: true,
                message: i18n(
                  'Inbound Execution Peers gateway does not match Outbound Gateway. Finish switching both to the same gateway.',
                ),
              }

            try {
              const nodeInfo = asObject(
                await rpc('admin_nodeInfo', [], adminPort),
              )
              const advertisedIp =
                typeof nodeInfo?.ip === 'string' && nodeInfo.ip.length > 0
                  ? nodeInfo.ip
                  : null
              if (
                advertisedIp &&
                !matchingOutbound.some(
                  (entry) => entry.address === advertisedIp,
                )
              ) {
                return {
                  result: 'loading',
                  message: i18n(
                    'Advertising ${advertised} instead of ${expected}. Restart Nethermind to apply the new gateway.',
                    {
                      advertised: advertisedIp,
                      expected: matchingOutbound[0].address,
                    },
                  ),
                }
              }
            } catch {
              // Fall through if admin_nodeInfo is temporarily unavailable.
            }

            return {
              result: 'success',
              message: i18n('Inbound and outbound ready on ${ip}:${port}', {
                ip: matchingOutbound[0].address,
                port: String(config.executionPort),
              }),
            }
          },
        },
        requires: ['nethermind'],
      })
      .addHealthCheck('peers', {
        ready: {
          display: i18n('Peers'),
          trigger: sdk.trigger.statusTrigger(30_000, {
            starting: 5_000,
            failure: 10_000,
          }),
          fn: async () => {
            try {
              const peers = await rpc('admin_peers', [true], adminPort)
              if (!Array.isArray(peers)) throw new Error('Invalid peer list')
              let inbound = 0
              let outbound = 0
              for (const peer of peers) {
                const network = asObject(asObject(peer)?.network)
                if (typeof network?.inbound !== 'boolean')
                  throw new Error('Invalid peer direction')
                if (network.inbound) inbound++
                else outbound++
              }
              const message = i18n(
                'Inbound: ${inbound}, outbound: ${outbound}',
                {
                  inbound: String(inbound),
                  outbound: String(outbound),
                },
              )
              return inbound + outbound
                ? { result: 'success', message }
                : { result: 'loading', message }
            } catch {
              return {
                result: 'failure',
                message: i18n('Peer counts are unavailable'),
              }
            }
          },
        },
        requires: ['nethermind'],
      })
      .addHealthCheck('storage', {
        ready: {
          display: i18n('Disk Space'),
          trigger: sdk.trigger.statusTrigger(300_000, {
            starting: 10_000,
            failure: 60_000,
          }),
          fn: async () => {
            try {
              const res = await execution.exec(['df', '-PB1', '/chain'])
              if (res.exitCode !== 0 || typeof res.stdout !== 'string')
                throw new Error('df failed')
              const usage = parseDfBytes(res.stdout)
              if (!usage) throw new Error('Unable to parse df output')
              const free = formatStorageSize(usage.available)
              const total = formatStorageSize(usage.total)
              if (usage.available < DISK_CRITICAL_FREE_BYTES) {
                return {
                  result: 'failure',
                  message: i18n(
                    'Critically low disk space: ${free} free of ${total}. Free space or switch to a larger volume.',
                    { free, total },
                  ),
                }
              }
              if (usage.available < DISK_PRUNING_FREE_BYTES) {
                return {
                  result: 'success',
                  message: i18n(
                    '${free} free of ${total} (low — state pruning needs at least 250 GiB free)',
                    { free, total },
                  ),
                }
              }
              return {
                result: 'success',
                message: i18n('${free} free of ${total}', { free, total }),
              }
            } catch {
              return {
                result: 'loading',
                message: i18n('Checking disk space'),
              }
            }
          },
        },
        requires: ['nethermind'],
      })
  }),
)
