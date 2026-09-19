import { errors } from '@strapi/utils'
import { setDocumentPublishedAt } from '../../../utils/publish-date'
import {
  PREVIEW_COLLECTIONS,
  signPreviewToken,
  verifyPreviewToken,
} from '../../../utils/preview-token'

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

/** Populate shape close to FO `populate: '*'` for article draft preview. */
const ARTICLE_PREVIEW_POPULATE = {
  featuredImage: true,
  socialImage: true,
  gallery: true,
  author: true,
  category: true,
  tags: true,
  relatedArticles: {
    populate: ['featuredImage', 'category', 'author'],
  },
}

function previewPopulate(collection: string) {
  if (collection === 'articles') return ARTICLE_PREVIEW_POPULATE
  return '*'
}

/**
 * Keep only related articles that already have a live published version so
 * draft preview does not leak other unpublished stories.
 */
async function filterPublishedRelated(
  strapi: any,
  uid: string,
  related: unknown,
): Promise<unknown[]> {
  if (!Array.isArray(related) || !related.length) return []

  const kept: unknown[] = []
  for (const item of related) {
    const documentId =
      item && typeof item === 'object' && 'documentId' in item
        ? String((item as { documentId?: string }).documentId || '')
        : ''
    if (!documentId) continue
    try {
      const live = await strapi.documents(uid).findOne({
        documentId,
        status: 'published',
        fields: ['documentId'],
      })
      if (live) kept.push(item)
    } catch {
      // skip
    }
  }
  return kept
}

export default ({ strapi }: { strapi: any }) => ({
  async publish(ctx: any) {
    const { collection, documentId } = ctx.params || {}
    if (!ctx.state?.user) {
      return ctx.unauthorized('Authentication required')
    }

    const uid = resolveDraftPublishUid(strapi, collection, documentId)
    const published = await strapi.documents(uid).publish({ documentId: String(documentId) })
    const entry = Array.isArray(published) ? published[0] : published
    ctx.body = {
      data: {
        documentId: String(documentId),
        publishedAt: entry?.publishedAt || new Date().toISOString(),
      },
    }
  },

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

  /**
   * Mint a short-lived signed preview token for the draft version.
   * Requires an authenticated Admin/Editor (users-permissions).
   */
  async previewToken(ctx: any) {
    const { collection, documentId } = ctx.params || {}
    if (!ctx.state?.user) {
      return ctx.unauthorized('Authentication required')
    }

    const plural = String(collection || '').trim()
    if (!PREVIEW_COLLECTIONS[plural]) {
      throw new errors.ValidationError(`Preview is not enabled for “${plural}”.`)
    }

    const uid = resolveDraftPublishUid(strapi, plural, documentId)
    const draft = await strapi.documents(uid).findOne({
      documentId: String(documentId),
      status: 'draft',
      fields: ['documentId', 'slug', 'title'],
    })

    if (!draft) {
      throw new errors.NotFoundError('Draft not found.')
    }

    const slug = String(draft.slug || '').trim()
    if (!slug) {
      throw new errors.ValidationError('Save a slug before previewing.')
    }

    try {
      const minted = signPreviewToken({
        collection: plural,
        documentId: String(documentId),
        slug,
      })
      ctx.body = { data: minted }
    } catch (err) {
      throw new errors.ApplicationError(
        err instanceof Error ? err.message : 'Could not mint preview token.',
      )
    }
  },

  /**
   * Public, token-gated draft fetch. Does not grant general status=draft access.
   */
  async preview(ctx: any) {
    const plural = String(ctx.params?.collection || '').trim()
    if (!PREVIEW_COLLECTIONS[plural]) {
      throw new errors.ValidationError(`Preview is not enabled for “${plural}”.`)
    }

    const token = String(ctx.query?.token || '').trim()
    const slugQuery = String(ctx.query?.slug || '').trim()
    if (!token) {
      throw new errors.ValidationError('Preview token is required.')
    }

    let claims
    try {
      claims = verifyPreviewToken(token)
    } catch (err) {
      throw new errors.UnauthorizedError(
        err instanceof Error ? err.message : 'Invalid preview token.',
      )
    }

    if (claims.collection !== plural) {
      throw new errors.UnauthorizedError('Preview token does not match this collection.')
    }
    if (slugQuery && slugQuery !== claims.slug) {
      throw new errors.UnauthorizedError('Preview token does not match this slug.')
    }

    const uid = uidFromCollection(strapi, plural)
    if (!uid) {
      throw new errors.NotFoundError(`Unknown collection “${plural}”.`)
    }

    const draft = await strapi.documents(uid).findOne({
      documentId: claims.documentId,
      status: 'draft',
      populate: previewPopulate(plural),
    })

    if (!draft) {
      throw new errors.NotFoundError('Draft not found.')
    }

    const draftSlug = String(draft.slug || '').trim()
    if (draftSlug !== claims.slug) {
      throw new errors.UnauthorizedError('Preview token does not match the current draft slug.')
    }

    if (plural === 'articles' && Array.isArray(draft.relatedArticles)) {
      draft.relatedArticles = await filterPublishedRelated(strapi, uid, draft.relatedArticles)
    }

    ctx.body = { data: draft }
  },
})
