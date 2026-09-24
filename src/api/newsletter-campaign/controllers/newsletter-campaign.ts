import { factories } from '@strapi/strapi'

export default factories.createCoreController(
  'api::newsletter-campaign.newsletter-campaign',
  ({ strapi }) => ({
    async send(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      const audit = strapi.service('api::audit-log.audit-log')
      audit.skipLifecycleForRequest(ctx)
      try {
        const result = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .sendCampaign(documentId)
        await audit.writeLog({
          action: 'newsletter_send',
          resourceType: 'newsletter-campaign',
          resourceId: documentId,
          resourceLabel:
            (result as { campaign?: { subject?: string } } | null)?.campaign?.subject ||
            documentId,
          meta: {
            recipientCount: (result as { recipientCount?: number } | null)?.recipientCount,
            status: (result as { status?: string } | null)?.status,
          },
          ctx,
        })
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
      const audit = strapi.service('api::audit-log.audit-log')
      audit.skipLifecycleForRequest(ctx)
      try {
        const updated = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .scheduleCampaign(documentId, scheduledSendAt)
        await audit.writeLog({
          action: 'newsletter_schedule',
          resourceType: 'newsletter-campaign',
          resourceId: documentId,
          resourceLabel: (updated as { subject?: string } | null)?.subject || documentId,
          meta: { scheduledSendAt },
          ctx,
        })
        ctx.body = { data: updated }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Schedule failed.'
        return ctx.badRequest(message)
      }
    },

    async cancelSchedule(ctx) {
      const documentId = String(ctx.params.documentId || '')
      if (!documentId) return ctx.badRequest('documentId is required.')
      const audit = strapi.service('api::audit-log.audit-log')
      audit.skipLifecycleForRequest(ctx)
      try {
        const updated = await strapi
          .service('api::newsletter-campaign.newsletter-campaign')
          .cancelSchedule(documentId)
        await audit.writeLog({
          action: 'newsletter_cancel',
          resourceType: 'newsletter-campaign',
          resourceId: documentId,
          resourceLabel: (updated as { subject?: string } | null)?.subject || documentId,
          ctx,
        })
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
        await strapi.service('api::audit-log.audit-log').writeLog({
          action: 'newsletter_send',
          resourceType: 'newsletter-campaign',
          resourceId: documentId,
          resourceLabel: documentId,
          meta: { test: true, to: email },
          ctx,
        })
        ctx.body = { data: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Test send failed.'
        return ctx.badRequest(message)
      }
    },
  }),
)
