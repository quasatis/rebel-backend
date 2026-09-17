import { factories } from '@strapi/strapi'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME = 120
const MAX_MESSAGE = 5000

function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default factories.createCoreController(
  'api::contact-message.contact-message',
  ({ strapi }) => ({
    async create(ctx) {
      const body = (ctx.request.body || {}) as { data?: Record<string, unknown> }
      const data = body.data || {}

      // Honeypot — bots fill hidden "website"; humans leave it blank.
      if (String(data.website || '').trim()) {
        return this.transformResponse({ ok: true })
      }

      const name = String(data.name || '').trim()
      const email = normalizeEmail(data.email)
      const message = String(data.message || '').trim()
      const source = String(data.source || 'website').trim() || 'website'

      if (!name) return ctx.badRequest('Name is required.')
      if (name.length > MAX_NAME) return ctx.badRequest('Name is too long.')
      if (!email) return ctx.badRequest('Email is required.')
      if (!EMAIL_RE.test(email)) return ctx.badRequest('Enter a valid email address.')
      if (!message) return ctx.badRequest('Message is required.')
      if (message.length > MAX_MESSAGE) return ctx.badRequest('Message is too long.')

      const to = String(process.env.CONTACT_TO || 'team@quasatis.com').trim()
      const from = String(process.env.CONTACT_FROM || 'team@quasatis.com').trim()
      const smtpHost = String(process.env.SMTP_HOST || '').trim()

      const created = await strapi.documents('api::contact-message.contact-message').create({
        data: {
          name,
          email,
          message,
          source,
          delivered: false,
        } as never,
      })

      if (!smtpHost) {
        strapi.log.warn(
          'CONTACT_TO ready but SMTP_HOST is not set — contact message stored, email not sent.',
        )
        ctx.status = 503
        ctx.body = {
          data: null,
          error: {
            status: 503,
            name: 'ServiceUnavailableError',
            message:
              'Email delivery is not configured yet. Your message was saved; we will follow up shortly.',
            details: {},
          },
        }
        return
      }

      const subject = `REBEL AFRIQUE contact — ${name}`
      const text = [
        `Name: ${name}`,
        `Email: ${email}`,
        `Source: ${source}`,
        '',
        message,
      ].join('\n')
      const html = `
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Source:</strong> ${escapeHtml(source)}</p>
        <hr />
        <p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>
      `

      try {
        await strapi.plugin('email').service('email').send({
          to,
          from,
          replyTo: email,
          subject,
          text,
          html,
        })

        await strapi.documents('api::contact-message.contact-message').update({
          documentId: created.documentId,
          data: { delivered: true } as never,
        })
      } catch (error) {
        strapi.log.error('Contact email send failed', error)
        return ctx.internalServerError(
          'We could not send your message right now. Please try again or email team@quasatis.com.',
        )
      }

      return this.transformResponse({ ok: true, documentId: created.documentId })
    },
  }),
)
