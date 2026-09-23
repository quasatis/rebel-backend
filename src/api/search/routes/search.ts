export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/search',
      handler: 'search.search',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
