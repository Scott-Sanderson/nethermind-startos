import { sdk } from '../sdk'
import { i18n } from '../i18n'
import { storeJson } from '../fileModels/store.json'
import {
  DEFAULT_P2P_PORT,
  ENGINE_API_PORT,
  FULL_HISTORY_MIN_BYTES,
  LOCAL_STORAGE_ID,
  PEER_HOST_ID,
  POST_MERGE_MIN_BYTES,
  ROLLING_MIN_BYTES,
  WALLET_RPC_PORT,
  formatStorageSize,
  isLowRam,
  localDiskUsage,
} from '../utils'

const { InputSpec, Value } = sdk
const unset = '__choose__'

const lowRamWarning = isLowRam()
  ? i18n(
      'This device has less than 16 GB of RAM. Running Nethermind alongside a consensus client can cause out-of-memory crashes. Keep peer limits low and avoid running other heavy services at the same time.',
    )
  : null

const inputSpec = InputSpec.of({
  storage: Value.dynamicSelect(async ({ effects }) => {
    const [grants, disk] = await Promise.all([
      sdk.getSharedVolumes(effects).once(),
      localDiskUsage(),
    ])
    const writableGrants = grants.filter((v) => !v.readonly)
    const localLabel = disk
      ? i18n('StartOS data drive (${free} free / ${total})', {
          free: formatStorageSize(disk.available),
          total: formatStorageSize(disk.total),
        })
      : i18n('StartOS data drive')
    const values: Record<string, string> = {
      [unset]: i18n('Choose storage'),
      [LOCAL_STORAGE_ID]: localLabel,
    }
    for (const grant of writableGrants) values[grant.id] = grant.name
    const selected = await storeJson.read((s) => s.storage).once()
    if (selected && selected !== LOCAL_STORAGE_ID && !values[selected])
      values[selected] = i18n('Previously selected volume is unavailable')
    return {
      name: i18n('Blockchain storage'),
      description: i18n(
        'Grant read/write access to a shared volume in System Shared Volumes before selecting it. Mainnet rolling expiry needs at least 750 GiB (1 TB+ recommended). Changing storage does not move existing data.',
      ),
      warning: null,
      default: unset,
      values,
      disabled: false,
    }
  }),

  history: Value.select({
    name: i18n('Execution history'),
    description: i18n(
      'Rolling keeps approximately five months of blocks and receipts (750 GiB+ recommended). Post-Merge keeps history since the Merge (1.3 TiB+). Full retains all block history (1.8 TiB+). Switching to more history may require a fresh sync.',
    ),
    default: 'rolling',
    values: {
      rolling: i18n('Rolling expiry'),
      'post-merge': i18n('Post-Merge history'),
      full: i18n('Full block history'),
    },
  }),

  executionPort: Value.number({
    name: i18n('Execution peer port'),
    description: i18n(
      'TCP and UDP port used for execution peers. Changing this port retires the previous port binding and restarts Nethermind.',
    ),
    required: true,
    default: DEFAULT_P2P_PORT,
    min: 1025,
    max: 65535,
    integer: true,
    step: 1,
    units: null,
  }),

  executionPeers: Value.dynamicNumber(async () => {
    const lowRam = isLowRam()
    return {
      name: i18n('Maximum execution peers'),
      description: i18n(
        'Higher peer limits use more RAM and bandwidth. Capped at 50 on devices with less than 16 GB of RAM.',
      ),
      warning: null,
      placeholder: null,
      required: true,
      default: lowRam ? 25 : 50,
      min: 1,
      max: lowRam ? 50 : 200,
      integer: true,
      step: 1,
      units: null,
      disabled: false,
    }
  }),
})

export const configure = sdk.Action.withInput(
  'configure',
  async () => ({
    name: i18n('Settings'),
    description: i18n('Choose storage, history retention, and peer settings.'),
    warning: lowRamWarning,
    allowedStatuses: 'any',
    group: i18n('Configuration'),
    visibility: 'enabled',
  }),
  inputSpec,
  async () => {
    const store = await storeJson.read().once()
    if (!store) return undefined
    const maxPeers = isLowRam() ? 50 : 200
    return {
      storage: store.storage ?? unset,
      history: store.history,
      executionPort: store.executionPort,
      executionPeers: Math.min(store.executionPeers, maxPeers),
    }
  },
  async ({ effects, input }) => {
    if (input.storage === unset)
      throw new Error(i18n('Choose a storage location.'))

    if (input.storage === LOCAL_STORAGE_ID) {
      const disk = await localDiskUsage()
      if (disk) {
        if (disk.total < ROLLING_MIN_BYTES) {
          throw new Error(
            i18n(
              'The StartOS data drive (${total}) is too small for Ethereum Mainnet (at least 750 GiB required). Grant and select a larger shared volume instead.',
              { total: formatStorageSize(disk.total) },
            ),
          )
        }
        if (
          input.history === 'post-merge' &&
          disk.total < POST_MERGE_MIN_BYTES
        ) {
          throw new Error(
            i18n(
              'The StartOS data drive (${total}) is too small for Post-Merge history (at least 1.3 TiB required). Choose Rolling expiry or select a larger shared volume.',
              { total: formatStorageSize(disk.total) },
            ),
          )
        }
        if (input.history === 'full' && disk.total < FULL_HISTORY_MIN_BYTES) {
          throw new Error(
            i18n(
              'The StartOS data drive (${total}) is too small for Full block history (at least 1.8 TiB required). Choose Rolling expiry or select a larger shared volume.',
              { total: formatStorageSize(disk.total) },
            ),
          )
        }
      }
    } else {
      const grant = (await sdk.getSharedVolumes(effects).once()).find(
        (v) => v.id === input.storage,
      )
      if (!grant || grant.readonly)
        throw new Error(
          i18n('Grant read/write access to the selected volume and try again.'),
        )
    }

    if ([WALLET_RPC_PORT, ENGINE_API_PORT].includes(input.executionPort))
      throw new Error(
        i18n(
          'Peer ports must be distinct and cannot use an internal API port.',
        ),
      )

    const oldPort = await storeJson.read((s) => s.executionPort).once()

    await storeJson.merge(effects, {
      storage: input.storage,
      history: input.history,
      executionPort: input.executionPort,
      executionPeers: input.executionPeers,
    })

    if (oldPort && oldPort !== input.executionPort) {
      await sdk.MultiHost.of(effects, PEER_HOST_ID).retirePort(oldPort)
    }

    return {
      version: '1',
      title: i18n('Configuration saved'),
      message: i18n(
        'The service restarts when settings change. Confirm the advertised external port matches the peer port.',
      ),
      result: null,
    }
  },
)
