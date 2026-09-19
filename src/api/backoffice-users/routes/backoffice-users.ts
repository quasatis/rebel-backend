/**
 * Admin-only backoffice user management (+ public invite accept).
 *
 * Auth scope uses `plugin::users-permissions.user.me` (granted to all BO roles)
 * so Strapi auth succeeds when the JWT is valid. Controllers still enforce
 * Admin via requireAdmin(). Avoids 401/403 when custom action permissions
 * have not been seeded yet after a failed bootstrap.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/backoffice-users',
      handler: 'backoffice-users.find',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'GET',
      path: '/backoffice-users/roles',
      handler: 'backoffice-users.roles',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'GET',
      path: '/backoffice-users/invite-status',
      handler: 'backoffice-users.inviteStatus',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/backoffice-users/accept-invite',
      handler: 'backoffice-users.acceptInvite',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/backoffice-users/invite',
      handler: 'backoffice-users.invite',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'GET',
      path: '/backoffice-users/:id',
      handler: 'backoffice-users.findOne',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/backoffice-users',
      handler: 'backoffice-users.create',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'PUT',
      path: '/backoffice-users/:id',
      handler: 'backoffice-users.update',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/backoffice-users/:id/reset-password',
      handler: 'backoffice-users.resetPassword',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/backoffice-users/:id/resend-invite',
      handler: 'backoffice-users.resendInvite',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
  ],
}
