import { factories } from '@strapi/strapi'

export default factories.createCoreRouter('api::contact-message.contact-message', {
  only: ['create'],
  config: {
    create: {
      auth: false,
    },
  },
})
