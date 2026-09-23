/**
 * Custom routes for REBEL of the Week helpers.
 * Filename sorts before the core router.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/rebel-of-the-weeks/resolve-track-link',
      handler: 'rebel-of-the-week.resolveTrackLink',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
