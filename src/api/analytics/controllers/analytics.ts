export default ({ strapi }) => ({
  async channelTraffic(ctx) {
    const fromRaw = String(ctx.query.from || '').trim()
    const toRaw = String(ctx.query.to || '').trim()
    const channelKey = String(ctx.query.channelKey || '').trim()

    const now = new Date()
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const from = fromRaw && !Number.isNaN(Date.parse(fromRaw))
      ? new Date(fromRaw)
      : defaultFrom
    const to = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : now

    if (from > to) {
      return ctx.badRequest('`from` must be before `to`.')
    }

    const result = await strapi.service('api::analytics.analytics').channelTraffic({
      from: from.toISOString(),
      to: to.toISOString(),
      channelKey: channelKey || null,
    })

    ctx.body = result
  },
})
