/**
 * Backoffice MFA (email OTP + authenticator TOTP).
 * Authenticated routes use user.me scope (same pattern as backoffice-users).
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/mfa/login',
      handler: 'mfa.login',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/mfa/challenge/send-email',
      handler: 'mfa.sendChallengeEmail',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/mfa/challenge/verify',
      handler: 'mfa.verifyChallenge',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/mfa/status',
      handler: 'mfa.status',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/setup',
      handler: 'mfa.totpSetup',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/confirm',
      handler: 'mfa.totpConfirm',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/disable',
      handler: 'mfa.totpDisable',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/enable',
      handler: 'mfa.emailEnable',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/confirm',
      handler: 'mfa.emailConfirm',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/disable',
      handler: 'mfa.emailDisable',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/backup-codes/regenerate',
      handler: 'mfa.regenerateBackupCodes',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
    {
      method: 'POST',
      path: '/mfa/disable',
      handler: 'mfa.disable',
      config: {
        policies: [],
        middlewares: [],
        auth: { scope: ['plugin::users-permissions.user.me'] },
      },
    },
  ],
}
