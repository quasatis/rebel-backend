/**
 * Normalize Vimeo identifiers from bare IDs or common Vimeo URLs.
 * Supports single videos and showcases (playlists).
 */

export type EmbeddableVimeo = {
  externalId: string
  hash?: string
  kind: 'video' | 'showcase'
}

export type UnsupportedVimeo = {
  externalId: string
  kind: 'unsupported'
  unsupportedReason?: string
}

export type NormalizedVimeo = EmbeddableVimeo | UnsupportedVimeo

export function normalizeVimeoRef(raw: string | null | undefined): NormalizedVimeo | null {
  const value = String(raw || '').trim()
  if (!value) return null

  if (/^\d{6,12}$/.test(value)) {
    return { externalId: value, kind: 'video' }
  }

  if (/^\d{6,12}:[a-z0-9]+$/i.test(value)) {
    const [externalId, hash] = value.split(':')
    return { externalId, hash, kind: 'video' }
  }

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const host = url.hostname.replace(/^www\./, '')
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') {
      return null
    }

    const parts = url.pathname.split('/').filter(Boolean)
    if (!parts.length) return null

    const head = parts[0].toLowerCase()

    if (head === 'showcase' || head === 'album') {
      const id = parts[1]
      if (id && /^\d+$/.test(id)) {
        return { externalId: id, kind: 'showcase' }
      }
      return {
        externalId: id || head,
        kind: 'unsupported',
        unsupportedReason: 'Could not read a Vimeo showcase ID from that URL.',
      }
    }

    if (head === 'groups' || head === 'channels' || head === 'user') {
      return {
        externalId: parts[1] || parts[0],
        kind: 'unsupported',
        unsupportedReason: `Vimeo ${head} URLs cannot be embedded here. Use a video URL (vimeo.com/123…) or showcase URL (vimeo.com/showcase/123…).`,
      }
    }

    if (head === 'video' || head === 'videos') {
      const id = parts[1]
      const hash = parts[2]
      if (id && /^\d+$/.test(id)) {
        return hash ? { externalId: id, hash, kind: 'video' } : { externalId: id, kind: 'video' }
      }
      return null
    }

    if (host === 'player.vimeo.com' && head === 'video' && parts[1] && /^\d+$/.test(parts[1])) {
      const hash = url.searchParams.get('h') || undefined
      return { externalId: parts[1], hash, kind: 'video' }
    }

    if (/^\d+$/.test(parts[0])) {
      const hash =
        parts[1] && /^[a-z0-9]+$/i.test(parts[1]) ? parts[1] : url.searchParams.get('h') || undefined
      return hash
        ? { externalId: parts[0], hash, kind: 'video' }
        : { externalId: parts[0], kind: 'video' }
    }

    return null
  } catch {
    return null
  }
}

export function vimeoWatchUrl(parsed: EmbeddableVimeo): string {
  if (parsed.kind === 'showcase') return `https://vimeo.com/showcase/${parsed.externalId}`
  if (parsed.hash) return `https://vimeo.com/${parsed.externalId}/${parsed.hash}`
  return `https://vimeo.com/${parsed.externalId}`
}

export function vimeoProviderExternalKey(externalId: string, kind?: string | null): string {
  const id = String(externalId || '').trim()
  if (String(kind || '').toLowerCase() === 'showcase') return `vimeo:showcase:${id}`
  return `vimeo:${id}`
}
