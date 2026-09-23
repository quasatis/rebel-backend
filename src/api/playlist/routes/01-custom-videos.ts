/**
 * Custom public route for playlist-scoped synced YouTube videos.
 * Loaded before the core router (filename sorts first).
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/playlists/:slug/videos',
      handler: 'playlist.videos',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
