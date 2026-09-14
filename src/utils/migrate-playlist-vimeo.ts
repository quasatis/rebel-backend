/**
 * Vimeo used to be stored on playlist.mediaSource (shared with YouTube auto-link).
 * Move provider=vimeo links onto playlist.vimeoSource and clear mediaSource.
 */

const PLAYLIST_UID = 'api::playlist.playlist'

export async function migratePlaylistVimeoSources(strapi: any): Promise<{
  moved: number
  published: number
}> {
  const rows = await strapi.db.query(PLAYLIST_UID).findMany({
    populate: ['mediaSource', 'vimeoSource'],
  })

  const touchedDocumentIds = new Set<string>()
  let moved = 0

  for (const row of rows || []) {
    const media = row.mediaSource
    if (!media || String(media.provider || '').toLowerCase() !== 'vimeo') continue
    if (row.vimeoSource?.id === media.id || row.vimeoSource?.documentId === media.documentId) {
      // Already on vimeoSource — still clear the shared mediaSource slot.
      if (row.mediaSource) {
        await strapi.db.query(PLAYLIST_UID).update({
          where: { id: row.id },
          data: { mediaSource: null },
        })
        moved += 1
        if (row.documentId) touchedDocumentIds.add(String(row.documentId))
      }
      continue
    }

    await strapi.db.query(PLAYLIST_UID).update({
      where: { id: row.id },
      data: {
        vimeoSource: media.id,
        mediaSource: null,
      },
    })
    moved += 1
    if (row.documentId) touchedDocumentIds.add(String(row.documentId))
  }

  let published = 0
  for (const documentId of touchedDocumentIds) {
    try {
      await strapi.documents(PLAYLIST_UID).publish({ documentId })
      published += 1
    } catch (error) {
      strapi.log?.warn?.(
        `Playlist Vimeo migrate: publish skipped for ${documentId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }
  }

  return { moved, published }
}
