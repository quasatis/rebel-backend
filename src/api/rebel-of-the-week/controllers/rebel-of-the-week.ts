import { factories } from '@strapi/strapi'
import { resolveTrackLinkMeta } from '../../../utils/track-link-meta'

export default factories.createCoreController(
  'api::rebel-of-the-week.rebel-of-the-week',
  ({ strapi }) => ({
    /**
     * Resolve Spotify / YouTube track duration (and title) for the BO listening editor.
     * Auth required — backoffice JWT.
     */
    async resolveTrackLink(ctx) {
      if (!ctx.state?.user) {
        return ctx.unauthorized('Authentication required')
      }

      const url = String(ctx.query?.url || '').trim()
      if (!url) {
        return ctx.badRequest('url query parameter is required')
      }

      try {
        const meta = await resolveTrackLinkMeta(url)
        if (!meta) {
          return ctx.badRequest('Unrecognized Spotify or YouTube track link')
        }
        ctx.body = { data: meta }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        strapi.log.warn(`resolveTrackLink failed: ${message}`)
        if (/YOUTUBE_API_KEY|not configured/i.test(message)) {
          return ctx.badRequest(message)
        }
        if (/YouTube API error 400|Invalid|Unrecognized/i.test(message)) {
          return ctx.badRequest(message)
        }
        return ctx.internalServerError('Could not resolve track link metadata')
      }
    },
  }),
)
