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

export function formatDuration(ms: number): string {
  const totalMins = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

const ANSI_RE = /\x1b\[[0-9;]*m/g
const SNAP_PROGRESS_RE = /\|\s*Snap\s+([^:]+?):\s*\(\s*([\d.]+)\s*%\s*\)/i
const PHASE_PROGRESS_RE =
  /\|\s*(Old Headers|Old Bodies|Old Receipts|Beacon Headers)\s+([\d,]+)\s*\/\s*([\d,]+)\s*\(\s*([\d.]+)\s*%\s*\)/i
const CHANGING_SYNC_RE =
  /Changing sync\s+.+?\s+to\s+(.+?)\s+at pivot:\s*(\d+)\s*\|\s*header:\s*(\d+)\s*\|\s*target:\s*(\d+)\s*\|\s*peer:\s*(\d+)\s*\|\s*state:\s*(\d+)/i
const CLEARING_DB_RE =
  /Clearing database|Flat snap sync cannot resume a previous run/i

type PhaseSample = {
  label: string
  percent: number
  currentItems?: string
  totalItems?: string
  updatedAt: number
  firstPercent: number
  firstAt: number
}

export type SyncSnapshot = {
  phases: Array<{
    key: string
    label: string
    percent: number
    currentItems?: string
    totalItems?: string
    etaMs: number | null
  }>
  clearingDbSince: number | null
  mode: string | null
  pivot: number | null
  header: number | null
  target: number | null
  state: number | null
}

/**
 * Tracks live Nethermind sync progress lines (Snap, Old Headers, Old Bodies,
 * Old Receipts, Beacon Headers, DB clearing, and pivot/header/target/state
 * transitions) from stdout so the health check can report detailed progress
 * even while `eth_syncing` reports `currentBlock: 0x0`.
 */
export class SyncProgressTracker {
  private readonly phases = new Map<string, PhaseSample>()
  private partial = ''
  private clearingDbSince: number | null = null
  private mode: string | null = null
  private pivot: number | null = null
  private header: number | null = null
  private target: number | null = null
  private state: number | null = null

  feed(chunk: Buffer | string): void {
    const text = this.partial + chunk.toString()
    const lines = text.split(/\r?\n/)
    this.partial = lines.pop() ?? ''
    const now = Date.now()
    for (const raw of lines) {
      const line = raw.replace(ANSI_RE, '')
      this.parseLine(line, now)
    }
  }

  private parseLine(line: string, now: number): void {
    if (CLEARING_DB_RE.test(line)) {
      if (this.clearingDbSince === null) this.clearingDbSince = now
      this.phases.delete('snap')
      return
    }

    const snap = SNAP_PROGRESS_RE.exec(line)
    if (snap) {
      const pct = Number(snap[2])
      if (Number.isFinite(pct)) {
        this.clearingDbSince = null
        const detail = snap[1]
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\(Phase (\d+) of (\d+)\)/i, '($1/$2)')
        this.updatePhase(
          'snap',
          `Snap ${detail}`,
          Math.min(100, Math.max(0, pct)),
          now,
        )
      }
      return
    }

    const phase = PHASE_PROGRESS_RE.exec(line)
    if (phase) {
      const pct = Number(phase[4])
      if (Number.isFinite(pct)) {
        const name = phase[1].trim()
        const key = name.toLowerCase()
        if (key === 'old bodies' || key === 'old receipts')
          this.clearingDbSince = null
        this.updatePhase(
          key,
          name,
          Math.min(100, Math.max(0, pct)),
          now,
          phase[2],
          phase[3],
        )
      }
      return
    }

    const changing = CHANGING_SYNC_RE.exec(line)
    if (changing) {
      this.mode = changing[1].trim()
      this.pivot = Number(changing[2])
      this.header = Number(changing[3])
      this.target = Number(changing[4])
      this.state = Number(changing[6])
    }
  }

  private updatePhase(
    key: string,
    label: string,
    percent: number,
    now: number,
    currentItems?: string,
    totalItems?: string,
  ): void {
    const prev = this.phases.get(key)
    const resetBaseline =
      !prev || prev.label !== label || percent < prev.percent
    this.phases.set(key, {
      label,
      percent,
      currentItems,
      totalItems,
      updatedAt: now,
      firstPercent: resetBaseline ? percent : prev.firstPercent,
      firstAt: resetBaseline ? now : prev.firstAt,
    })
  }

  clear(): void {
    this.phases.clear()
    this.clearingDbSince = null
  }

  snapshot(maxAgeMs = 120_000): SyncSnapshot {
    const now = Date.now()
    const active: SyncSnapshot['phases'] = []
    for (const [key, entry] of this.phases) {
      if (now - entry.updatedAt <= maxAgeMs) {
        const elapsedMs = now - entry.firstAt
        const deltaPct = entry.percent - entry.firstPercent
        let etaMs: number | null = null
        // Only estimate ETA once a phase has progressed smoothly for >=2 min.
        if (elapsedMs >= 120_000 && deltaPct >= 0.3 && entry.percent < 99.9) {
          const remainingPct = 100 - entry.percent
          const est = (remainingPct / deltaPct) * elapsedMs
          if (Number.isFinite(est) && est > 0 && est < 14 * 86_400_000) {
            etaMs = est
          }
        }
        active.push({
          key,
          label: entry.label,
          percent: entry.percent,
          currentItems: entry.currentItems,
          totalItems: entry.totalItems,
          etaMs,
        })
      } else {
        this.phases.delete(key)
      }
    }
    // Show Snap first, then Old Bodies/Receipts, then Old Headers.
    const order = (k: string) =>
      k === 'snap'
        ? 0
        : k === 'old bodies'
          ? 1
          : k === 'old receipts'
            ? 2
            : k === 'old headers'
              ? 3
              : 4
    active.sort((a, b) => order(a.key) - order(b.key))
    return {
      phases: active,
      clearingDbSince: this.clearingDbSince,
      mode: this.mode,
      pivot: this.pivot,
      header: this.header,
      target: this.target,
      state: this.state,
    }
  }
}

export type LogIssueKind =
  | 'oom'
  | 'storage-error'
  | 'jwt-auth'
  | 'clock-skew'
  | 'consensus-silent'
  | 'snap-restarted'
  | 'error-burst'

export type LogIssue = {
  kind: LogIssueKind
  severity: 'critical' | 'warning'
  count: number
  lastAt: number
  snippet: string
}

export type LogHealthSnapshot = {
  topIssue: LogIssue | null
  minorWarnings15m: number
}

// Known benign log weather during normal Ethereum sync/peering that should
// never alarm a non-technical user.
const BENIGN_LOG_PATTERNS: RegExp[] = [
  /Snap - storage range of account .+ came back empty \d+ times in a row/i,
  /Re-verifying the account at the current pivot instead of retrying/i,
  /Connection reset by peer|Broken pipe|The remote party closed/i,
]

const ERROR_ANSI_RE = /^\x1b\[(?:91|31)m/
const WARN_ANSI_RE = /^\x1b\[93m/
const EXPLICIT_ERROR_RE = /\|\s*(?:ERROR|FATAL)\s*\||Unhandled exception/i
const EXPLICIT_FATAL_RE = /\|\s*FATAL\s*\||Unhandled exception/i

const CRITICAL_TTL_MS = 60 * 60_000
const WARNING_TTL_MS = 15 * 60_000

/**
 * Scans Nethermind's live stdout/stderr stream in real time, filtering out
 * normal P2P/snap-sync weather and translating actionable errors/warnings
 * into plain-English health status and rate-limited StartOS notifications.
 */
export class LogMonitor {
  private partial = ''
  private readonly issues = new Map<LogIssueKind, LogIssue>()
  private readonly errorTimestamps: number[] = []
  private readonly minorWarnTimestamps: number[] = []
  private lastErrorSnippet = ''
  private waitingForkchoiceSince: number | null = null
  private lastNotifiedAt = new Map<LogIssueKind, number>()

  constructor(private readonly onNotify?: (issue: LogIssue) => void) {}

  feed(chunk: Buffer | string): void {
    const text = this.partial + chunk.toString()
    const lines = text.split(/\r?\n/)
    this.partial = lines.pop() ?? ''
    const now = Date.now()
    for (const raw of lines) {
      if (raw.trim().length > 0) this.inspectLine(raw, now)
    }
  }

  private inspectLine(raw: string, now: number): void {
    const isAnsiError = ERROR_ANSI_RE.test(raw)
    const isAnsiWarn = WARN_ANSI_RE.test(raw)
    const clean = raw.replace(ANSI_RE, '').trim()
    if (!clean) return

    // Clear consensus-silent immediately when ForkChoice resumes.
    if (/Received ForkChoice/i.test(clean)) {
      this.waitingForkchoiceSince = null
      this.issues.delete('consensus-silent')
      return
    }

    if (/Waiting for Forkchoice message from Consensus Layer/i.test(clean)) {
      if (this.waitingForkchoiceSince === null)
        this.waitingForkchoiceSince = now
      if (now - this.waitingForkchoiceSince >= 120_000) {
        this.recordIssue('consensus-silent', 'warning', clean, now, false)
      }
      return
    }

    if (/Flat snap sync cannot resume a previous run/i.test(clean)) {
      this.recordIssue('snap-restarted', 'warning', clean, now, false)
      return
    }

    if (BENIGN_LOG_PATTERNS.some((re) => re.test(clean))) {
      if (isAnsiWarn) this.minorWarnTimestamps.push(now)
      return
    }

    if (/OutOfMemoryException|Cannot allocate memory|\bOOM\b/i.test(clean)) {
      this.recordIssue('oom', 'critical', clean, now, true)
      return
    }

    if (
      /No space left on device|RocksDbException|Corruption:|IOException.*(?:disk|space|read|write)/i.test(
        clean,
      )
    ) {
      this.recordIssue('storage-error', 'critical', clean, now, true)
      return
    }

    if (
      /JWT.*(?:invalid|failed|mismatch|expired|error)|Authentication.*JWT|Engine.*401|Unauthorized.*Engine/i.test(
        clean,
      )
    ) {
      this.recordIssue('jwt-auth', 'critical', clean, now, true)
      return
    }

    if (/clock.*skew|system time|timestamp.*in the future/i.test(clean)) {
      this.recordIssue('clock-skew', 'critical', clean, now, true)
      return
    }

    const isError = isAnsiError || EXPLICIT_ERROR_RE.test(clean)
    const isFatal = EXPLICIT_FATAL_RE.test(clean)
    if (isError) {
      this.errorTimestamps.push(now)
      this.pruneOld(this.errorTimestamps, now, WARNING_TTL_MS)
      this.lastErrorSnippet = this.trimSnippet(clean)
      if (isFatal || this.errorTimestamps.length >= 3) {
        this.recordIssue(
          'error-burst',
          'critical',
          this.lastErrorSnippet,
          now,
          isFatal,
          this.errorTimestamps.length,
        )
      }
      return
    }

    if (isAnsiWarn) {
      this.minorWarnTimestamps.push(now)
    }
  }

  private trimSnippet(line: string): string {
    // Strip leading "24 Nov 14:36:52 | " timestamp prefix for readability.
    const stripped = line.replace(
      /^\d{1,2}\s+[A-Za-z]{3}\s+\d{2}:\d{2}:\d{2}\s*\|\s*/,
      '',
    )
    return stripped.length > 100 ? `${stripped.slice(0, 97)}...` : stripped
  }

  private recordIssue(
    kind: LogIssueKind,
    severity: 'critical' | 'warning',
    rawLine: string,
    now: number,
    shouldNotify: boolean,
    explicitCount?: number,
  ): void {
    const prev = this.issues.get(kind)
    const issue: LogIssue = {
      kind,
      severity,
      count: explicitCount ?? (prev ? prev.count + 1 : 1),
      lastAt: now,
      snippet: this.trimSnippet(rawLine),
    }
    this.issues.set(kind, issue)
    if (shouldNotify && this.onNotify) {
      const lastNotified = this.lastNotifiedAt.get(kind) ?? 0
      // Rate-limit StartOS notifications to at most once every 6 hours per category.
      if (now - lastNotified >= 6 * 60 * 60_000) {
        this.lastNotifiedAt.set(kind, now)
        this.onNotify(issue)
      }
    }
  }

  private pruneOld(list: number[], now: number, ttlMs: number): void {
    while (list.length > 0 && now - list[0] > ttlMs) list.shift()
  }

  snapshot(): LogHealthSnapshot {
    const now = Date.now()
    this.pruneOld(this.errorTimestamps, now, WARNING_TTL_MS)
    this.pruneOld(this.minorWarnTimestamps, now, WARNING_TTL_MS)

    let topIssue: LogIssue | null = null
    for (const [kind, issue] of this.issues) {
      const ttl =
        issue.severity === 'critical' ? CRITICAL_TTL_MS : WARNING_TTL_MS
      if (now - issue.lastAt > ttl) {
        this.issues.delete(kind)
        continue
      }
      if (
        !topIssue ||
        (issue.severity === 'critical' && topIssue.severity !== 'critical') ||
        (issue.severity === topIssue.severity && issue.lastAt > topIssue.lastAt)
      ) {
        topIssue = issue
      }
    }

    return {
      topIssue,
      minorWarnings15m: this.minorWarnTimestamps.length,
    }
  }
}
