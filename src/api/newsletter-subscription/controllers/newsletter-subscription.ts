import { factories } from '@strapi/strapi'

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
            },
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
  }),
)
