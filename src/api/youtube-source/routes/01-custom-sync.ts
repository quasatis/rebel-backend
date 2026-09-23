/**
 * Custom routes for YouTube source sync.
 * Loaded before the core router (filename sorts first).
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/youtube-sources/sync-all',
      handler: 'youtube-source.syncAll',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/youtube-sources/:documentId/sync',
      handler: 'youtube-source.sync',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
