/**
 * Public unsubscribe route (token-gated).
 * Loaded before the core router (filename sorts first).
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/newsletter-subscriptions/unsubscribe',
      handler: 'newsletter-subscription.unsubscribe',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
