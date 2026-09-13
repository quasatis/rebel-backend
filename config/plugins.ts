import dns from 'node:dns'
import https from 'node:https'

dns.setDefaultResultOrder('ipv4first')

const cloudinaryAgent = new https.Agent({
  family: 4,
  autoSelectFamily: false,
  keepAlive: true,
})

export default ({ env }) => ({
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '7d',
      },
      jwtSecret: env('JWT_SECRET'),
    },
  },
  upload: {
    config: {
      sizeLimit: 2 * 1024 * 1024, // 2 MB
      provider: 'cloudinary',
      providerOptions: {
        cloud_name: env('CLOUDINARY_NAME'),
        api_key: env('CLOUDINARY_KEY'),
        api_secret: env('CLOUDINARY_SECRET'),
      },
      actionOptions: {
        upload: { folder: 'General', agent: cloudinaryAgent },
        uploadStream: { folder: 'General', agent: cloudinaryAgent },
        delete: { agent: cloudinaryAgent },
      },
    },
  },
})
