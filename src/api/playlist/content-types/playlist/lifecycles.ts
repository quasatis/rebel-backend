import { errors } from '@strapi/utils'

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
  },

  async beforeUpdate(event: {
    params: { data?: Record<string, unknown>; where?: Record<string, unknown> }
  }) {
    const data = event.params.data
    if (!data || !('displayOrder' in data)) return

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
  },
}
