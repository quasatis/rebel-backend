/**
 * Admin-only audit log reads. Writes go through the internal writeLog() service.
 *
 * Auth scope uses `plugin::users-permissions.user.me` so a valid JWT passes
 * Strapi auth; controllers still enforce Admin via requireAdmin().
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/audit-logs',
      handler: 'audit-log.find',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'GET',
      path: '/audit-logs/:id',
      handler: 'audit-log.findOne',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
  ],
}
