export default ({ strapi }) => ({
  async search(ctx) {
    const q = String(ctx.query.q || '').trim()
    const type = String(ctx.query.type || '').trim()
    const page = Number(ctx.query['pagination[page]'] || ctx.query.page || 1)
    const pageSize = Math.min(
      Number(ctx.query['pagination[pageSize]'] || ctx.query.pageSize || 20),
      50,
    )

    const result = await strapi.service('api::search.search').search({
      q,
      type,
      page,
      pageSize,
    })

    ctx.body = result
  },
})
