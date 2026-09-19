import { factories } from '@strapi/strapi'
import { createUnsubscribeToken } from '../../../utils/unsubscribe-token'

function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    name?: string
    code?: string
    message?: string
    details?: { errors?: Array<{ message?: string }> }
  }
  const message = String(err.message || '').toLowerCase()
  if (err.name === 'ValidationError' || err.name === 'YupValidationError') {
    return (
      message.includes('unique') ||
      message.includes('already') ||
      Boolean(
        err.details?.errors?.some((item) =>
          String(item.message || '')
            .toLowerCase()
            .includes('unique'),
        ),
      )
    )
  }
  return (
    err.code === 'ER_DUP_ENTRY' ||
    message.includes('unique') ||
    message.includes('duplicate')
  )
}

export default factories.createCoreController(
  'api::newsletter-subscription.newsletter-subscription',
  ({ strapi }) => ({
    async create(ctx) {
      const body = (ctx.request.body || {}) as { data?: Record<string, unknown> }
      const email = normalizeEmail(body.data?.email)

      if (!email) {
        return ctx.badRequest('Email is required.')
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ctx.badRequest('Enter a valid email address.')
      }

      const existing = await strapi.db
        .query('api::newsletter-subscription.newsletter-subscription')
        .findOne({ where: { email } })

      if (existing) {
        // Re-subscribe: reactivate inactive rows with a fresh token.
        if (existing.active === false || existing.unsubscribedAt) {
          const documentId = String(existing.documentId || '')
          if (!documentId) {
            return ctx.badRequest('This email is already subscribed.')
          }
          const token = createUnsubscribeToken()
          const updated = await strapi
            .documents('api::newsletter-subscription.newsletter-subscription')
            .update({
              documentId,
              data: {
                active: true,
                unsubscribedAt: null,
                unsubscribeToken: token,
                source: String(body.data?.source || existing.source || 'website'),
              } as never,
            })
          const sanitized = await this.sanitizeOutput(updated, ctx)
          return this.transformResponse(sanitized)
        }
        return ctx.badRequest('This email is already subscribed.')
      }

      try {
        const created = await strapi
          .documents('api::newsletter-subscription.newsletter-subscription')
          .create({
            data: {
              email,
              source: String(body.data?.source || 'website'),
              active: body.data?.active == null ? true : Boolean(body.data.active),
              unsubscribeToken: createUnsubscribeToken(),
            } as never,
          })

        const sanitized = await this.sanitizeOutput(created, ctx)
        return this.transformResponse(sanitized)
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return ctx.badRequest('This email is already subscribed.')
        }
        throw error
      }
    },

    async unsubscribe(ctx) {
      const token = String(ctx.query.token || ctx.request.query?.token || '').trim()
      if (!token) {
        return ctx.badRequest('Unsubscribe token is required.')
      }

      const existing = await strapi.db
        .query('api::newsletter-subscription.newsletter-subscription')
        .findOne({ where: { unsubscribeToken: token } })

      if (!existing) {
        return ctx.badRequest('This unsubscribe link is invalid or has already been used.')
      }

      if (existing.active === false) {
        ctx.body = {
          data: {
            ok: true,
            alreadyUnsubscribed: true,
            email: existing.email,
          },
        }
        return
      }

      await strapi.documents('api::newsletter-subscription.newsletter-subscription').update({
        documentId: existing.documentId,
        data: {
          active: false,
          unsubscribedAt: new Date().toISOString(),
        } as never,
      })

      ctx.body = {
        data: {
          ok: true,
          alreadyUnsubscribed: false,
          email: existing.email,
        },
      }
    },
  }),
)
