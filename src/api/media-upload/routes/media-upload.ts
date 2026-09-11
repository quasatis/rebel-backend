/**
 * Custom upload wrapper (folder-aware). Prefer core POST /api/upload from the BO —
 * this route is kept for compatibility after image rebuilds.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/media-upload',
      handler: 'media-upload.upload',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
