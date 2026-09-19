import crypto from 'node:crypto'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ASSIGNABLE_ROLE_TYPES = new Set(['admin', 'editor', 'viewer'])
const MIN_PASSWORD_LENGTH = 10
const INVITE_TTL_MS = 72 * 60 * 60 * 1000

type RoleRow = {
  id: number
  name?: string
  type?: string
  description?: string
}

type UserRow = {
  id: number
  username?: string
  email?: string
  blocked?: boolean
  confirmed?: boolean
  provider?: string
  createdAt?: string
  updatedAt?: string
  invitePending?: boolean
  inviteExpiresAt?: string | Date | null
  inviteTokenHash?: string | null
  role?: RoleRow | number | null
}

function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isStrongPassword(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) return false
  return /[A-Za-z]/.test(password) && /\d/.test(password)
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function tokensMatch(raw: string, hash: string | null | undefined): boolean {
  if (!hash) return false
  const a = Buffer.from(hashToken(raw))
  const b = Buffer.from(String(hash))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function sanitizeUser(user: UserRow | null | undefined) {
  if (!user) return null
  const role =
    user.role && typeof user.role === 'object'
      ? {
          id: user.role.id,
          name: user.role.name,
          type: user.role.type,
          description: user.role.description,
        }
      : null

  let status: 'active' | 'blocked' | 'pending_invite' = 'active'
  if (user.invitePending) status = 'pending_invite'
  else if (user.blocked) status = 'blocked'

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    blocked: Boolean(user.blocked),
    confirmed: Boolean(user.confirmed),
    invitePending: Boolean(user.invitePending),
    inviteExpiresAt: user.inviteExpiresAt || null,
    status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role,
  }
}

function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'user'
  const cleaned = local.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40)
  return cleaned || 'user'
}

function emailConfigured(): boolean {
  return Boolean(
    String(process.env.BREVO_API_KEY || '').trim() ||
      String(process.env.SMTP_HOST || '').trim(),
  )
}

function backofficeUrl(): string {
  return String(process.env.BACKOFFICE_URL || 'http://localhost:3001').replace(/\/$/, '')
}

/** Simple in-memory rate limit (per process). */
const rateBuckets = new Map<string, number[]>()

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

