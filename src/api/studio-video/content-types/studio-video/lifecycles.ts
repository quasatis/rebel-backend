import { errors } from '@strapi/utils'

const UID = 'api::studio-video.studio-video'

function getStrapi() {
  return (globalThis as { strapi?: any }).strapi
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

  const row = await getStrapi().db.query(UID).findOne({
    where: { id },
    select: ['documentId'],
  })
  return typeof row?.documentId === 'string' ? row.documentId : null
}

/**
 * Draft saves can otherwise accept a slug that already belongs to another
 * document; uniqueness only fails at publish. Reject early with a clear error.
 * Same documentId (draft + published rows) is allowed to share a slug.
 */
async function assertUniqueSlug(event: {
  params: { data?: Record<string, unknown>; where?: Record<string, unknown> }
}) {
  const slug = event.params.data?.slug
  if (typeof slug !== 'string' || !slug.trim()) return

  const documentId = await resolveDocumentId(event.params)
  const where: Record<string, unknown> = { slug: slug.trim() }
  if (documentId) {
    where.documentId = { $ne: documentId }
  }

  const clash = await getStrapi().db.query(UID).findOne({
    where,
    select: ['id', 'documentId', 'title', 'slug'],
  })
  if (!clash) return

  throw new errors.ValidationError('Slug is already used by another studio video', {
    errors: [
      {
        path: ['slug'],
        message: 'Slug is already used by another studio video',
        name: 'ValidationError',
        value: slug.trim(),
      },
    ],
  })
}

export default {
  async beforeCreate(event: any) {
    await assertUniqueSlug(event)
  },
  async beforeUpdate(event: any) {
    await assertUniqueSlug(event)
  },
}
