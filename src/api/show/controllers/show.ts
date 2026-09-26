import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::show.show', ({ strapi }) => ({
  async episodes(ctx) {
    const { documentId } = ctx.params
    if (!documentId) {
      return ctx.badRequest('documentId is required')
    }
    const page = Math.max(1, Number(ctx.query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(ctx.query.pageSize) || 10))
    const filters = { show: { documentId } }
    const [rows, total] = await Promise.all([
      strapi.documents('api::show-episode.show-episode').findMany({
        filters,
        status: 'draft',
        sort: { episodeNumber: 'desc', publishedAt: 'desc' },
        start: (page - 1) * pageSize,
        limit: pageSize,
        populate: ['thumbnail', 'mediaSource'],
      }),
      strapi.documents('api::show-episode.show-episode').count({
        filters,
        status: 'draft',
      }),
    ])
    ctx.body = {
      data: rows,
      meta: {
        pagination: {
          page,
          pageSize,
          total,
          pageCount: Math.ceil(total / pageSize) || 0,
        },
      },
    }
  },

  async sync(ctx) {
    const { documentId } = ctx.params
    if (!documentId) {
      return ctx.badRequest('documentId is required')
    }
    try {
      const result = await strapi.service('api::youtube-source.youtube-sync').syncShow(documentId)
      ctx.body = { data: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      strapi.log.error(`Manual Show sync failed: ${message}`)
      if (
        message.includes('no YouTube source') ||
        message.includes('not found') ||
        message.includes('missing required identifiers')
      ) {
        return ctx.badRequest(message)
      }
      return ctx.internalServerError(message || 'Synchronization failed')
    }
  },
}))
