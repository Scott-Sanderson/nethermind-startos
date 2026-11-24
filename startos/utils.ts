import { statfs } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { sdk } from './sdk'

export const WALLET_RPC_PORT = 8545
export const ENGINE_API_PORT = 8551
export const DEFAULT_P2P_PORT = 30303

export const ENGINE_HOST_ID = 'engine-api'
export const WALLET_RPC_HOST_ID = 'wallet-rpc'
export const PEER_HOST_ID = 'execution-peers'
export const LOCAL_STORAGE_ID = '__local__'

const MiB = 1024 ** 2
const GiB = 1024 ** 3

// StartOS caps service-container RAM 1 GiB below host MemTotal, and iGPU
// carve-outs reduce it further — a 16 GB host reports ~14.6 GiB here.
export const LOW_RAM_BYTES = 12 * GiB
export const HIGH_RAM_BYTES = 24 * GiB

// Mainnet disk capacity thresholds (bytes), based on Nethermind's documented
// database sizes plus headroom for growth and state pruning.
export const ROLLING_MIN_BYTES = 750 * GiB
export const POST_MERGE_MIN_BYTES = 1300 * GiB
export const FULL_HISTORY_MIN_BYTES = 1800 * GiB

// Live free-space thresholds on the mounted /chain volume.
export const DISK_CRITICAL_FREE_BYTES = 50 * GiB
export const DISK_PRUNING_FREE_BYTES = 250 * GiB

export type SharedVolumeGrant = {
  id: string
  readonly: boolean
  availability: 'unknown' | 'available' | 'unavailable'
}

export function storageReady(
  selected: string | null | undefined,
  grants: readonly SharedVolumeGrant[],
): boolean {
  if (!selected) return false
  if (selected === LOCAL_STORAGE_ID) return true
  const grant = grants.find((volume) => volume.id === selected)
  return !!grant && !grant.readonly && grant.availability !== 'unavailable'
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isLowRam(): boolean {
  return totalmem() < LOW_RAM_BYTES
}

/**
 * Scale Nethermind's memory hint and in-memory pruning cache to the RAM
 * StartOS grants this container (host MemTotal minus StartOS's 1 GiB reserve),
 * reserving headroom for the co-resident consensus client and other services.
 */
export function computeMemoryBudget(): {
  containerRamBytes: number
  memoryHintBytes: number
  pruningCacheMb: number
} {
  const containerRamBytes = totalmem()
  const reservedBytes = containerRamBytes >= HIGH_RAM_BYTES ? 6 * GiB : 4 * GiB
  const effectiveBytes = Math.max(0, containerRamBytes - reservedBytes)
  const rawHint = Math.min(
    16 * GiB,
    Math.max(2 * GiB, Math.floor(effectiveBytes * 0.4)),
  )
  const memoryHintBytes = Math.floor(rawHint / MiB) * MiB

  const pruningCacheMb =
    containerRamBytes >= 60 * GiB
      ? 4000
      : containerRamBytes >= HIGH_RAM_BYTES
        ? 2000
        : containerRamBytes >= LOW_RAM_BYTES
          ? 1024
          : 512

  return { containerRamBytes, memoryHintBytes, pruningCacheMb }
}

export async function localDiskUsage(): Promise<{
  total: number
  available: number
} | null> {
  try {
    const stats = await statfs(sdk.volumes.chain.subpath(''))
    return {
      total: stats.blocks * stats.bsize,
      available: stats.bavail * stats.bsize,
    }
  } catch {
    return null
  }
}

export function parseDfBytes(
  stdout: string,
): { total: number; available: number } | null {
  const lines = stdout.trim().split('\n')
  if (lines.length < 2) return null
  const fields = lines[lines.length - 1].trim().split(/\s+/)
  if (fields.length < 4) return null
  const total = Number(fields[1])
  const available = Number(fields[3])
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0)
    return null
  return { total, available }
}

export function formatStorageSize(bytes: number): string {
  const TiB = 1024 ** 4
  if (bytes >= TiB) return `${(bytes / TiB).toFixed(2)} TiB`
  return `${(bytes / GiB).toFixed(1)} GiB`
}

const ANSI_RE = /\x1b\[[0-9;]*m/g
const SNAP_PROGRESS_RE = /\|\s*Snap\s+([^:]+?):\s*\(\s*([\d.]+)\s*%\s*\)/i
const PHASE_PROGRESS_RE =
  /\|\s*(Old Headers|Old Bodies|Old Receipts|Beacon Headers)\s+[\d,]+\s*\/\s*[\d,]+\s*\(\s*([\d.]+)\s*%\s*\)/i

export function parseSyncProgressLine(
  rawLine: string,
): { key: string; label: string; percent: number } | null {
  const line = rawLine.replace(ANSI_RE, '')
  const snap = SNAP_PROGRESS_RE.exec(line)
  if (snap) {
    const pct = Number(snap[2])
    if (!Number.isFinite(pct)) return null
    const detail = snap[1].trim().replace(/\s+/g, ' ')
    return {
      key: 'snap',
      label: `Snap (${detail})`,
      percent: Math.min(100, Math.max(0, pct)),
    }
  }
  const phase = PHASE_PROGRESS_RE.exec(line)
  if (phase) {
    const pct = Number(phase[2])
    if (!Number.isFinite(pct)) return null
    const name = phase[1].trim()
    return {
      key: name.toLowerCase(),
      label: name,
      percent: Math.min(100, Math.max(0, pct)),
    }
  }
  return null
}

/**
 * Tracks live Nethermind sync progress lines (Snap, Old Headers, Old Bodies,
 * Old Receipts, Beacon Headers) from stdout so the health check can report
 * real percentages even while `eth_syncing` reports `currentBlock: 0x0`.
 */
export class SyncProgressTracker {
  private readonly phases = new Map<
    string,
    { label: string; percent: number; updatedAt: number }
  >()
  private partial = ''

  feed(chunk: Buffer | string): void {
    const text = this.partial + chunk.toString()
    const lines = text.split(/\r?\n/)
    this.partial = lines.pop() ?? ''
    const now = Date.now()
    for (const line of lines) {
      const parsed = parseSyncProgressLine(line)
      if (parsed) {
        this.phases.set(parsed.key, {
          label: parsed.label,
          percent: parsed.percent,
          updatedAt: now,
        })
      }
    }
  }

  clear(): void {
    this.phases.clear()
  }

  summary(maxAgeMs = 90_000): string | null {
    const now = Date.now()
    const active: { key: string; label: string; percent: number }[] = []
    for (const [key, entry] of this.phases) {
      if (now - entry.updatedAt <= maxAgeMs) {
        active.push({ key, label: entry.label, percent: entry.percent })
      } else {
        this.phases.delete(key)
      }
    }
    if (active.length === 0) return null
    // Show Snap first when running concurrently with Old Headers.
    active.sort((a, b) =>
      a.key === 'snap' ? -1 : b.key === 'snap' ? 1 : a.key.localeCompare(b.key),
    )
    return active.map((p) => `${p.label}: ${p.percent.toFixed(1)}%`).join(' | ')
  }
}
