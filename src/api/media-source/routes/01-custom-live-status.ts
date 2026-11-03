/**
 * Public live/premiere status for a media source (YouTube-backed).
 * Loaded before the core router (filename sorts first).
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/media-sources/:documentId/live-status',
      handler: 'media-source.liveStatus',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
