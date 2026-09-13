import { errors } from '@strapi/utils'

function uidFromCollection(strapi: any, collection: string): string | null {
  const plural = String(collection || '').trim()
  if (!plural) return null
  const match = Object.values(strapi.contentTypes || {}).find((ct: any) => {
    return ct?.kind === 'collectionType' && ct?.info?.pluralName === plural
  }) as { uid?: string } | undefined
  return match?.uid || null
}

export default ({ strapi }: { strapi: any }) => ({
  async unpublish(ctx: any) {
    const { collection, documentId } = ctx.params || {}
    if (!ctx.state?.user) {
      return ctx.unauthorized('Authentication required')
    }
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

    await strapi.documents(uid).unpublish({ documentId: String(documentId) })
    ctx.body = { data: { documentId: String(documentId), publishedAt: null } }
  },
})
