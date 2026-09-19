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
  // Email provider priority: Brevo API → SMTP nodemailer → Strapi default sendmail.
  ...(env('BREVO_API_KEY')
    ? {
        email: {
          config: {
            provider: 'strapi-provider-email-brevo',
            providerOptions: {
              apiKey: env('BREVO_API_KEY'),
              defaultFromName: env('BREVO_SENDER_NAME', 'REBEL AFRIQUE'),
            },
            settings: {
              defaultFrom: env(
                'BREVO_SENDER_EMAIL',
                env('CONTACT_FROM', 'team@quasatis.com'),
              ),
              defaultFromName: env('BREVO_SENDER_NAME', 'REBEL AFRIQUE'),
              defaultReplyTo: env(
                'BREVO_SENDER_EMAIL',
                env('CONTACT_FROM', 'team@quasatis.com'),
              ),
            },
          },
        },
      }
    : env('SMTP_HOST')
      ? {
          email: {
            config: {
              provider: 'nodemailer',
              providerOptions: {
                host: env('SMTP_HOST'),
                port: env.int('SMTP_PORT', 587),
                secure: env.bool('SMTP_SECURE', false),
                auth: env('SMTP_USER')
                  ? {
                      user: env('SMTP_USER'),
                      pass: env('SMTP_PASS'),
                    }
                  : undefined,
              },
              settings: {
                defaultFrom: env('CONTACT_FROM', 'team@quasatis.com'),
                defaultReplyTo: env('CONTACT_FROM', 'team@quasatis.com'),
              },
            },
          },
        }
      : {}),
  upload: {
    config: {
      sizeLimit: 10 * 1024 * 1024, // 10 MB
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
