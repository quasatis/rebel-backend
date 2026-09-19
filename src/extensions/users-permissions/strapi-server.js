/**
 * Deep-merge invite fields onto the stock Users & Permissions user schema.
 * Do NOT use schema.json overrides here — Strapi shallow-merges them and
 * replaces the entire `attributes` object, which can drop core columns.
 */
module.exports = (plugin) => {
  const userCt = plugin.contentTypes?.user
  if (!userCt?.schema?.attributes) {
    return plugin
  }

  userCt.schema.attributes = {
    ...userCt.schema.attributes,
    firstName: {
      type: 'string',
      configurable: false,
    },
    lastName: {
      type: 'string',
      configurable: false,
    },
    inviteTokenHash: {
      type: 'string',
      private: true,
      configurable: false,
      searchable: false,
    },
    inviteExpiresAt: {
      type: 'datetime',
      private: true,
      configurable: false,
    },
    invitePending: {
      type: 'boolean',
      default: false,
      configurable: false,
    },
    totpSecretEnc: {
      type: 'text',
      private: true,
      configurable: false,
      searchable: false,
    },
    totpEnabled: {
      type: 'boolean',
      default: false,
      configurable: false,
    },
    emailMfaEnabled: {
      type: 'boolean',
      default: false,
      configurable: false,
    },
    backupCodesHash: {
      type: 'text',
      private: true,
      configurable: false,
      searchable: false,
    },
    emailOtpHash: {
      type: 'string',
      private: true,
      configurable: false,
      searchable: false,
    },
    emailOtpExpiresAt: {
      type: 'datetime',
      private: true,
      configurable: false,
    },
  }

  return plugin
}
