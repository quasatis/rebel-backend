/**
 * Cross-content search service for GET /api/search
 * Response shape matches frontoffice searchService expectations.
 */

export type PublicSearchType =
  | 'article'
  | 'artist'
  | 'show'
  | 'episode'
  | 'studio-video'
  | 'music'
  | 'playlist'
  | 'event'

type SearchHit = {
  id: number
  documentId: string
  type: PublicSearchType
  title: string
  slug: string
  excerpt: string | null
  imageUrl: string | null
  category?: string | null
  publishedAt?: string | null
}

function normalizeType(raw: string): PublicSearchType | '' {
  const t = raw.trim()
  if (!t || t === 'all') return ''
  if (t === 'music-release' || t === 'music') return 'music'
  return t as PublicSearchType
}

export default ({ strapi }: { strapi: any }) => ({
  async search({
    q,
    type = '',
    page = 1,
    pageSize = 20,
  }: {
    q: string
    type?: string
    page?: number
    pageSize?: number
  }) {
    const query = String(q || '').trim()
    const safePage = Math.max(1, Number(page) || 1)
    const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20))
    const filterType = normalizeType(String(type || ''))

    if (!query) {
      return {
        data: [] as SearchHit[],
        meta: {
          pagination: {
            page: safePage,
            pageSize: safePageSize,
            pageCount: 0,
            total: 0,
          },
        },
      }
    }

    const contains = { $containsi: query }
    const results: SearchHit[] = []
    const wants = (name: PublicSearchType) => !filterType || filterType === name
    const tasks: Promise<void>[] = []

    if (wants('article')) {
      tasks.push(
        strapi
          .documents('api::article.article')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['featuredImage', 'category'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    if (wants('artist')) {
      tasks.push(
        strapi
          .documents('api::artist.artist')
          .findMany({
            filters: { name: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['profileImage'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    if (wants('show')) {
      tasks.push(
        strapi
          .documents('api::show.show')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['coverImage'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    if (wants('episode')) {
      tasks.push(
        strapi
          .documents('api::show-episode.show-episode')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['thumbnail', 'show'],
          })
          .then((rows: any[]) => {
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'episode',
                title: String(row.title),
                slug: row.show?.slug
                  ? `${row.show.slug}/${row.slug}`
                  : String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.thumbnail?.url || null,
                publishedAt: row.publishedAt || null,
              }),
            )
          }),
      )
    }

    if (wants('studio-video')) {
      tasks.push(
        strapi
          .documents('api::studio-video.studio-video')
          .findMany({
            filters: { title: contains, visibility: 'public' },
            status: 'published',
            limit: safePageSize,
            populate: ['thumbnail'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    if (wants('music')) {
      tasks.push(
        strapi
          .documents('api::music-release.music-release')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['coverImage'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    if (wants('playlist')) {
      tasks.push(
        strapi
          .documents('api::playlist.playlist')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['coverImage'],
          })
          .then((rows: any[]) => {
            rows.forEach((row) =>
              results.push({
                id: Number(row.id),
                documentId: String(row.documentId),
                type: 'playlist',
                title: String(row.title),
                slug: String(row.slug),
                excerpt: row.description || null,
                imageUrl: row.coverImage?.url || null,
              }),
            )
          }),
      )
    }

    if (wants('event')) {
      tasks.push(
        strapi
          .documents('api::event.event')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: safePageSize,
            populate: ['featuredImage', 'category'],
          })
          .then((rows: any[]) => {
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
            )
          }),
      )
    }

    await Promise.all(tasks)

    const total = results.length
    const start = (safePage - 1) * safePageSize
    const data = results.slice(start, start + safePageSize)

    return {
      data,
      meta: {
        pagination: {
          page: safePage,
          pageSize: safePageSize,
          pageCount: Math.ceil(total / safePageSize) || 0,
          total,
        },
      },
    }
  },
})
