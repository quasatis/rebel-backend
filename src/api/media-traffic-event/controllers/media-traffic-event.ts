import { factories } from '@strapi/strapi'

const EVENT_TYPES = new Set([
  'content_view',
  'embed_impression',
  'play',
  'watch_progress',
  'outbound_click',
])

const PROVIDERS = new Set(['youtube', 'vimeo', 'spotify'])

const BOT_UA =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|preview/i

function asString(value: unknown, max = 240): string | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  return text.slice(0, max)
}

function asInt(value: unknown, min: number, max: number): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function isBot(ctx: { request: { header: Record<string, unknown> } }): boolean {
  const ua = String(ctx.request.header['user-agent'] || '')
  return !ua || BOT_UA.test(ua)
}

export default factories.createCoreController(
  'api::media-traffic-event.media-traffic-event',
  ({ strapi }) => ({
    async create(ctx) {
      if (isBot(ctx)) {
        return ctx.send({ data: { ok: true, ignored: true } })
      }

      const body = (ctx.request.body || {}) as { data?: Record<string, unknown> }
      const data = body.data || {}

      const eventType = asString(data.eventType, 40)
      const provider = asString(data.provider, 40)
      const externalId = asString(data.externalId, 120)

      if (!eventType || !EVENT_TYPES.has(eventType)) {
        return ctx.badRequest('Invalid eventType.')
      }
      if (!provider || !PROVIDERS.has(provider)) {
        return ctx.badRequest('Invalid provider.')
      }
      if (!externalId) {
        return ctx.badRequest('externalId is required.')
      }

      let channelId = asString(data.channelId, 120)
      let channelTitle = asString(data.channelTitle, 200)
      const mediaSourceDocumentId = asString(data.mediaSourceDocumentId, 64)

      if (mediaSourceDocumentId && (!channelId || !channelTitle)) {
        const media = await strapi.db.query('api::media-source.media-source').findOne({
          where: { documentId: mediaSourceDocumentId },
          select: ['rawMeta', 'title'],
        })
        const raw = (media?.rawMeta || {}) as Record<string, unknown>
        if (!channelId) channelId = asString(raw.channelId, 120)
        if (!channelTitle) {
          channelTitle =
            asString(raw.channelTitle, 200) || asString(media?.title, 200) || channelTitle
        }
      }

      const occurredAtRaw = asString(data.occurredAt, 40)
      const occurredAt = occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw))
        ? new Date(occurredAtRaw).toISOString()
        : new Date().toISOString()

      const created = await strapi
        .documents('api::media-traffic-event.media-traffic-event')
        .create({
          data: {
            eventType,
            provider,
            externalId,
            mediaSourceDocumentId,
            channelId,
            channelTitle,
            contentType: asString(data.contentType, 80),
            contentDocumentId: asString(data.contentDocumentId, 64),
            contentSlug: asString(data.contentSlug, 160),
            pagePath: asString(data.pagePath, 400),
            watchedSeconds: asInt(data.watchedSeconds, 0, 86_400),
            progressPercent: asInt(data.progressPercent, 0, 100),
            sessionId: asString(data.sessionId, 80),
            occurredAt,
            meta:
              data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
                ? data.meta
                : null,
          },
        })

      // Do not leak stored event details to anonymous clients.
      return ctx.send({ data: { ok: true, documentId: created.documentId } })
    },
  }),
)
