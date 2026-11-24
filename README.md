<p align="center">
  <img src="icon.png" alt="Nethermind Logo" width="21%">
</p>

# Nethermind on StartOS

> Everything not listed in this document should behave the same as upstream
> Nethermind. If a feature, setting, or behavior is not mentioned here,
> the upstream documentation is accurate and fully applicable — see the
> Documentation section of `instructions.md` for links.

Packaging of the [Nethermind](https://github.com/NethermindEth/nethermind) Ethereum Mainnet execution client for StartOS, with RAM- and disk-aware tuning, shared-volume storage support, and gateway-consistency monitoring.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

This package runs the upstream `nethermind/nethermind` OCI image directly on `x86_64` and `aarch64` with CPU emulation disabled (`emulateMissing: false`) and a 12 GiB host RAM requirement (`hardwareRequirements.ram`). One subcontainer (`nethermind`) runs a `prepare-execution` oneshot followed by the `nethermind` daemon with a 120-second `SIGTERM` shutdown timeout so RocksDB can flush cleanly.

At startup, `main.ts` scales `--Init.MemoryHint` and `--Pruning.CacheMb` from the container's available RAM (`os.totalmem()`, which excludes StartOS's 1 GiB reserve), reserving 4–6 GiB for a co-resident consensus client and other services. The computed budget is logged at every start.

## Volume and Data Layout

Three package volumes and optional StartOS shared volumes separate settings, authentication material, and reconstructible chain data.

| Volume        | Mount point        | Purpose                                                           |
| ------------- | ------------------ | ----------------------------------------------------------------- |
| `config`      | (host file model)  | Stores `store.json` settings and the generated Engine API secret. |
| `engine-auth` | `/run/engine-auth` | Holds `jwt.hex` (mode `0644`); mounted read-only by dependents.   |
| `chain`       | `/chain`           | Local StartOS data drive storage when `__local__` is selected.    |

When a granted read/write shared volume is selected in Settings, it is mounted at `/chain` in place of `chain`. Chain databases live under `/chain/nethermind`. Missing, unavailable, or read-only grants prevent daemon startup.

## File Models

One package-owned JSON file stores configuration and generated secrets.

- `config/store.json`: stores `storage`, `history`, `executionPort`, `executionPeers`, and `jwtSecret`. Any change to `store.json` restarts `main`; `setInterfaces` watches only `executionPort`.

## Dependencies

None. Nethermind requires a separate Ethereum consensus client (such as Nimbus) to drive the Engine API, but declares no hard dependency so users can pair any compatible consensus client.

## Network Access and Interfaces

Three bindings separate private wallet RPC, bridge-only Engine API traffic, and public P2P networking.

- **Wallet RPC** (`wallet-rpc`, port `8545`, `http` with StartOS TLS): serves `Eth`, `Net`, and `Web3` JSON-RPC modules with no application password.
- **Engine API** (`engine-api`, port `8551`, TCP, unexported): bound without an exported interface so it is reachable only on the StartOS bridge (`getBridgeAddress`) and authenticated via `/run/engine-auth/jwt.hex`.
- **Execution Peers** (`execution-peers`, configurable TCP+UDP port, default `30303`): P2P and discovery traffic. Changing `executionPort` in Settings retires the previous port binding via `MultiHost.retirePort()`.
- **Admin RPC** (`127.0.0.1:8546`, or `8547` if `executionPort` is `8546`): loopback-only listener used by health checks for `admin_peers` and `admin_nodeInfo`; never bound or exported.

`main.ts` intentionally does not watch `getOutboundGateway` or interface addresses with `.const()`, so toggling StartTunnel vs. local WAN addresses and switching the outbound gateway never forces intermediate restarts.

## Installation and First-Run Flow

On container init, `seed` initializes `config/store.json` defaults, generates a 32-byte hex Engine API JWT if absent, and writes `engine-auth/jwt.hex`. `watchStorage` raises a critical task until a writable storage target is selected in Settings. Compatible consensus packages (such as Nimbus) mount `engine-auth` read-only and resolve `engine-api` over the bridge automatically.

## Actions

One configuration action manages storage, history retention, and peer limits.

- `configure` (**Settings**, under **Configuration**): selects the storage target (annotating the StartOS data drive with free/total capacity and refusing local-drive selections too small for the chosen history mode), sets history retention (`rolling`, `post-merge`, `full`), configures the P2P TCP/UDP port (retiring the old binding on change), and caps `executionPeers` to 50 on devices with less than 16 GB of RAM while showing a low-RAM warning. Never returns the Engine JWT.

## Tasks

One critical task gates service startup on valid storage.

- `configure` (`critical`): raised by `watchStorage` whenever selected storage is unset, unavailable, revoked, or read-only.

## Health Checks

Five checks report Engine readiness, sync progress, peer-network/gateway alignment, peer counts, and disk space.

- `nethermind` (**Execution RPC**): daemon readiness check on TCP port `8551` (120 s grace period).
- `execution-sync` (**Execution Sync**): queries `eth_syncing` and `eth_getBlockByNumber` and parses Nethermind's live Snap / Old Headers / Old Bodies / Old Receipts progress lines from stdout so percentages update accurately during snap sync (when `eth_syncing` still reports `currentBlock: 0x0`). Shows a waiting state (`waiting: true`) while awaiting a consensus client.
- `peer-ports` (**Peer Network**): verifies external port assignment matches `executionPort`, checks inbound vs. outbound gateway consistency with `sdk.host.getAddressGateways`, and compares `admin_nodeInfo.ip` against the active gateway's public IP so the user knows when a single restart is needed after switching between StartTunnel and local WAN. Uses an event-driven trigger on `execution-peers` and `getOutboundGateway` so port and gateway edits update immediately without restarting Nethermind. Does not perform an external connectivity probe.
- `peers` (**Peers**): reports inbound and outbound peer counts from loopback `admin_peers`.
- `storage` (**Disk Space**): runs `df -PB1 /chain` every 5 minutes inside the subcontainer (covering both the StartOS data drive and shared volumes); reports `failure` below 50 GiB free and warns below 250 GiB free (Nethermind's minimum headroom for state pruning).

## Backups and Restore

Backups include `config` and `engine-auth` only; reconstructible chain data in `chain` is excluded. Shared volumes are backed up and restored separately by StartOS — after restoring a shared volume, re-grant read/write access and select its new identity in Settings.

## Limitations and Differences

Mainnet only; no validator key management, archive-state mode, bandwidth cap, or public Wallet RPC authentication is included. On StartOS, `Network.P2PPort` and `Network.DiscoveryPort` must match the external port assigned to `Execution Peers` because Nethermind advertises its listening port in ENR.

---

## Quick Reference for AI Consumers

```yaml
package_id: nethermind
image: nethermind/nethermind
architectures: [x86_64, aarch64]
subcontainers: [nethermind]
volumes:
  config: (file model)
  engine-auth: /run/engine-auth
  chain: /chain
file_models:
  - config/store.json
startos_managed_env_vars: []
dependencies: none
interfaces:
  wallet-rpc: { type: api, port: 8545 }
  execution-peers: { type: p2p, port: 30303 }
actions:
  - configure
tasks:
  - { action: configure, severity: critical }
health_checks:
  - nethermind
  - execution-sync
  - peer-ports
  - peers
  - storage
```
