import { sdk } from './sdk'
import { i18n } from './i18n'
import { storeJson } from './fileModels/store.json'
import {
  DEFAULT_P2P_PORT,
  ENGINE_API_PORT,
  ENGINE_HOST_ID,
  PEER_HOST_ID,
  WALLET_RPC_HOST_ID,
  WALLET_RPC_PORT,
} from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  // Watch only executionPort so changing storage, history, or peer limits
  // does not re-run interface setup.
  const executionPort =
    (await storeJson
      .read(
        (s) => s.executionPort,
        (prev, next) => next === null || prev === next,
      )
      .const(effects)) ?? DEFAULT_P2P_PORT

  const engineHost = sdk.MultiHost.of(effects, ENGINE_HOST_ID)
  await engineHost.bindPort(ENGINE_API_PORT, {
    protocol: null,
    transport: ['tcp'],
    preferredExternalPort: ENGINE_API_PORT,
    addSsl: null,
    secure: { ssl: false },
  })

  const rpcHost = sdk.MultiHost.of(effects, WALLET_RPC_HOST_ID)
  const rpcOrigin = await rpcHost.bindPort(WALLET_RPC_PORT, {
    protocol: 'http',
    preferredExternalPort: WALLET_RPC_PORT,
  })
  const rpc = sdk.createInterface(effects, {
    id: WALLET_RPC_HOST_ID,
    name: i18n('Wallet RPC'),
    description: i18n(
      'Ethereum JSON-RPC for trusted wallets and applications.',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  const executionHost = sdk.MultiHost.of(effects, PEER_HOST_ID)
  const executionOrigin = await executionHost.bindPort(executionPort, {
    protocol: null,
    transport: ['tcp', 'udp'],
    preferredExternalPort: executionPort,
    addSsl: null,
    secure: { ssl: false },
  })
  const execution = sdk.createInterface(effects, {
    id: PEER_HOST_ID,
    name: i18n('Execution Peers'),
    description: i18n('Execution peer TCP and discovery UDP.'),
    type: 'p2p',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  return [
    await rpcOrigin.export([rpc]),
    await executionOrigin.export([execution]),
  ]
})
