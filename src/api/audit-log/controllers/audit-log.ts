import { factories } from '@strapi/strapi'
import { AUDIT_LOG_UID } from '../services/audit-log'

export default factories.createCoreController(AUDIT_LOG_UID, ({ strapi }) => {
  const users = () => strapi.service('api::backoffice-users.backoffice-users')
  const logs = () => strapi.service('api::audit-log.audit-log')

  return {
    async find(ctx: any) {
      const admin = await users().requireAdmin(ctx)
      if (!admin) return

      const query = ctx.query || {}
      ctx.body = await logs().findLogs({
        search: query.search || query.q,
        action: query.action,
        resourceType: query.resourceType,
        from: query.from,
        to: query.to,
        page: query.page || query['pagination[page]'],
        pageSize: query.pageSize || query['pagination[pageSize]'],
      })
    },

    async findOne(ctx: any) {
      const admin = await users().requireAdmin(ctx)
      if (!admin) return

      const id = Number(ctx.params?.id)
      if (!Number.isFinite(id)) return ctx.badRequest('Invalid audit log id.')

      const row = await logs().findLog(id)
      if (!row) return ctx.notFound('Audit log not found.')
      ctx.body = { data: row }
    },

    async create(ctx: any) {
      return ctx.forbidden('Audit logs cannot be created through the API.')
    },

    async update(ctx: any) {
      return ctx.forbidden('Audit logs cannot be updated.')
    },

    async delete(ctx: any) {
      return ctx.forbidden('Audit logs cannot be deleted.')
    },
  }
})
