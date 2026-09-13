import { syncMediaSourceFromYoutubeSource } from '../../../../utils/youtube-media-source'

export default {
  async afterCreate(event: { result?: Record<string, unknown> }) {
    const row = event.result
    if (!row) return
    const strapi = (globalThis as { strapi?: any }).strapi
    if (!strapi) return
    await syncMediaSourceFromYoutubeSource(strapi, row as never)
  },

  async afterUpdate(event: { result?: Record<string, unknown> }) {
    const row = event.result
    if (!row) return
    const strapi = (globalThis as { strapi?: any }).strapi
    if (!strapi) return
    await syncMediaSourceFromYoutubeSource(strapi, row as never)
  },
}
