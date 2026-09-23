import {
  BACKUP_CODE_COUNT,
  EMAIL_OTP_TTL_MS,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateEmailOtp,
  hashToken,
  normalizeBackupCode,
  parseBackupHashes,
  serializeBackupHashes,
  signMfaChallenge,
  tokensMatch,
  verifyMfaChallenge,
} from '../../../utils/mfa-crypto'

type RoleRow = {
  id: number
  name?: string
  type?: string
  description?: string
}

export type MfaUser = {
  id: number
  username?: string
  email?: string
  password?: string
  firstName?: string | null
  lastName?: string | null
  blocked?: boolean
  confirmed?: boolean
  provider?: string
  invitePending?: boolean
  totpSecretEnc?: string | null
  totpEnabled?: boolean
  emailMfaEnabled?: boolean
  backupCodesHash?: string | null
  emailOtpHash?: string | null
  emailOtpExpiresAt?: string | Date | null
  role?: RoleRow | number | null
}

const ISSUER = 'RebelAfrique'

/** Simple in-memory rate limit (per process). */
const rateBuckets = new Map<string, number[]>()
/** Single-use challenge JTIs until expiry. */
const usedChallengeJtis = new Map<string, number>()

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const prev = rateBuckets.get(key) || []
  const recent = prev.filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    rateBuckets.set(key, recent)
    return false
  }
  recent.push(now)
  rateBuckets.set(key, recent)
  return true
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function emailConfigured(): boolean {
  return Boolean(
    String(process.env.BREVO_API_KEY || '').trim() ||
      String(process.env.SMTP_HOST || '').trim(),
  )
}

function purgeUsedJtis() {
  const now = Math.floor(Date.now() / 1000)
  for (const [jti, exp] of usedChallengeJtis) {
    if (exp < now) usedChallengeJtis.delete(jti)
  }
}

