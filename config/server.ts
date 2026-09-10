export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: true,
    tasks: {
      youtubeSyncHourly: {
        task: async ({ strapi }) => {
          try {
            const youtubeSync = strapi.service('api::youtube-source.youtube-sync')
            if (youtubeSync?.syncAllEnabledSources) {
              await youtubeSync.syncAllEnabledSources()
            }
          } catch (error) {
            strapi.log.error(
              `YouTube hourly sync failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        },
        options: {
          rule: '0 * * * *',
        },
      },
    },
  },
})
