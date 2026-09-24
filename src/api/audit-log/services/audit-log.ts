import { factories } from '@strapi/strapi'

export const AUDIT_LOG_UID = 'api::audit-log.audit-log' as const

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'publish',
  'unpublish',
  'login',
  'invite',
  'invite_resend',
  'accept_invite',
  'user_update',
  'password_reset',
  'mfa_change',
  'newsletter_send',
  'newsletter_schedule',
  'newsletter_cancel',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Editorial types whose create/update/delete should appear in the audit trail. */
export const AUDIT_LIFECYCLE_UIDS = [
  'api::article.article',
  'api::category.category',
  'api::tag.tag',
  'api::author.author',
  'api::artist.artist',
  'api::music-release.music-release',
  'api::track.track',
  'api::playlist.playlist',
  'api::show.show',
  'api::show-episode.show-episode',
  'api::studio-video.studio-video',
  'api::studio-genre.studio-genre',
  'api::video-collection.video-collection',
  'api::event.event',
  'api::venue.venue',
  'api::event-category.event-category',
  'api::media-source.media-source',
  'api::homepage-feature.homepage-feature',
  'api::homepage-settings.homepage-settings',
  'api::launch-settings.launch-settings',
  'api::about-page.about-page',
  'api::rebel-of-the-week.rebel-of-the-week',
  'api::newsletter-config.newsletter-config',
  'api::newsletter-campaign.newsletter-campaign',
] as const

export type AuditActor = {
  actorUserId: string
  actorEmail: string
  actorRole: string
}

export type WriteLogInput = {
  action: AuditAction
  resourceType: string
  resourceId?: string | number | null
  resourceLabel?: string | null
  meta?: Record<string, unknown> | null
  actor?: {
    id?: number | string | null
    email?: string | null
    role?: string | null
  } | null
  ctx?: any
  ip?: string | null
}

function asString(value: unknown, max = 240): string {
  if (value == null) return ''
  const text = String(value).trim()
  return text.slice(0, max)
}

function roleTypeOf(user: { role?: { type?: string; name?: string } | number | null } | null) {
  const role = user?.role
  if (role && typeof role === 'object') return asString(role.type || role.name, 40)
  return ''
}

export function resourceTypeFromUid(uid: string): string {
  const part = String(uid || '').split('.').pop() || uid
  return asString(part, 80)
}

export function labelFromEntity(entity: unknown): string {
  if (!entity || typeof entity !== 'object') return ''
  const row = entity as Record<string, unknown>
  return (
    asString(row.title, 200) ||
    asString(row.name, 200) ||
    asString(row.subject, 200) ||
    asString(row.email, 200) ||
    asString(row.slug, 160) ||
    asString(row.documentId, 64) ||
    asString(row.id, 64)
  )
}

export function resourceIdFromEntity(entity: unknown): string {
  if (!entity || typeof entity !== 'object') return ''
  const row = entity as Record<string, unknown>
  return asString(row.documentId, 64) || asString(row.id, 64)
}

function getRequestContext(strapi: any, ctx?: any) {
  if (ctx) return ctx
  try {
    return strapi.requestContext?.get?.() || null
  } catch {
    return null
  }
}

function requestIp(ctx: any, fallback?: string | null) {
  if (fallback) return asString(fallback, 80)
  if (!ctx) return ''
  return asString(ctx.ip || ctx.request?.ip || ctx.request?.header?.['x-forwarded-for'], 80)
}

