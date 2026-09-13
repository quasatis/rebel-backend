import { factories } from '@strapi/strapi'

export default factories.createCoreRouter('api::media-traffic-event.media-traffic-event', {
  only: ['create', 'find', 'findOne'],
})
