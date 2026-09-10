export default ({ env }) => ({
  connection: {
    client: env('DATABASE_CLIENT', 'mysql'),
    connection: {
      host: env('DATABASE_HOST', 'localhost'),
      port: env.int('DATABASE_PORT', 3306),
      database: env('DATABASE_NAME', 'rebelafrique'),
      user: env('DATABASE_USERNAME', 'strapi'),
      password: env('DATABASE_PASSWORD', 'strapi'),
      ssl: env.bool('DATABASE_SSL', false) && {
        rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
      },
      charset: 'utf8mb4',
    },
    pool: {
      min: env.int('DATABASE_POOL_MIN', 0),
      max: env.int('DATABASE_POOL_MAX', 10),
    },
    acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
  },
})
