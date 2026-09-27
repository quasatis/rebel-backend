/**
 * One-time: tag media-source rows created by YouTube episode sync.
 * List filtering then uses origin, not a per-request relation scan.
 */

const MEDIA_UID = 'api::media-source.media-source'
const SYNCED_UID = 'api::synced-video.synced-video'

export async function backfillMediaSourceOrigin(strapi: {
  db: { query: (uid: string) => { findMany: Function; update: Function } }
  log: { info: Function }
}): Promise<number> {
  const videos = await strapi.db.query(SYNCED_UID).findMany({
    select: ['id'],
    populate: { mediaSource: { select: ['id', 'origin'] } },
    limit: 20_000,
  })

  const seen = new Set<number>()
  let updated = 0

  for (const row of videos || []) {
    const media = (row as { mediaSource?: { id?: number; origin?: string } | null }).mediaSource
    const id = media?.id
    if (typeof id !== 'number' || seen.has(id)) continue
    seen.add(id)
    if (media.origin === 'synced-episode') continue
    await strapi.db.query(MEDIA_UID).update({
      where: { id },
      data: { origin: 'synced-episode' },
    })
    updated += 1
  }

  if (updated > 0) {
    strapi.log.info(`Tagged ${updated} media source(s) as synced-episode.`)
  }

  return updated
}
