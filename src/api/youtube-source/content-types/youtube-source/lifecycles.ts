import {
  normalizeYoutubeChannelId,
  normalizeYoutubePlaylistId,
  normalizeYoutubeUsername,
  normalizeYoutubeVideoId,
} from '../../../../utils/youtube-ids'
import { syncMediaSourceFromYoutubeSource } from '../../../../utils/youtube-media-source'

function normalizeSourceIds(data: Record<string, unknown> | undefined) {
  if (!data) return
  if ('playlistId' in data && data.playlistId != null) {
    data.playlistId = normalizeYoutubePlaylistId(String(data.playlistId))
  }
  if ('videoId' in data && data.videoId != null) {
    data.videoId = normalizeYoutubeVideoId(String(data.videoId))
  }
  if ('channelId' in data && data.channelId != null) {
    data.channelId = normalizeYoutubeChannelId(String(data.channelId))
  }
  if ('username' in data && data.username != null) {
    data.username = normalizeYoutubeUsername(String(data.username))
  }
}

export default {
  async beforeCreate(event: { params: { data?: Record<string, unknown> } }) {
    normalizeSourceIds(event.params.data)
  },

  async beforeUpdate(event: { params: { data?: Record<string, unknown> } }) {
    normalizeSourceIds(event.params.data)
  },

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
