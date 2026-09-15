import { factories } from '@strapi/strapi'
import type { Core } from '@strapi/strapi'

type LaunchRow = {
  previewSecret?: string | null
  previewAllowed?: boolean
  [key: string]: unknown
}

function withPreviewGate(data: LaunchRow | null | undefined, previewQuery: string, stripSecret: boolean) {
  if (!data || typeof data !== 'object') return data
  const secret = typeof data.previewSecret === 'string' ? data.previewSecret.trim() : ''
  const previewAllowed = Boolean(secret && previewQuery && secret === previewQuery.trim())
  const next: LaunchRow = { ...data, previewAllowed }
  if (stripSecret) delete next.previewSecret
  return next
}

export default factories.createCoreController(
  'api::launch-settings.launch-settings',
  ({ strapi }: { strapi: Core.Strapi }) => ({
    async find(ctx) {
      const entity = await strapi.documents('api::launch-settings.launch-settings').findFirst({})
      const previewQuery = String(
        (ctx.query as { launch_preview?: string; preview?: string }).launch_preview ||
          (ctx.query as { preview?: string }).preview ||
          '',
      )
      const stripSecret = !ctx.state.user
      ctx.body = {
        data: withPreviewGate(entity as LaunchRow | null, previewQuery, stripSecret),
      }
    },
  }),
)
