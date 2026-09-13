import { errors } from '@strapi/utils'
import { syncMediaSourceFromYoutubeSource } from '../../../../utils/youtube-media-source'

const UID = 'api::playlist.playlist'

function getStrapi() {
  // Content-type lifecycles run with the Strapi instance on globalThis.
  return (globalThis as { strapi?: any }).strapi
}

async function maxDisplayOrder() {
  const strapi = getStrapi()
  const rows = await strapi.db.query(UID).findMany({
    orderBy: { displayOrder: 'desc' },
    limit: 1,
    select: ['displayOrder'],
  })
  const max = rows?.[0]?.displayOrder
  return typeof max === 'number' && Number.isFinite(max) ? max : 0
}

/**
 * Uniqueness is per document, not per DB row. Draft + published versions of the
 * same playlist share a documentId and must not clash with each other.
 */
async function findOrderClash(
  displayOrder: number,
  excludeDocumentId?: string | null,
) {
  const strapi = getStrapi()
  const where: Record<string, unknown> = { displayOrder }
  if (excludeDocumentId) {
    where.documentId = { $ne: excludeDocumentId }
  }
  return strapi.db.query(UID).findOne({
    where,
    select: ['id', 'documentId', 'title', 'displayOrder'],
  })
}

async function resolveDocumentId(params: {
  data?: Record<string, unknown>
  where?: Record<string, unknown>
}): Promise<string | null> {
  const fromData = params.data?.documentId
  if (typeof fromData === 'string' && fromData) return fromData

  const where = params.where || {}
  if (typeof where.documentId === 'string' && where.documentId) {
    return where.documentId
  }

  const id = where.id
  if (id == null || id === '') return null

  const strapi = getStrapi()
  const row = await strapi.db.query(UID).findOne({
    where: { id },
    select: ['documentId'],
  })
  return typeof row?.documentId === 'string' ? row.documentId : null
}

function normalizeOrder(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function relationDocumentId(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value && 'documentId' in value) {
    return String((value as { documentId: string }).documentId || '') || null
  }
  if (typeof value === 'object' && value && 'id' in value) {
    return String((value as { id: string | number }).id || '') || null
  }
  return null
}

/**
 * When an editor picks a YouTube Source, also attach the matching Media Source
 * so the public site can embed it.
 */
async function linkYoutubeMediaSource(data: Record<string, unknown>) {
  if (!('youtubeSource' in data)) return
  const strapi = getStrapi()
  const youtubeDocumentId = relationDocumentId(data.youtubeSource)
  if (!youtubeDocumentId) {
    data.mediaSource = null
    return
  }

  const source =
    (await strapi.db.query('api::youtube-source.youtube-source').findOne({
      where: { documentId: youtubeDocumentId },
    })) ||
    (await strapi.db.query('api::youtube-source.youtube-source').findOne({
      where: { id: youtubeDocumentId },
    }))

  if (!source) {
    throw new errors.ValidationError('Selected YouTube source was not found.')
  }

  const media = await syncMediaSourceFromYoutubeSource(strapi, source)
  if (!media) {
    throw new errors.ValidationError(
      'That YouTube source needs a Playlist ID or Video ID before it can be linked to a playlist.',
    )
  }

  data.mediaSource = media.documentId || media.id
}

export default {
  async beforeCreate(event: {
    params: { data?: Record<string, unknown>; where?: Record<string, unknown> }
  }) {
    const data = event.params.data
    if (!data) return

    let order = normalizeOrder(data.displayOrder)
    if (order == null || order < 1) {
      order = (await maxDisplayOrder()) + 1
      data.displayOrder = order
    }

    // Publishing / locale copies create a new row for an existing documentId.
    const documentId = await resolveDocumentId(event.params)
    const clash = await findOrderClash(order, documentId)
    if (clash) {
      throw new errors.ValidationError(
        `Display order ${order} is already used by another playlist.`,
      )
    }

    await linkYoutubeMediaSource(data)
  },

  async beforeUpdate(event: {
    params: { data?: Record<string, unknown>; where?: Record<string, unknown> }
  }) {
    const data = event.params.data
    if (!data) return

    if ('displayOrder' in data) {
      const order = normalizeOrder(data.displayOrder)
      if (order == null || order < 1) {
        throw new errors.ValidationError('Display order must be a positive integer.')
      }
      data.displayOrder = order

      const documentId = await resolveDocumentId(event.params)
      const clash = await findOrderClash(order, documentId)
      if (clash) {
        throw new errors.ValidationError(
          `Display order ${order} is already used by another playlist.`,
        )
      }
    }

    await linkYoutubeMediaSource(data)
  },
}
