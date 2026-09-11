export const MEDIA_FOLDERS = [
  'Home',
  'Music',
  'Shows',
  'News',
  'Studio',
  'Events',
  'About',
  'General',
] as const

export type MediaFolder = (typeof MEDIA_FOLDERS)[number]

const ALLOWED = new Set<string>(MEDIA_FOLDERS)

export function sanitizeMediaFolder(value: unknown, fallback: MediaFolder = 'General'): MediaFolder {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed || !ALLOWED.has(trimmed)) return fallback
  return trimmed as MediaFolder
}
