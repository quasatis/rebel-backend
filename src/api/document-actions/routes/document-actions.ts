/**
 * Document publish helpers for the backoffice (Strapi Document Service).
 * REST update with ?status=draft only edits the draft; it does not unpublish.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/document-actions/:collection/:documentId/unpublish',
      handler: 'document-actions.unpublish',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
