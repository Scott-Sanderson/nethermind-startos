# Nethermind

## Documentation

- [Nethermind documentation](https://docs.nethermind.io/) — upstream configuration, pruning, sync, and operations reference
- [ETH Docker documentation](https://ethdocker.com/) — Ethereum node operations and history retention guidance

## Getting set up

1. Open **Actions → Configuration → Settings** and choose where to store the blockchain: either the StartOS data drive (shown with its free and total capacity) or a shared volume you have granted read/write access to. Mainnet rolling expiry requires at least 750 GiB (1 TB+ SSD recommended); switching storage later does not move existing data.
2. Choose your history retention policy, peer port, and maximum peer count. **Rolling expiry** is the default and keeps roughly five months of blocks and receipts. **Post-Merge** (1.3 TiB+) and **Full** (1.8 TiB+) require substantially more space, and recovering expired history later may require a fresh sync.
3. Install and start a compatible Ethereum consensus client (such as **Nimbus**). Nethermind cannot sync on its own without a consensus client driving it.
4. Start Nethermind and monitor **Execution Sync**, **Peer Network**, **Peers**, and **Disk Space**. Wait until both Nethermind and your consensus client report synced before relying on balances or sending transactions.

## Peer connections and StartTunnel

Choose an execution peer port that does not conflict with other nodes on your network. Enable **Execution Peers** on the gateway you want to use (either your local network's public IP or a StartTunnel gateway) and forward that TCP and UDP port if using your home router.

If you publish **Execution Peers** through a tunnel such as StartTunnel to keep your home IP private, send Nethermind's outbound traffic through that same tunnel as well — otherwise Ethereum peers will still see your home IP when Nethermind initiates outbound connections. If you are using a tunnel only to bypass a router that cannot forward ports, no privacy constraint requires matching them, though keeping inbound and outbound on the same gateway gives Nethermind an accurate advertised IP.

To switch between StartTunnel and your local public IP (for example, if a VPS bandwidth cap is reached):

1. Disable the old public IP on **Execution Peers** and enable the new one.
2. Switch Nethermind's outbound gateway to match the new gateway.
3. Nethermind will not restart while you make these changes. Once both match, the **Peer Network** health check will tell you if Nethermind is still advertising the previous IP — restart Nethermind once to apply the new gateway.

## Connect a wallet

After both Nethermind and your consensus client are synced, copy the private **Wallet RPC** address into your wallet's Ethereum Mainnet network settings (chain ID **1**, currency **ETH**). Your wallet signs transactions locally; never enter your recovery phrase anywhere on the server. Wallet RPC has no application password, so keep it on trusted private addresses only and do not expose it to the public internet. HTTPS clients must trust your StartOS root certificate.

## Backups

Backups save your Nethermind settings and authentication key, while excluding the reconstructible chain database. Shared volumes are backed up separately; after restoring a shared volume, re-grant read/write access and select its new identity in **Settings**.
