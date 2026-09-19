import { factories } from '@strapi/strapi'

export default factories.createCoreController(
  'api::newsletter-campaign.newsletter-campaign',
  ({ strapi }) => ({
    async send(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      try {
        const result = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .sendCampaign(documentId)
        ctx.body = { data: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Send failed.'
        strapi.log.error(`Newsletter campaign send failed: ${message}`)
        return ctx.badRequest(message)
      }
    },

    async schedule(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      const body = (ctx.request.body || {}) as { scheduledSendAt?: string; data?: { scheduledSendAt?: string } }
      const scheduledSendAt = String(
        body.scheduledSendAt || body.data?.scheduledSendAt || '',
      ).trim()
      if (!scheduledSendAt) return ctx.badRequest('scheduledSendAt is required.')
      try {
        const updated = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .scheduleCampaign(documentId, scheduledSendAt)
        ctx.body = { data: updated }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Schedule failed.'
        return ctx.badRequest(message)
      }
    },

    async cancelSchedule(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      try {
        const updated = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .cancelSchedule(documentId)
        ctx.body = { data: updated }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cancel failed.'
        return ctx.badRequest(message)
      }
    },

    async testSend(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      const body = (ctx.request.body || {}) as { email?: string; data?: { email?: string } }
      const email = String(body.email || body.data?.email || '').trim()
      try {
        const result = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .sendTest(documentId, email)
        ctx.body = { data: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Test send failed.'
        return ctx.badRequest(message)
      }
    },
  }),
)
