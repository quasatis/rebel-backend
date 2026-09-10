export default ({ strapi }) => ({
  async search(ctx) {
    const q = String(ctx.query.q || '').trim()
    const rawType = String(ctx.query.type || '').trim()
    // FO uses "music"; accept "music-release" as an alias.
    const type =
      rawType === 'music-release' || rawType === 'music'
        ? 'music'
        : rawType
    const page = Number(ctx.query['pagination[page]'] || ctx.query.page || 1)
    const pageSize = Math.min(
      Number(ctx.query['pagination[pageSize]'] || ctx.query.pageSize || 20),
      50,
    )

    if (!q) {
      ctx.body = {
        data: [],
        meta: { pagination: { page, pageSize, pageCount: 0, total: 0 } },
      }
      return
    }

    const contains = { $containsi: q }
    const results = []

    const wants = (name) => !type || type === name

    const tasks = []
    if (wants('article')) {
      tasks.push(
        strapi
          .documents('api::article.article')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: pageSize,
            populate: ['featuredImage', 'category'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'article',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.excerpt || null,
                imageUrl: row.featuredImage?.url || null,
                category: row.category?.name || null,
                publishedAt: row.publishedAt || null,
              }),
            ),
          ),
      )
    }
    if (wants('artist')) {
      tasks.push(
        strapi
          .documents('api::artist.artist')
          .findMany({
            filters: { name: contains },
            status: 'published',
            limit: pageSize,
            populate: ['profileImage'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'artist',
                title: String(row.name),
                slug: String(row.slug),
                excerpt: row.biography || null,
                imageUrl: row.profileImage?.url || null,
              }),
            ),
          ),
      )
    }
    if (wants('show')) {
      tasks.push(
        strapi
          .documents('api::show.show')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: pageSize,
            populate: ['coverImage'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'show',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.coverImage?.url || null,
              }),
            ),
          ),
      )
    }
    if (wants('episode')) {
      tasks.push(
        strapi
          .documents('api::show-episode.show-episode')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: pageSize,
            populate: ['thumbnail', 'show'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'episode',
                title: String(row.title),
                slug: String(row.show?.slug || row.slug),
                excerpt: row.description || null,
                imageUrl: row.thumbnail?.url || null,
                publishedAt: row.publishedAt || null,
              }),
            ),
          ),
      )
    }
    if (wants('studio-video')) {
      tasks.push(
        strapi
          .documents('api::studio-video.studio-video')
          .findMany({
            filters: { title: contains, visibility: 'public' },
            status: 'published',
            limit: pageSize,
            populate: ['thumbnail'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'studio-video',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.thumbnail?.url || null,
                publishedAt: row.releaseDate || null,
              }),
            ),
          ),
      )
    }
    if (wants('music')) {
      tasks.push(
        strapi
          .documents('api::music-release.music-release')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: pageSize,
            populate: ['coverImage'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'music',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.coverImage?.url || null,
              }),
            ),
          ),
      )
    }
    if (wants('event')) {
      tasks.push(
        strapi
          .documents('api::event.event')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: pageSize,
            populate: ['featuredImage', 'category'],
          })
          .then((rows) =>
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'event',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.featuredImage?.url || null,
                category: row.category?.name || null,
                publishedAt: row.startDate || null,
              }),
            ),
          ),
      )
    }

    await Promise.all(tasks)

    const total = results.length
    const start = (page - 1) * pageSize
    const data = results.slice(start, start + pageSize)

    ctx.body = {
      data,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize) || 0,
          total,
        },
      },
    }
  },
})
