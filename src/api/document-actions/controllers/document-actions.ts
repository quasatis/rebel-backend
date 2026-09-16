import { errors } from '@strapi/utils'
import { setDocumentPublishedAt } from '../../../utils/publish-date'

function uidFromCollection(strapi: any, collection: string): string | null {
  const plural = String(collection || '').trim()
  if (!plural) return null
  const match = Object.values(strapi.contentTypes || {}).find((ct: any) => {
    return ct?.kind === 'collectionType' && ct?.info?.pluralName === plural
  }) as { uid?: string } | undefined
  return match?.uid || null
}

/** Resolve the content-type UID and assert it supports Draft & Publish. */
function resolveDraftPublishUid(strapi: any, collection: string, documentId: unknown): string {
  if (!documentId) {
    throw new errors.ValidationError('documentId is required')
  }

  const uid = uidFromCollection(strapi, collection)
  if (!uid) {
    throw new errors.NotFoundError(`Unknown collection “${collection}”.`)
  }

  const contentType = strapi.contentTypes[uid]
  if (!contentType?.options?.draftAndPublish) {
    throw new errors.ValidationError('This content type does not support Draft & Publish.')
  }

  return uid
}

export default ({ strapi }: { strapi: any }) => ({
  async unpublish(ctx: any) {
    const { collection, documentId } = ctx.params || {}
    if (!ctx.state?.user) {
      return ctx.unauthorized('Authentication required')
    }

    const uid = resolveDraftPublishUid(strapi, collection, documentId)

    await strapi.documents(uid).unpublish({ documentId: String(documentId) })
    ctx.body = { data: { documentId: String(documentId), publishedAt: null } }
  },

  /** Set the publish date shown on the public site for the live version. */
  async setPublishDate(ctx: any) {
    const { collection, documentId } = ctx.params || {}
    if (!ctx.state?.user) {
      return ctx.unauthorized('Authentication required')
    }

    const uid = resolveDraftPublishUid(strapi, collection, documentId)

    const body = ctx.request?.body || {}
    const raw = body?.data?.publishedAt ?? body?.publishedAt
    const parsed = new Date(String(raw ?? ''))
    if (!raw || Number.isNaN(parsed.getTime())) {
      throw new errors.ValidationError('A valid publishedAt date is required.')
    }

    const publishedAt = parsed.toISOString()
    const updated = await setDocumentPublishedAt(strapi, uid, String(documentId), publishedAt)
    if (!updated) {
      throw new errors.ValidationError('Publish the document before setting a publish date.')
    }

    ctx.body = { data: { documentId: String(documentId), publishedAt } }
  },
})
