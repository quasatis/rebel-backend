/**
 * YouTube Data API quota handling.
 * Daily quota resets at midnight America/Los_Angeles (not UTC).
 */

export const YOUTUBE_QUOTA_USER_MESSAGE =
  'YouTube daily API quota exceeded. Scheduled sync uses the public video feed until quota resets at midnight Pacific Time. Existing videos are unchanged.'

export class YoutubeQuotaExceededError extends Error {
  readonly code = 'YOUTUBE_QUOTA_EXCEEDED'

  constructor(message = YOUTUBE_QUOTA_USER_MESSAGE) {
    super(message)
    this.name = 'YoutubeQuotaExceededError'
  }
}

function pacificDateKey(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

let blockedOnPacificDate: string | null = null

export function markYoutubeQuotaExceeded() {
  blockedOnPacificDate = pacificDateKey()
}

export function clearYoutubeQuotaCircuit() {
  blockedOnPacificDate = null
}

export function isYoutubeQuotaCircuitOpen(): boolean {
  if (!blockedOnPacificDate) return false
  if (pacificDateKey() !== blockedOnPacificDate) {
    blockedOnPacificDate = null
    return false
  }
  return true
}

function messageSaysQuota(value: string): boolean {
  return (
    /quotaExceeded/i.test(value) ||
    /dailyLimitExceeded/i.test(value) ||
    /exceeded your[\s\S]*quota/i.test(value)
  )
}

export function youtubeErrorReason(body: string): string | null {
  const raw = String(body || '').trim()
  if (!raw) return null
  // Quota 403s often set status to PERMISSION_DENIED. Match the message first
  // so that status does not hide a quota failure and skip the RSS fallback.
  if (messageSaysQuota(raw)) return 'quotaExceeded'
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        errors?: Array<{ reason?: string; message?: string }>
        status?: string
        message?: string
      }
    }
    const reason = parsed.error?.errors?.[0]?.reason
    if (reason && isYoutubeQuotaReason(reason)) return String(reason)
    const message = `${parsed.error?.message || ''} ${parsed.error?.errors?.[0]?.message || ''}`
    if (messageSaysQuota(message)) return 'quotaExceeded'
    if (reason) return String(reason)
    if (parsed.error?.status) return String(parsed.error.status)
  } catch {
    // HTML or truncated JSON — the raw message check above already ran.
  }
  return null
}

export function isYoutubeQuotaReason(reason: string | null | undefined): boolean {
  const value = String(reason || '')
  return value === 'quotaExceeded' || value === 'dailyLimitExceeded'
}

export function isYoutubeQuotaExceededError(error: unknown): boolean {
  if (error instanceof YoutubeQuotaExceededError) return true
  const message = error instanceof Error ? error.message : String(error || '')
  return (
    message.includes('YOUTUBE_QUOTA_EXCEEDED') ||
    /quota exceeded/i.test(message) ||
    /exceeded your[\s\S]*quota/i.test(message) ||
    /quotaExceeded/i.test(message)
  )
}

export function isYoutubeRetryableStatus(
  status: number,
  reason: string | null,
): boolean {
  if (status >= 500) return true
  if (status === 429) return true
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
}
