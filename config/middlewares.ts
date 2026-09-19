export default ({ env }) => {
  const corsOrigin = env('CORS_ORIGIN', 'http://localhost:3000')
  const origins = corsOrigin
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', 'res.cloudinary.com'],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'market-assets.strapi.io',
              'res.cloudinary.com',
            ],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        headers: '*',
        origin: origins.length > 0 ? origins : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    {
      name: 'strapi::body',
      config: {
        formidable: {
          maxFileSize: 2 * 1024 * 1024, // 2 MB
        },
      },
    },
    'global::upload-folder',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ]
}
