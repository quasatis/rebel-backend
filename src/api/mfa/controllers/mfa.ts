function mfaActor(user: { id?: number; email?: string; role?: { type?: string; name?: string } | number | null }) {
  return {
    id: user?.id,
    email: user?.email,
    role:
      user?.role && typeof user.role === 'object'
        ? user.role.type || user.role.name
        : null,
  }
}

export default ({ strapi }: { strapi: any }) => {
  const service = () => strapi.service('api::mfa.mfa')
  const audit = () => strapi.service('api::audit-log.audit-log')

  async function logLogin(ctx: any, user: { id?: number; email?: string; role?: { type?: string; name?: string } | number | null }) {
    await audit().writeLog({
      action: 'login',
      resourceType: 'user',
      resourceId: user.id,
      resourceLabel: user.email || String(user.id || ''),
      actor: mfaActor(user),
      ctx,
    })
  }

  async function logMfaChange(
    ctx: any,
    user: { id?: number; email?: string; role?: { type?: string; name?: string } | number | null },
    kind: string,
  ) {
    await audit().writeLog({
      action: 'mfa_change',
      resourceType: 'user',
      resourceId: user.id,
      resourceLabel: user.email || String(user.id || ''),
      meta: { kind },
      actor: mfaActor(user),
      ctx,
    })
  }

  async function proveOwnership(
    svc: ReturnType<typeof service>,
    user: any,
    body: Record<string, unknown>,
  ): Promise<string | null> {
    const password = body.password != null ? String(body.password) : ''
    const totpCode = body.totpCode != null ? String(body.totpCode) : ''
    const emailCode = body.emailCode != null ? String(body.emailCode) : ''

    if (password) {
      const ok = await svc.validatePassword(user, password)
      return ok ? null : 'Invalid password.'
    }
    if (totpCode && user.totpEnabled) {
      const ok = await svc.verifyTotpCode(user, totpCode)
      return ok ? null : 'Invalid authenticator code.'
    }
    if (emailCode && user.emailMfaEnabled) {
      const ok = await svc.verifyEmailOtp(user, emailCode)
      return ok ? null : 'Invalid or expired email code.'
    }
    return 'Password or a valid two-factor code is required.'
  }

  return {
    async login(ctx: any) {
      const svc = service()
      const ip = ctx.ip || 'unknown'
      if (!svc.checkRateLimit(`mfa-login:${ip}`, 20, 60_000)) {
        return ctx.tooManyRequests('Too many sign-in attempts. Try again shortly.')
      }

      const body = ctx.request?.body || {}
      const identifier = String(body.identifier || '').trim()
      const password = String(body.password || '')

      if (!identifier || !password) {
        return ctx.badRequest('Identifier and password are required.')
      }

      const user = await svc.findByIdentifier(identifier)
      if (!user || !(await svc.validatePassword(user, password))) {
        return ctx.badRequest('Invalid credentials.')
      }

      if (user.blocked) {
        return ctx.forbidden('Your account has been blocked.')
      }
      if (user.invitePending) {
        return ctx.forbidden('Accept your invite before signing in.')
      }

      if (!svc.mfaRequired(user)) {
        ctx.body = svc.issueJwt(user)
        await logLogin(ctx, user)
        return
      }

      ctx.body = await svc.createChallenge(user)
    },

    async sendChallengeEmail(ctx: any) {
      const svc = service()
      const ip = ctx.ip || 'unknown'
      if (!svc.checkRateLimit(`mfa-send:${ip}`, 10, 60_000)) {
        return ctx.tooManyRequests('Too many code requests. Try again shortly.')
      }

      const body = ctx.request?.body || {}
      const challengeToken = String(body.challengeToken || '').trim()
      if (!challengeToken) return ctx.badRequest('Challenge token is required.')

      let userId: number
      try {
        ;({ userId } = svc.consumeChallengeToken(challengeToken))
      } catch {
        return ctx.badRequest('Invalid or expired challenge.')
      }

      if (!svc.checkRateLimit(`mfa-send-user:${userId}`, 5, 60_000)) {
        return ctx.tooManyRequests('Too many code requests. Try again shortly.')
      }

      const user = await svc.loadUserById(userId)
      if (!user || user.blocked) return ctx.badRequest('Invalid or expired challenge.')

      try {
        await svc.sendChallengeEmail(user)
        ctx.body = { ok: true }
      } catch (err) {
        return ctx.badRequest((err as Error).message || 'Could not send email code.')
      }
    },

    async verifyChallenge(ctx: any) {
      const svc = service()
      const ip = ctx.ip || 'unknown'
      if (!svc.checkRateLimit(`mfa-verify:${ip}`, 30, 60_000)) {
        return ctx.tooManyRequests('Too many verification attempts. Try again shortly.')
      }

      const body = ctx.request?.body || {}
      const challengeToken = String(body.challengeToken || '').trim()
      const method = String(body.method || '').trim().toLowerCase()
      const code = String(body.code || '').trim()

      if (!challengeToken || !method || !code) {
        return ctx.badRequest('Challenge token, method, and code are required.')
      }
      if (!['totp', 'email', 'backup'].includes(method)) {
        return ctx.badRequest('Method must be totp, email, or backup.')
      }

      let userId: number
      let jti: string
      let exp: number
      try {
        ;({ userId, jti, exp } = svc.consumeChallengeToken(challengeToken))
      } catch {
        return ctx.badRequest('Invalid or expired challenge.')
      }

      if (!svc.checkRateLimit(`mfa-verify-user:${userId}`, 15, 60_000)) {
        return ctx.tooManyRequests('Too many verification attempts. Try again shortly.')
      }

      const user = await svc.loadUserById(userId)
      if (!user || user.blocked) return ctx.badRequest('Invalid or expired challenge.')

      let ok = false
      try {
        if (method === 'totp') {
          if (!user.totpEnabled) return ctx.badRequest('Authenticator is not enabled.')
          ok = await svc.verifyTotpCode(user, code)
        } else if (method === 'email') {
          if (!user.emailMfaEnabled) return ctx.badRequest('Email two-factor is not enabled.')
          ok = await svc.verifyEmailOtp(user, code)
          if (ok) await svc.clearEmailOtp(user.id)
        } else {
          ok = await svc.consumeBackupCode(user, code)
        }
      } catch {
        ok = false
      }

      if (!ok) return ctx.badRequest('Invalid verification code.')

      svc.markChallengeUsed(jti, exp)
      ctx.body = svc.issueJwt(user)
      await logLogin(ctx, user)
    },

    async status(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      ctx.body = { data: svc.statusPayload(user) }
    },

    async me(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      ctx.body = { data: svc.publicUser(user) }
    },

    async totpSetup(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      try {
        const result = await svc.setupTotp(user)
        ctx.body = { data: result }
      } catch (err) {
        return ctx.badRequest((err as Error).message || 'Could not start authenticator setup.')
      }
    },

    async totpConfirm(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const code = String(body.code || '').trim()
      if (!code) return ctx.badRequest('Authenticator code is required.')
      try {
        const result = await svc.confirmTotp(user, code)
        const fresh = await svc.loadUserById(user.id)
        await logMfaChange(ctx, fresh || user, 'totp_enable')
        ctx.body = {
          data: {
            ...(fresh ? svc.statusPayload(fresh) : {}),
            backupCodes: result.backupCodes,
          },
        }
      } catch (err) {
        return ctx.badRequest((err as Error).message || 'Could not confirm authenticator.')
      }
    },

    async totpDisable(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const err = await proveOwnership(svc, user, body)
      if (err) return ctx.badRequest(err)
      await svc.disableTotp(user)
      const fresh = await svc.loadUserById(user.id)
      await logMfaChange(ctx, fresh || user, 'totp_disable')
      ctx.body = { data: fresh ? svc.statusPayload(fresh) : { ok: true } }
    },

    async emailEnable(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      if (!svc.checkRateLimit(`mfa-email-enable:${user.id}`, 5, 60_000)) {
        return ctx.tooManyRequests('Too many code requests. Try again shortly.')
      }
      try {
        await svc.startEmailEnable(user)
        ctx.body = { data: { ok: true } }
      } catch (err) {
        return ctx.badRequest((err as Error).message || 'Could not send confirmation code.')
      }
    },

    async emailConfirm(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const code = String(body.code || '').trim()
      if (!code) return ctx.badRequest('Confirmation code is required.')
      try {
        const result = await svc.confirmEmailEnable(user, code)
        const fresh = await svc.loadUserById(user.id)
        await logMfaChange(ctx, fresh || user, 'email_enable')
        ctx.body = {
          data: {
            ...(fresh ? svc.statusPayload(fresh) : {}),
            backupCodes: result.backupCodes,
          },
        }
      } catch (err) {
        return ctx.badRequest((err as Error).message || 'Could not enable email two-factor.')
      }
    },

    async emailDisable(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const err = await proveOwnership(svc, user, body)
      if (err) return ctx.badRequest(err)
      await svc.disableEmail(user)
      const fresh = await svc.loadUserById(user.id)
      await logMfaChange(ctx, fresh || user, 'email_disable')
      ctx.body = { data: fresh ? svc.statusPayload(fresh) : { ok: true } }
    },

    async regenerateBackupCodes(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const err = await proveOwnership(svc, user, body)
      if (err) return ctx.badRequest(err)
      try {
        const codes = await svc.regenerateBackupCodes(user)
        const fresh = await svc.loadUserById(user.id)
        await logMfaChange(ctx, fresh || user, 'backup_codes')
        ctx.body = {
          data: {
            ...(fresh ? svc.statusPayload(fresh) : {}),
            backupCodes: codes,
          },
        }
      } catch (e) {
        return ctx.badRequest((e as Error).message || 'Could not regenerate backup codes.')
      }
    },

    async disable(ctx: any) {
      const svc = service()
      const user = await svc.requireAuthUser(ctx)
      if (!user) return
      const body = ctx.request?.body?.data || ctx.request?.body || {}
      const password = String(body.password || '')
      if (!password) return ctx.badRequest('Password is required.')
      const ok = await svc.validatePassword(user, password)
      if (!ok) return ctx.badRequest('Invalid password.')
      await svc.disableAll(user)
      const fresh = await svc.loadUserById(user.id)
      await logMfaChange(ctx, fresh || user, 'disable_all')
      ctx.body = { data: fresh ? svc.statusPayload(fresh) : { ok: true } }
    },
  }
}
