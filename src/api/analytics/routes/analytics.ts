export default {
  routes: [
    {
      method: 'GET',
      path: '/analytics/channel-traffic',
      handler: 'analytics.channelTraffic',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
