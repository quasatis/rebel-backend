export default ({ env }) => {
  const corsOrigin = env('CORS_ORIGIN', 'http://localhost:3000')
  const origins = corsOrigin
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)

  return [
    'strapi::logger',
    'strapi::errors',
    'strapi::security',
    {
      name: 'strapi::cors',
      config: {
        headers: '*',
        origin: origins.length > 0 ? origins : ['http://localhost:3000', 'http://localhost:3001'],
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ]
}
