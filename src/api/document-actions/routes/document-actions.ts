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
    {
      method: 'POST',
      path: '/document-actions/:collection/:documentId/publish-date',
      handler: 'document-actions.setPublishDate',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/document-actions/:collection/:documentId/preview-token',
      handler: 'document-actions.previewToken',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/document-actions/:collection/preview',
      handler: 'document-actions.preview',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
