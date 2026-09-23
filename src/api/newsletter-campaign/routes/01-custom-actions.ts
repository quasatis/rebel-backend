/**
 * Custom campaign send/schedule routes.
 * Loaded before the core router (filename sorts first).
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/newsletter-campaigns/:documentId/send',
      handler: 'newsletter-campaign.send',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/newsletter-campaigns/:documentId/schedule',
      handler: 'newsletter-campaign.schedule',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/newsletter-campaigns/:documentId/cancel-schedule',
      handler: 'newsletter-campaign.cancelSchedule',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/newsletter-campaigns/:documentId/test-send',
      handler: 'newsletter-campaign.testSend',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