export default ({ strapi }: { strapi: any }) => {
  const userService = () => strapi.plugin('users-permissions').service('user')
  const jwtService = () => strapi.plugin('users-permissions').service('jwt')

  async function loadUserById(id: number): Promise<MfaUser | null> {
    return (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id },
      populate: ['role'],
    })) as MfaUser | null
  }

  async function findByIdentifier(identifier: string): Promise<MfaUser | null> {
    const raw = String(identifier || '').trim()
    if (!raw) return null
    return (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        provider: 'local',
        $or: [{ email: raw.toLowerCase() }, { username: raw }],
      },
      populate: ['role'],
    })) as MfaUser | null
  }

  function publicUser(user: MfaUser) {
    const role =
      user.role && typeof user.role === 'object'
        ? {
            id: user.role.id,
            name: user.role.name,
            type: user.role.type,
            description: user.role.description,
          }
        : null
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      role,
    }
  }

  function enabledMethods(user: MfaUser): Array<'totp' | 'email'> {
    const methods: Array<'totp' | 'email'> = []
    if (user.totpEnabled && user.totpSecretEnc) methods.push('totp')
    if (user.emailMfaEnabled) methods.push('email')
    return methods
  }

  function mfaRequired(user: MfaUser): boolean {
    return enabledMethods(user).length > 0
  }

  function backupCodesRemaining(user: MfaUser): number {
    return parseBackupHashes(user.backupCodesHash).length
  }

  function issueJwt(user: MfaUser) {
    return {
      jwt: jwtService().issue({ id: user.id }),
      user: publicUser(user),
    }
  }

  async function updateUser(id: number, data: Record<string, unknown>) {
    return (await strapi.db.query('plugin::users-permissions.user').update({
      where: { id },
      data,
      populate: ['role'],
    })) as MfaUser
  }

  async function userIdFromRequest(ctx: any): Promise<number | null> {
    const fromState = Number(ctx.state?.user?.id)
    if (Number.isFinite(fromState) && fromState > 0) return fromState

    const header = String(ctx.request?.header?.authorization || '')
    const [scheme, token] = header.split(/\s+/)
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null
    try {
      const payload = (await jwtService().verify(token)) as { id?: number | string }
      const id = Number(payload?.id)
      return Number.isFinite(id) && id > 0 ? id : null
    } catch {
      return null
    }
  }

  async function requireAuthUser(ctx: any): Promise<MfaUser | null> {
    const userId = await userIdFromRequest(ctx)
    if (!userId) {
      ctx.unauthorized('Authentication required')
      return null
    }
    const user = await loadUserById(userId)
    if (!user || user.blocked) {
      ctx.unauthorized('Authentication required')
      return null
    }
    return user
  }

  async function validatePassword(user: MfaUser, password: string): Promise<boolean> {
    if (!user.password) return false
    return userService().validatePassword(password, user.password)
  }

  async function verifyTotpCode(user: MfaUser, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false
    const token = String(code || '')
      .replace(/\D/g, '')
      .slice(-6)
      .padStart(6, '0')
    if (!/^\d{6}$/.test(token)) return false
    try {
      const { verify } = await import('otplib')
      const secret = decryptSecret(user.totpSecretEnc)
      // ±90s covers phone/server clock skew across a couple of TOTP windows.
      const result = await verify({
        secret,
        token,
        epochTolerance: 90,
      })
      return Boolean(result?.valid)
    } catch (error) {
      strapi.log.warn(
        `TOTP verify failed for user ${user.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
      return false
    }
  }

  async function verifyEmailOtp(user: MfaUser, code: string): Promise<boolean> {
    if (!user.emailOtpHash || !user.emailOtpExpiresAt) return false
    const expires = new Date(user.emailOtpExpiresAt).getTime()
    if (!Number.isFinite(expires) || expires < Date.now()) return false
    return tokensMatch(String(code || '').trim(), user.emailOtpHash)
  }

  async function consumeBackupCode(user: MfaUser, code: string): Promise<boolean> {
    const normalized = normalizeBackupCode(code)
    if (normalized.length < 8) return false
    const hashes = parseBackupHashes(user.backupCodesHash)
    const matchIndex = hashes.findIndex((h) => tokensMatch(normalized, h))
    if (matchIndex < 0) return false
    const next = [...hashes]
    next.splice(matchIndex, 1)
    await updateUser(user.id, {
      backupCodesHash: next.length ? serializeBackupHashes(next) : null,
    })
    return true
  }

  async function ensureBackupCodes(user: MfaUser): Promise<string[] | null> {
    if (backupCodesRemaining(user) > 0) return null
    const codes = generateBackupCodes(BACKUP_CODE_COUNT)
    const hashes = codes.map((c) => hashToken(normalizeBackupCode(c)))
    await updateUser(user.id, { backupCodesHash: serializeBackupHashes(hashes) })
    return codes
  }

  async function sendOtpEmail(to: string, code: string, purpose: 'login' | 'enable') {
    if (!emailConfigured()) {
      throw new Error('Email delivery is not configured (set BREVO_API_KEY or SMTP_HOST).')
    }
    const subject =
      purpose === 'enable'
        ? 'Confirm email two-factor authentication'
        : 'Your REBEL AFRIQUE sign-in code'
    const text = [
      purpose === 'enable'
        ? 'Use this code to enable email two-factor authentication on your backoffice account.'
        : 'Use this code to finish signing in to the REBEL AFRIQUE backoffice.',
      '',
      `Code: ${code}`,
      '',
      'This code expires in 10 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\n')
    const html = `
      <p>${
        purpose === 'enable'
          ? 'Use this code to enable email two-factor authentication on your backoffice account.'
          : 'Use this code to finish signing in to the <strong>REBEL AFRIQUE</strong> backoffice.'
      }</p>
      <p style="font-size:1.5rem;letter-spacing:0.2em;font-weight:700">${escapeHtml(code)}</p>
      <p>This code expires in <strong>10 minutes</strong>.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `
    await strapi.plugin('email').service('email').send({ to, subject, text, html })
  }

  async function storeEmailOtp(userId: number, code: string) {
    await updateUser(userId, {
      emailOtpHash: hashToken(code),
      emailOtpExpiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
    })
  }

  async function clearEmailOtp(userId: number) {
    await updateUser(userId, {
      emailOtpHash: null,
      emailOtpExpiresAt: null,
    })
  }

  return {
    checkRateLimit(key: string, limit = 10, windowMs = 60_000) {
      return rateLimit(key, limit, windowMs)
    },

    emailConfigured,
    mfaRequired,
    enabledMethods,
    backupCodesRemaining,
    publicUser,
    issueJwt,
    loadUserById,
    findByIdentifier,
    requireAuthUser,
    validatePassword,
    updateUser,
    verifyTotpCode,
    verifyEmailOtp,
    consumeBackupCode,
    ensureBackupCodes,
    sendOtpEmail,
    storeEmailOtp,
    clearEmailOtp,

    async createChallenge(user: MfaUser) {
      const { token, expiresAt } = signMfaChallenge(user.id)
      return {
        mfaRequired: true as const,
        challengeToken: token,
        expiresAt,
        methods: enabledMethods(user),
        backupCodesAvailable: backupCodesRemaining(user) > 0,
      }
    },

    /** Validate challenge HMAC; throws if invalid, expired, or already used. */
    consumeChallengeToken(token: string): { userId: number; jti: string; exp: number } {
      purgeUsedJtis()
      const claims = verifyMfaChallenge(token)
      if (usedChallengeJtis.has(claims.jti)) {
        throw new Error('Invalid or expired challenge.')
      }
      return { userId: claims.userId, jti: claims.jti, exp: claims.exp }
    },

    markChallengeUsed(jti: string, exp: number) {
      usedChallengeJtis.set(jti, exp)
    },

    async setupTotp(user: MfaUser) {
      if (user.totpEnabled) {
        throw new Error('Authenticator is already enabled. Disable it first to set up again.')
      }
      const { generateSecret, generateURI } = await import('otplib')
      const QRCode = (await import('qrcode')).default
      const secret = generateSecret()
      const label = user.email || user.username || `user-${user.id}`
      const otpauthUrl = generateURI({
        issuer: ISSUER,
        label,
        secret,
      })
      await updateUser(user.id, { totpSecretEnc: encryptSecret(secret) })
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
      })
      return { secret, otpauthUrl, qrDataUrl }
    },

    async confirmTotp(user: MfaUser, code: string) {
      const fresh = await loadUserById(user.id)
      if (!fresh?.totpSecretEnc) {
        throw new Error('Start authenticator setup first.')
      }
      if (fresh.totpEnabled) {
        throw new Error('Authenticator is already enabled.')
      }
      const ok = await verifyTotpCode(fresh, code)
      if (!ok) throw new Error('Invalid authenticator code.')
      await updateUser(fresh.id, { totpEnabled: true })
      const updated = await loadUserById(fresh.id)
      const backupCodes = updated ? await ensureBackupCodes(updated) : null
      return { backupCodes }
    },

    async disableTotp(user: MfaUser) {
      const patch: Record<string, unknown> = {
        totpEnabled: false,
        totpSecretEnc: null,
      }
      const stillEmail = Boolean(user.emailMfaEnabled)
      if (!stillEmail) {
        patch.backupCodesHash = null
        patch.emailOtpHash = null
        patch.emailOtpExpiresAt = null
      }
      await updateUser(user.id, patch)
    },

    async startEmailEnable(user: MfaUser) {
      if (user.emailMfaEnabled) {
        throw new Error('Email two-factor authentication is already enabled.')
      }
      if (!user.email) throw new Error('Your account has no email address.')
      if (!emailConfigured()) {
        throw new Error('Email delivery is not configured (set BREVO_API_KEY or SMTP_HOST).')
      }
      const code = generateEmailOtp()
      await storeEmailOtp(user.id, code)
      await sendOtpEmail(user.email, code, 'enable')
    },

    async confirmEmailEnable(user: MfaUser, code: string) {
      const fresh = await loadUserById(user.id)
      if (!fresh) throw new Error('User not found.')
      if (fresh.emailMfaEnabled) {
        throw new Error('Email two-factor authentication is already enabled.')
      }
      const ok = await verifyEmailOtp(fresh, code)
      if (!ok) throw new Error('Invalid or expired code.')
      await updateUser(fresh.id, {
        emailMfaEnabled: true,
        emailOtpHash: null,
        emailOtpExpiresAt: null,
      })
      const updated = await loadUserById(fresh.id)
      const backupCodes = updated ? await ensureBackupCodes(updated) : null
      return { backupCodes }
    },

    async disableEmail(user: MfaUser) {
      const patch: Record<string, unknown> = {
        emailMfaEnabled: false,
        emailOtpHash: null,
        emailOtpExpiresAt: null,
      }
      const stillTotp = Boolean(user.totpEnabled)
      if (!stillTotp) {
        patch.backupCodesHash = null
        patch.totpSecretEnc = null
        patch.totpEnabled = false
      }
      await updateUser(user.id, patch)
    },

    async regenerateBackupCodes(user: MfaUser) {
      if (!mfaRequired(user)) {
        throw new Error('Enable a two-factor method before generating backup codes.')
      }
      const codes = generateBackupCodes(BACKUP_CODE_COUNT)
      const hashes = codes.map((c) => hashToken(normalizeBackupCode(c)))
      await updateUser(user.id, { backupCodesHash: serializeBackupHashes(hashes) })
      return codes
    },

    async disableAll(user: MfaUser) {
      await updateUser(user.id, {
        totpEnabled: false,
        totpSecretEnc: null,
        emailMfaEnabled: false,
        backupCodesHash: null,
        emailOtpHash: null,
        emailOtpExpiresAt: null,
      })
    },

    async sendChallengeEmail(user: MfaUser) {
      if (!user.emailMfaEnabled) {
        throw new Error('Email two-factor authentication is not enabled.')
      }
      if (!user.email) throw new Error('Your account has no email address.')
      const code = generateEmailOtp()
      await storeEmailOtp(user.id, code)
      await sendOtpEmail(user.email, code, 'login')
    },

    statusPayload(user: MfaUser) {
      return {
        totpEnabled: Boolean(user.totpEnabled),
        emailMfaEnabled: Boolean(user.emailMfaEnabled),
        mfaEnabled: mfaRequired(user),
        backupCodesRemaining: backupCodesRemaining(user),
        emailConfigured: emailConfigured(),
      }
    },
  }
}
