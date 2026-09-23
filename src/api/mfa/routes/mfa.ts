/**
 * Backoffice MFA (email OTP + authenticator TOTP).
 * Session routes are `auth: false` so a valid JWT is not rejected by Users &
 * Permissions when `user.me` was never granted on the role. Controllers still
 * require a bearer token via `requireAuthUser`.
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
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/mfa/me',
      handler: 'mfa.me',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/setup',
      handler: 'mfa.totpSetup',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/confirm',
      handler: 'mfa.totpConfirm',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/totp/disable',
      handler: 'mfa.totpDisable',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/enable',
      handler: 'mfa.emailEnable',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/confirm',
      handler: 'mfa.emailConfirm',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/email/disable',
      handler: 'mfa.emailDisable',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/backup-codes/regenerate',
      handler: 'mfa.regenerateBackupCodes',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/mfa/disable',
      handler: 'mfa.disable',
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
  ],
}
