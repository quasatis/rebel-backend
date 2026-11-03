/** True when the value looks like a YouTube playlist id (not a video id). */
export function isYouTubePlaylistId(raw: string | null | undefined): boolean {
  const id = String(raw || '').trim()
  if (!id) return false
  return /^(PL|UU|OLAK5uy_|RD|FL)/.test(id)
}