export default factories.createCoreService(AUDIT_LOG_UID, ({ strapi }) => ({
  AUDIT_LIFECYCLE_UIDS,
  AUDIT_ACTIONS,

  skipLifecycleForRequest(ctx?: any) {
    const request = getRequestContext(strapi, ctx)
    if (request?.state) request.state.auditSkipLifecycle = true
  },

  shouldSkipLifecycle(ctx?: any) {
    const request = getRequestContext(strapi, ctx)
    return Boolean(request?.state?.auditSkipLifecycle)
  },

  async resolveActor(input?: WriteLogInput['actor'], ctx?: any): Promise<AuditActor | null> {
    const request = getRequestContext(strapi, ctx)
    if (request?.state?.auditActor) return request.state.auditActor as AuditActor

    const authUser = input || request?.state?.user
    const id = Number(authUser?.id)
    if (!Number.isFinite(id) || id <= 0) return null

    let email = asString(authUser?.email, 180)
    let role = asString((authUser as { role?: string })?.role, 40)
    if (authUser && typeof (authUser as { role?: unknown }).role === 'object') {
      role = roleTypeOf(authUser as { role?: { type?: string; name?: string } })
    }

    if (!email || !role) {
      const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id },
        populate: ['role'],
      })) as { id: number; email?: string; role?: { type?: string; name?: string } } | null
      if (!user) return null
      email = email || asString(user.email, 180)
      role = role || roleTypeOf(user)
    }

    const actor: AuditActor = {
      actorUserId: String(id),
      actorEmail: email,
      actorRole: role,
    }
    if (request?.state) request.state.auditActor = actor
    return actor
  },

  async writeLog(input: WriteLogInput) {
    const request = getRequestContext(strapi, input.ctx)
    if (request?.state?.auditWriting) return
    if (request?.state) request.state.auditWriting = true

    try {
      const actor = await this.resolveActor(input.actor, request)
      if (!actor) return

      const action = AUDIT_ACTIONS.includes(input.action) ? input.action : null
      const resourceType = asString(input.resourceType, 80)
      if (!action || !resourceType) return

      await strapi.db.query(AUDIT_LOG_UID).create({
        data: {
          action,
          actorUserId: actor.actorUserId,
          actorEmail: actor.actorEmail,
          actorRole: actor.actorRole,
          resourceType,
          resourceId: asString(input.resourceId, 80) || null,
          resourceLabel: asString(input.resourceLabel, 200) || null,
          ip: requestIp(request, input.ip) || null,
          meta:
            input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
              ? input.meta
              : null,
          occurredAt: new Date(),
        },
      })
    } catch (error) {
      strapi.log.warn(
        `Audit log write skipped: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    } finally {
      if (request?.state) request.state.auditWriting = false
    }
  },

  async recordLifecycleEvent(
    event: { model?: { uid?: string }; result?: unknown },
    action: 'create' | 'update' | 'delete',
  ) {
    try {
      const uid = String(event?.model?.uid || '')
      if (!uid || uid === AUDIT_LOG_UID) return
      if (this.shouldSkipLifecycle()) return

      const actor = await this.resolveActor()
      if (!actor) return

      await this.writeLog({
        action,
        resourceType: resourceTypeFromUid(uid),
        resourceId: resourceIdFromEntity(event.result),
        resourceLabel: labelFromEntity(event.result),
      })
    } catch (error) {
      strapi.log.warn(
        `Audit lifecycle skipped: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  },

  async findLogs(query: {
    search?: string
    action?: string
    resourceType?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25))
    const search = asString(query.search, 120)
    const action = asString(query.action, 40)
    const resourceType = asString(query.resourceType, 80)
    const from = asString(query.from, 40)
    const to = asString(query.to, 40)

    const filters: Record<string, unknown>[] = []
    if (action && AUDIT_ACTIONS.includes(action as AuditAction)) {
      filters.push({ action })
    }
    if (resourceType) filters.push({ resourceType })
    if (from && !Number.isNaN(Date.parse(from))) {
      filters.push({ occurredAt: { $gte: new Date(from).toISOString() } })
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      const end = new Date(to)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        end.setUTCHours(23, 59, 59, 999)
      }
      filters.push({ occurredAt: { $lte: end.toISOString() } })
    }
    if (search) {
      filters.push({
        $or: [
          { actorEmail: { $containsi: search } },
          { resourceLabel: { $containsi: search } },
          { resourceType: { $containsi: search } },
          { resourceId: { $containsi: search } },
          { action: { $containsi: search } },
        ],
      })
    }

    const where = filters.length ? { $and: filters } : {}

    const [results, total] = await Promise.all([
      strapi.db.query(AUDIT_LOG_UID).findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      strapi.db.query(AUDIT_LOG_UID).count({ where }),
    ])

    return {
      data: results,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
          total: Number(total) || 0,
        },
      },
    }
  },

  async findLog(id: number) {
    return strapi.db.query(AUDIT_LOG_UID).findOne({ where: { id } })
  },
}))
