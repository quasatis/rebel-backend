/**
 * Custom routes for Show-scoped YouTube sync.
 * Loaded before the core router (filename sorts first).
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/shows/:documentId/sync',
      handler: 'show.sync',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