export default ({ strapi }: { strapi: any }) => ({
  ASSIGNABLE_ROLE_TYPES,
  MIN_PASSWORD_LENGTH,

  async requireAdmin(ctx: any): Promise<UserRow | null> {
    const authUser = ctx.state?.user
    if (!authUser?.id) {
      ctx.unauthorized('Authentication required')
      return null
    }

    const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: authUser.id },
      populate: ['role'],
    })) as UserRow | null

    const roleType = user?.role && typeof user.role === 'object' ? user.role.type : ''
    if (!user || roleType !== 'admin') {
      ctx.forbidden('Admin access required')
      return null
    }
    return user
  },

  async listAssignableRoles() {
    const roles = (await strapi.db.query('plugin::users-permissions.role').findMany({
      where: { type: { $in: [...ASSIGNABLE_ROLE_TYPES] } },
      orderBy: { name: 'asc' },
    })) as RoleRow[]

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      type: role.type,
      description: role.description,
    }))
  },

  async resolveAssignableRole(roleIdOrType: unknown): Promise<RoleRow | null> {
    if (roleIdOrType == null || roleIdOrType === '') return null
    const raw = String(roleIdOrType).trim()
    const asId = Number(raw)
    const role = (await strapi.db.query('plugin::users-permissions.role').findOne({
      where: Number.isFinite(asId) && String(asId) === raw ? { id: asId } : { type: raw },
    })) as RoleRow | null
    if (!role || !ASSIGNABLE_ROLE_TYPES.has(String(role.type || ''))) return null
    return role
  },

  sanitizeUser,

  async findUsers(query: {
    search?: string
    page?: number
    pageSize?: number
  }) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25))
    const search = String(query.search || '').trim()

    // Ignore orphaned up_users rows left without credentials after schema repairs.
    const usable = {
      email: { $notNull: true },
      username: { $notNull: true },
    }
    const where = search
      ? {
          $and: [
            usable,
            {
              $or: [
                { email: { $containsi: search } },
                { username: { $containsi: search } },
              ],
            },
          ],
        }
      : usable

    const [results, total] = await Promise.all([
      strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        populate: ['role'],
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }) as Promise<UserRow[]>,
      strapi.db.query('plugin::users-permissions.user').count({ where }) as Promise<number>,
    ])

    return {
      data: results.map((user) => sanitizeUser(user)),
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
          total,
        },
      },
    }
  },

  async findUser(id: number) {
    const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id },
      populate: ['role'],
    })) as UserRow | null
    return sanitizeUser(user)
  },

  async getUserEntity(id: number) {
    return (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id },
      populate: ['role'],
    })) as UserRow | null
  },

  async ensureUniqueUsername(base: string, excludeId?: number) {
    let candidate = base.slice(0, 40) || 'user'
    let n = 0
    while (n < 50) {
      const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {
          username: candidate,
          ...(excludeId ? { id: { $ne: excludeId } } : {}),
        },
      })
      if (!existing) return candidate
      n += 1
      candidate = `${base.slice(0, 36)}${n}`
    }
    return `${base.slice(0, 20)}${Date.now().toString(36)}`
  },

  async countActiveAdmins(excludeUserId?: number) {
    const adminRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'admin' },
    })
    if (!adminRole) return 0
    return strapi.db.query('plugin::users-permissions.user').count({
      where: {
        role: adminRole.id,
        blocked: false,
        ...(excludeUserId ? { id: { $ne: excludeUserId } } : {}),
      },
    }) as Promise<number>
  },

  validatePassword(password: unknown): string | null {
    const value = String(password || '')
    if (!isStrongPassword(value)) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number.`
    }
    return null
  },

  validateEmail(email: unknown): string | null {
    const value = normalizeEmail(email)
    if (!value || !EMAIL_RE.test(value)) return 'Enter a valid email address.'
    return null
  },

  async emailTaken(email: string, excludeId?: number) {
    const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        email,
        ...(excludeId ? { id: { $ne: excludeId } } : {}),
      },
    })
    return Boolean(existing)
  },

  async createUser(input: {
    email: string
    username?: string
    password: string
    roleId: number
    blocked?: boolean
    invitePending?: boolean
    inviteTokenHash?: string | null
    inviteExpiresAt?: Date | null
  }) {
    const userService = strapi.plugin('users-permissions').service('user')
    const username = await this.ensureUniqueUsername(
      input.username || usernameFromEmail(input.email),
    )

    const created = await userService.add({
      username,
      email: input.email,
      password: input.password,
      provider: 'local',
      confirmed: true,
      blocked: Boolean(input.blocked),
      role: input.roleId,
    })

    // Custom invite fields via query (keeps hashed password hashing in userService.add).
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: created.id },
      data: {
        invitePending: Boolean(input.invitePending),
        inviteTokenHash: input.inviteTokenHash || null,
        inviteExpiresAt: input.inviteExpiresAt || null,
      },
    })

    return this.findUser(created.id)
  },

  async updateUser(id: number, data: Record<string, unknown>) {
    const userService = strapi.plugin('users-permissions').service('user')
    const inviteKeys = ['invitePending', 'inviteTokenHash', 'inviteExpiresAt'] as const
    const invitePatch: Record<string, unknown> = {}
    const corePatch: Record<string, unknown> = { ...data }

    for (const key of inviteKeys) {
      if (key in corePatch) {
        invitePatch[key] = corePatch[key]
        delete corePatch[key]
      }
    }

    if (Object.keys(corePatch).length) {
      await userService.edit(id, corePatch)
    }
    if (Object.keys(invitePatch).length) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id },
        data: invitePatch,
      })
    }
    return this.findUser(id)
  },

  createInviteToken() {
    const token = crypto.randomBytes(32).toString('base64url')
    return {
      token,
      hash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }
  },

  async sendInviteEmail(opts: {
    to: string
    roleName: string
    inviterEmail?: string
    token: string
    expiresAt: Date
  }) {
    if (!emailConfigured()) {
      throw new Error('Email delivery is not configured (set BREVO_API_KEY or SMTP_HOST).')
    }

    const link = `${backofficeUrl()}/accept-invite?token=${encodeURIComponent(opts.token)}`
    const expiresLabel = opts.expiresAt.toUTCString()
    const subject = 'You are invited to REBEL AFRIQUE backoffice'
    const text = [
      'You have been invited to the REBEL AFRIQUE backoffice.',
      '',
      `Role: ${opts.roleName}`,
      opts.inviterEmail ? `Invited by: ${opts.inviterEmail}` : '',
      `This link expires on ${expiresLabel}.`,
      '',
      `Accept your invite: ${link}`,
      '',
      'If you did not expect this email, you can ignore it.',
    ]
      .filter(Boolean)
      .join('\n')

    const html = `
      <p>You have been invited to the <strong>REBEL AFRIQUE</strong> backoffice.</p>
      <p><strong>Role:</strong> ${escapeHtml(opts.roleName)}</p>
      ${
        opts.inviterEmail
          ? `<p><strong>Invited by:</strong> ${escapeHtml(opts.inviterEmail)}</p>`
          : ''
      }
      <p>This link expires on <strong>${escapeHtml(expiresLabel)}</strong>.</p>
      <p><a href="${escapeHtml(link)}">Accept your invite</a></p>
      <p>If you did not expect this email, you can ignore it.</p>
    `

    await strapi.plugin('email').service('email').send({
      to: opts.to,
      subject,
      text,
      html,
    })
  },

  async findInviteByToken(token: string) {
    const hash = hashToken(token)
    return (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        invitePending: true,
        inviteTokenHash: hash,
      },
      populate: ['role'],
    })) as UserRow | null
  },

  checkRateLimit(key: string, limit = 10, windowMs = 60_000) {
    return rateLimit(key, limit, windowMs)
  },

  randomPassword() {
    return crypto.randomBytes(24).toString('base64url') + 'Aa1'
  },

  normalizeEmail,
  usernameFromEmail,
  emailConfigured,
  tokensMatch,
})
