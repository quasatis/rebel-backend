import type { Core } from '@strapi/strapi'
import { sanitizeMediaFolder } from '../utils/media-folders'

export default (_config: unknown, _ctx: { strapi: Core.Strapi }) => {
  return async (ctx: { method: string; url: string; request: { body?: Record<string, unknown> } }, next: () => Promise<void>) => {
    const isUpload =
      ctx.method === 'POST' &&
      (ctx.url === '/api/upload' || ctx.url.startsWith('/api/upload?') || ctx.url === '/upload' || ctx.url.startsWith('/upload?'))

    if (isUpload) {
      const body = ctx.request.body ?? {}
      ctx.request.body = {
        ...body,
        path: sanitizeMediaFolder(body.path),
      }
    }

    await next()
  }
}
