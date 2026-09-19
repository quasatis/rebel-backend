export default ({ strapi }: { strapi: any }) => {
  const service = () => strapi.service('api::backoffice-users.backoffice-users')

  return {
    async find(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      const query = ctx.query || {}
      const result = await service().findUsers({
        search: query.search || query.q,
        page: query.page || query['pagination[page]'],
        pageSize: query.pageSize || query['pagination[pageSize]'],
      })
      ctx.body = result
    },

    async findOne(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      const id = Number(ctx.params?.id)
      if (!Number.isFinite(id)) return ctx.badRequest('Invalid user id.')

      const user = await service().findUser(id)
      if (!user) return ctx.notFound('User not found.')
      ctx.body = { data: user }
    },

    async roles(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return
      ctx.body = { data: await service().listAssignableRoles() }
    },

    async create(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      const body = ctx.request?.body || {}
      const data = body.data || body
      const emailError = service().validateEmail(data.email)
      if (emailError) return ctx.badRequest(emailError)

      const passwordError = service().validatePassword(data.password)
      if (passwordError) return ctx.badRequest(passwordError)

      const role = await service().resolveAssignableRole(data.roleId ?? data.role)
      if (!role) return ctx.badRequest('Choose a valid role (Admin, Editor, or Viewer).')

      const email = service().normalizeEmail(data.email)
      if (await service().emailTaken(email)) {
        return ctx.badRequest('A user with this email already exists.')
      }

      const username = data.username
        ? String(data.username).trim()
        : service().usernameFromEmail(email)

      const created = await service().createUser({
        email,
        username,
        password: String(data.password),
        roleId: role.id,
        blocked: false,
        invitePending: false,
      })

      ctx.body = { data: created }
    },

    async update(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      const id = Number(ctx.params?.id)
      if (!Number.isFinite(id)) return ctx.badRequest('Invalid user id.')

      const existing = await service().getUserEntity(id)
      if (!existing) return ctx.notFound('User not found.')

      const body = ctx.request?.body || {}
      const data = body.data || body
      const patch: Record<string, unknown> = {}

      if (data.email != null) {
        const emailError = service().validateEmail(data.email)
        if (emailError) return ctx.badRequest(emailError)
        const email = service().normalizeEmail(data.email)
        if (await service().emailTaken(email, id)) {
          return ctx.badRequest('A user with this email already exists.')
        }
        patch.email = email
      }

      if (data.username != null) {
        const username = String(data.username).trim()
        if (!username) return ctx.badRequest('Username is required.')
        patch.username = await service().ensureUniqueUsername(username, id)
      }

      let nextRole = existing.role && typeof existing.role === 'object' ? existing.role : null
      if (data.roleId != null || data.role != null) {
        const role = await service().resolveAssignableRole(data.roleId ?? data.role)
        if (!role) return ctx.badRequest('Choose a valid role (Admin, Editor, or Viewer).')
        nextRole = role
        patch.role = role.id
      }

      if (data.blocked != null) {
        patch.blocked = Boolean(data.blocked)
      }

      const self = admin.id === id
      const wasAdmin =
        existing.role && typeof existing.role === 'object' && existing.role.type === 'admin'
      const willBeAdmin = nextRole?.type === 'admin'
      const willBlock = patch.blocked === true || (patch.blocked == null && existing.blocked)
      const demoting = wasAdmin && !willBeAdmin

      if (self && demoting) {
        return ctx.badRequest('You cannot demote your own Admin role.')
      }
      if (self && willBlock) {
        return ctx.badRequest('You cannot deactivate your own account.')
      }

      if (wasAdmin && (demoting || willBlock) && !existing.invitePending) {
        const remaining = await service().countActiveAdmins(id)
        if (remaining < 1) {
          return ctx.badRequest('Cannot remove or deactivate the last active Admin.')
        }
      }

      if (Object.keys(patch).length === 0) {
        ctx.body = { data: await service().findUser(id) }
        return
      }

      const updated = await service().updateUser(id, patch)
      ctx.body = { data: updated }
    },

    async resetPassword(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      const id = Number(ctx.params?.id)
      if (!Number.isFinite(id)) return ctx.badRequest('Invalid user id.')

      const existing = await service().getUserEntity(id)
      if (!existing) return ctx.notFound('User not found.')
      if (existing.invitePending) {
        return ctx.badRequest('This user still has a pending invite. Resend the invite instead.')
      }

      const body = ctx.request?.body || {}
      const data = body.data || body
      const passwordError = service().validatePassword(data.password)
      if (passwordError) return ctx.badRequest(passwordError)

      await service().updateUser(id, { password: String(data.password) })
      ctx.body = { data: { ok: true } }
    },

    async invite(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      if (!service().checkRateLimit(`invite:${admin.id}`, 20, 60_000)) {
        return ctx.throw(429, 'Too many invite attempts. Try again shortly.')
      }

      const body = ctx.request?.body || {}
      const data = body.data || body
      const emailError = service().validateEmail(data.email)
      if (emailError) return ctx.badRequest(emailError)

      const role = await service().resolveAssignableRole(data.roleId ?? data.role)
      if (!role) return ctx.badRequest('Choose a valid role (Admin, Editor, or Viewer).')

      const email = service().normalizeEmail(data.email)
      if (await service().emailTaken(email)) {
        return ctx.badRequest('A user with this email already exists.')
      }

      const { token, hash, expiresAt } = service().createInviteToken()

      let created
      try {
        created = await service().createUser({
          email,
          username: data.username
            ? String(data.username).trim()
            : service().usernameFromEmail(email),
          password: service().randomPassword(),
          roleId: role.id,
          blocked: true,
          invitePending: true,
          inviteTokenHash: hash,
          inviteExpiresAt: expiresAt,
        })
      } catch (error) {
        strapi.log.error('Invite user create failed', error)
        return ctx.internalServerError('Could not create invited user.')
      }

      try {
        await service().sendInviteEmail({
          to: email,
          roleName: role.name || role.type || 'Editor',
          inviterEmail: admin.email,
          token,
          expiresAt,
        })
      } catch (error) {
        strapi.log.error('Invite email send failed', error)
        // Keep the pending user so admin can resend once email is configured.
        return ctx.badRequest(
          (error as Error)?.message ||
            'User was created but the invite email could not be sent. Check email configuration and resend.',
        )
      }

      ctx.body = { data: created }
    },

    async resendInvite(ctx: any) {
      const admin = await service().requireAdmin(ctx)
      if (!admin) return

      if (!service().checkRateLimit(`resend:${admin.id}`, 20, 60_000)) {
        return ctx.throw(429, 'Too many resend attempts. Try again shortly.')
      }

      const id = Number(ctx.params?.id)
      if (!Number.isFinite(id)) return ctx.badRequest('Invalid user id.')

      const existing = await service().getUserEntity(id)
      if (!existing) return ctx.notFound('User not found.')
      if (!existing.invitePending) {
        return ctx.badRequest('This user does not have a pending invite.')
      }

      const role =
        existing.role && typeof existing.role === 'object' ? existing.role : null
      if (!role) return ctx.badRequest('User has no assignable role.')

      const { token, hash, expiresAt } = service().createInviteToken()
      await service().updateUser(id, {
        inviteTokenHash: hash,
        inviteExpiresAt: expiresAt,
        blocked: true,
        invitePending: true,
      })

      try {
        await service().sendInviteEmail({
          to: String(existing.email),
          roleName: role.name || role.type || 'Editor',
          inviterEmail: admin.email,
          token,
          expiresAt,
        })
      } catch (error) {
        strapi.log.error('Resend invite email failed', error)
        return ctx.badRequest(
          (error as Error)?.message || 'Could not send invite email. Check email configuration.',
        )
      }

      ctx.body = { data: await service().findUser(id) }
    },

    async inviteStatus(ctx: any) {
      const token = String(ctx.query?.token || '').trim()
      if (!token) return ctx.badRequest('Invite token is required.')

      if (!service().checkRateLimit(`status:${ctx.ip || 'unknown'}`, 30, 60_000)) {
        return ctx.throw(429, 'Too many requests. Try again shortly.')
      }

      const user = await service().findInviteByToken(token)
      if (!user?.invitePending || !user.inviteExpiresAt) {
        ctx.body = { data: { valid: false } }
        return
      }

      const expiresAt = new Date(user.inviteExpiresAt)
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
        ctx.body = { data: { valid: false } }
        return
      }

      ctx.body = {
        data: {
          valid: true,
          expiresAt: expiresAt.toISOString(),
          emailHint: maskEmail(String(user.email || '')),
          roleName:
            user.role && typeof user.role === 'object'
              ? user.role.name || user.role.type
              : null,
        },
      }
    },

    async acceptInvite(ctx: any) {
      if (!service().checkRateLimit(`accept:${ctx.ip || 'unknown'}`, 15, 60_000)) {
        return ctx.throw(429, 'Too many attempts. Try again shortly.')
      }

      const body = ctx.request?.body || {}
      const data = body.data || body
      const token = String(data.token || '').trim()
      if (!token) return ctx.badRequest('Invite token is required.')

      const passwordError = service().validatePassword(data.password)
      if (passwordError) return ctx.badRequest(passwordError)

      const user = await service().findInviteByToken(token)
      if (!user?.invitePending || !user.inviteExpiresAt) {
        return ctx.badRequest('This invite link is invalid or has expired.')
      }

      const expiresAt = new Date(user.inviteExpiresAt)
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
        return ctx.badRequest('This invite link is invalid or has expired.')
      }

      await service().updateUser(user.id, {
        password: String(data.password),
        blocked: false,
        invitePending: false,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        confirmed: true,
      })

      ctx.body = { data: { ok: true, email: user.email } }
    },
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}
