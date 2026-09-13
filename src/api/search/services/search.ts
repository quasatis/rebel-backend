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

function mediaThumb(row: any): string | null {
  const media = row?.mediaSource
  if (row?.thumbnail?.url) return String(row.thumbnail.url)
  if (media?.thumbnailUrl) return String(media.thumbnailUrl)
  if (media?.provider === 'youtube' && media?.externalId) {
    return `https://i.ytimg.com/vi/${media.externalId}/hqdefault.jpg`
  }
  return null
}

function assetUrl(row: any, key: string): string | null {
  const url = row?.[key]?.url
  return url ? String(url) : null
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
    // Gather enough hits per type so combined pagination is accurate.
    const gatherLimit = Math.min(200, Math.max(safePageSize * 5, 50))

    if (wants('article')) {
      tasks.push(
        strapi
          .documents('api::article.article')
          .findMany({
            filters: { title: contains },
            status: 'published',
            limit: gatherLimit,
            populate: { featuredImage: true, category: true },
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
                imageUrl: assetUrl(row, 'featuredImage'),
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
            limit: gatherLimit,
            populate: { profileImage: true },
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
                imageUrl: assetUrl(row, 'profileImage'),
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
            limit: gatherLimit,
            populate: { coverImage: true },
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
                imageUrl: assetUrl(row, 'coverImage'),
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
            limit: gatherLimit,
            populate: {
              thumbnail: true,
              mediaSource: true,
              show: true,
            },
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
                imageUrl: mediaThumb(row),
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
            filters: {
              visibility: 'public',
              $or: [
                { title: contains },
                { description: contains },
                { genre: contains },
              ],
            },
            status: 'published',
            limit: gatherLimit,
            populate: {
              thumbnail: true,
              mediaSource: true,
            },
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
                imageUrl: mediaThumb(row),
                category: row.genre ? String(row.genre) : null,
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
            limit: gatherLimit,
            populate: { coverImage: true },
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
                imageUrl: assetUrl(row, 'coverImage'),
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
            limit: gatherLimit,
            populate: { coverImage: true },
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
                imageUrl: assetUrl(row, 'coverImage'),
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
            limit: gatherLimit,
            populate: { featuredImage: true, category: true },
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
                imageUrl: assetUrl(row, 'featuredImage'),
                category: row.category?.name || null,
                publishedAt: row.startDate || null,
              }),
            )
          }),
      )
    }

    await Promise.all(tasks)

    results.sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
      if (bTime !== aTime) return bTime - aTime
      return a.title.localeCompare(b.title)
    })

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
