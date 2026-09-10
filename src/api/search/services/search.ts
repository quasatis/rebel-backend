/**
 * Cross-content search service for GET /api/search
 */

type SearchType =
  | 'article'
  | 'artist'
  | 'event'
  | 'show'
  | 'studio-video'
  | 'playlist'
  | 'music-release'
  | 'all';

const SEARCHABLE: Array<{
  type: Exclude<SearchType, 'all'>;
  uid: string;
  fields: string[];
  draftAndPublish: boolean;
}> = [
  {
    type: 'article',
    uid: 'api::article.article',
    fields: ['title', 'excerpt', 'slug'],
    draftAndPublish: true,
  },
  {
    type: 'artist',
    uid: 'api::artist.artist',
    fields: ['name', 'slug', 'country'],
    draftAndPublish: true,
  },
  {
    type: 'event',
    uid: 'api::event.event',
    fields: ['title', 'slug'],
    draftAndPublish: true,
  },
  {
    type: 'show',
    uid: 'api::show.show',
    fields: ['title', 'slug'],
    draftAndPublish: true,
  },
  {
    type: 'studio-video',
    uid: 'api::studio-video.studio-video',
    fields: ['title', 'slug', 'description'],
    draftAndPublish: true,
  },
  {
    type: 'playlist',
    uid: 'api::playlist.playlist',
    fields: ['title', 'slug', 'description'],
    draftAndPublish: true,
  },
  {
    type: 'music-release',
    uid: 'api::music-release.music-release',
    fields: ['title', 'slug', 'description'],
    draftAndPublish: true,
  },
];

function buildOrFilters(fields: string[], q: string) {
  return fields.map((field) => ({
    [field]: { $containsi: q },
  }));
}

export default ({ strapi }: { strapi: any }) => ({
  async search({
    q,
    type = 'all',
    page = 1,
    pageSize = 25,
  }: {
    q: string;
    type?: SearchType | string;
    page?: number;
    pageSize?: number;
  }) {
    const query = (q || '').trim();
    if (!query) {
      return {
        results: [],
        pagination: { page, pageSize, pageCount: 0, total: 0 },
      };
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

    const targets =
      type && type !== 'all' ? SEARCHABLE.filter((t) => t.type === type) : SEARCHABLE;

    if (!targets.length) {
      return {
        results: [],
        pagination: {
          page: safePage,
          pageSize: safePageSize,
          pageCount: 0,
          total: 0,
        },
      };
    }

    const perTypeLimit = safePage * safePageSize;

    const buckets = await Promise.all(
      targets.map(async (target) => {
        const filters: Record<string, unknown> = {
          $or: buildOrFilters(target.fields, query),
        };

        const docs = await strapi.documents(target.uid).findMany({
          filters,
          status: target.draftAndPublish ? 'published' : undefined,
          limit: perTypeLimit,
          sort: 'createdAt:desc',
        });

        return (docs || []).map((doc: any) => ({
          type: target.type,
          documentId: doc.documentId,
          id: doc.id,
          title: doc.title || doc.name || '',
          slug: doc.slug || null,
          excerpt: doc.excerpt || doc.description || null,
          data: doc,
        }));
      })
    );

    const merged = buckets.flat().sort((a, b) => {
      const aDate = a.data?.createdAt ? new Date(a.data.createdAt).getTime() : 0;
      const bDate = b.data?.createdAt ? new Date(b.data.createdAt).getTime() : 0;
      return bDate - aDate;
    });

    const total = merged.length;
    const start = (safePage - 1) * safePageSize;
    const results = merged.slice(start, start + safePageSize);

    return {
      results,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        pageCount: Math.ceil(total / safePageSize) || 0,
        total,
      },
    };
  },
});
