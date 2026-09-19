import { factories } from '@strapi/strapi'
import { buildNewsletterEmail } from '../../../utils/blocks-to-email-html'
import { createUnsubscribeToken } from '../../../utils/unsubscribe-token'

const CAMPAIGN_UID = 'api::newsletter-campaign.newsletter-campaign' as const
const SUB_UID = 'api::newsletter-subscription.newsletter-subscription' as const

const SENDABLE_STATUSES = new Set(['draft', 'scheduled', 'failed'])
const CONCURRENCY = 5

type CampaignRow = {
  documentId: string
  subject?: string
  previewText?: string | null
  content?: unknown
  status?: string
  scheduledSendAt?: string | Date | null
}

type SubscriberRow = {
  documentId: string
  email: string
  unsubscribeToken?: string | null
}

function emailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim() || process.env.SMTP_HOST?.trim())
}

function frontofficeUrl(): string {
  return String(process.env.FRONTOFFICE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

async function ensureSubscriberToken(strapi: any, row: SubscriberRow): Promise<string> {
  if (row.unsubscribeToken) return String(row.unsubscribeToken)
  const token = createUnsubscribeToken()
  await strapi.documents(SUB_UID).update({
    documentId: row.documentId,
    data: { unsubscribeToken: token } as never,
  })
  return token
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

export default factories.createCoreService(CAMPAIGN_UID, ({ strapi }) => ({
  async getCampaign(documentId: string): Promise<CampaignRow | null> {
    const row = await strapi.documents(CAMPAIGN_UID).findOne({
      documentId,
      fields: [
        'documentId',
        'subject',
        'previewText',
        'content',
        'status',
        'scheduledSendAt',
        'recipientCount',
        'successCount',
        'failureCount',
        'lastError',
        'sentAt',
      ],
    })
    return (row as CampaignRow) || null
  },

  async scheduleCampaign(documentId: string, scheduledSendAt: string) {
    const campaign = await this.getCampaign(documentId)
    if (!campaign) throw new Error('Campaign not found.')
    if (!SENDABLE_STATUSES.has(String(campaign.status))) {
      throw new Error(`Cannot schedule a campaign in status "${campaign.status}".`)
    }
    const when = new Date(scheduledSendAt)
    if (Number.isNaN(when.getTime())) {
      throw new Error('Invalid scheduledSendAt.')
    }
    if (when.getTime() <= Date.now()) {
      throw new Error('scheduledSendAt must be in the future.')
    }

    return strapi.documents(CAMPAIGN_UID).update({
      documentId,
      data: {
        status: 'scheduled',
        scheduledSendAt: when.toISOString(),
        lastError: null,
      } as never,
    })
  },

  async cancelSchedule(documentId: string) {
    const campaign = await this.getCampaign(documentId)
    if (!campaign) throw new Error('Campaign not found.')
    if (campaign.status !== 'scheduled') {
      throw new Error('Only scheduled campaigns can be cancelled.')
    }
    return strapi.documents(CAMPAIGN_UID).update({
      documentId,
      data: {
        status: 'draft',
        scheduledSendAt: null,
      } as never,
    })
  },

  async sendTest(documentId: string, toEmail: string) {
    if (!emailConfigured()) {
      throw new Error('Email delivery is not configured (set BREVO_API_KEY or SMTP_HOST).')
    }
    const email = String(toEmail || '')
      .trim()
      .toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid test email address.')
    }

    const campaign = await this.getCampaign(documentId)
    if (!campaign) throw new Error('Campaign not found.')
    if (!campaign.subject?.trim()) throw new Error('Campaign subject is required.')

    const site = frontofficeUrl()
    const { html, text } = buildNewsletterEmail({
      subject: campaign.subject,
      previewText: campaign.previewText,
      content: campaign.content,
      unsubscribeUrl: `${site}/unsubscribe?token=preview`,
      siteUrl: site,
    })

    await strapi.plugin('email').service('email').send({
      to: email,
      subject: `[TEST] ${campaign.subject}`,
      html,
      text,
    })

    return { ok: true, to: email }
  },

  async sendCampaign(documentId: string) {
    if (!emailConfigured()) {
      throw new Error('Email delivery is not configured (set BREVO_API_KEY or SMTP_HOST).')
    }

    const campaign = await this.getCampaign(documentId)
    if (!campaign) throw new Error('Campaign not found.')
    if (!SENDABLE_STATUSES.has(String(campaign.status))) {
      throw new Error(`Cannot send a campaign in status "${campaign.status}".`)
    }
    if (!campaign.subject?.trim()) throw new Error('Campaign subject is required.')

    await strapi.documents(CAMPAIGN_UID).update({
      documentId,
      data: {
        status: 'sending',
        lastError: null,
        successCount: 0,
        failureCount: 0,
        recipientCount: 0,
      } as never,
    })

    const subscribers = (await strapi.documents(SUB_UID).findMany({
      filters: { active: true },
      fields: ['documentId', 'email', 'unsubscribeToken'],
      limit: 10000,
    })) as unknown as SubscriberRow[]

    const recipientCount = subscribers.length
    await strapi.documents(CAMPAIGN_UID).update({
      documentId,
      data: { recipientCount } as never,
    })

    if (!recipientCount) {
      await strapi.documents(CAMPAIGN_UID).update({
        documentId,
        data: {
          status: 'failed',
          lastError: 'No active subscribers to send to.',
          sentAt: new Date().toISOString(),
        } as never,
      })
      throw new Error('No active subscribers to send to.')
    }

    const site = frontofficeUrl()

    const results = await mapPool(subscribers, CONCURRENCY, async (sub) => {
      try {
        const token = await ensureSubscriberToken(strapi, sub)
        const { html, text } = buildNewsletterEmail({
          subject: campaign.subject!,
          previewText: campaign.previewText,
          content: campaign.content,
          unsubscribeUrl: `${site}/unsubscribe?token=${encodeURIComponent(token)}`,
          siteUrl: site,
        })
        await strapi.plugin('email').service('email').send({
          to: sub.email,
          subject: campaign.subject,
          html,
          text,
        })
        return { ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        strapi.log.error(
          `Newsletter campaign ${documentId} send failed for ${sub.email}: ${message}`,
        )
        return { ok: false as const, error: message }
      }
    })

    const successCount = results.filter((r) => r.ok).length
    const failureCount = results.length - successCount
    const lastError =
      results.find((r): r is { ok: false; error: string } => !r.ok)?.error || null

    const finalStatus = successCount > 0 ? 'sent' : 'failed'
    const updated = await strapi.documents(CAMPAIGN_UID).update({
      documentId,
      data: {
        status: finalStatus,
        successCount,
        failureCount,
        recipientCount,
        sentAt: new Date().toISOString(),
        scheduledSendAt: null,
        lastError: successCount > 0 && failureCount === 0 ? null : lastError,
      } as never,
    })

    return {
      documentId,
      status: finalStatus,
      recipientCount,
      successCount,
      failureCount,
      campaign: updated,
    }
  },

  async sendDueCampaigns(): Promise<number> {
    const now = new Date()
    const due = (await strapi.documents(CAMPAIGN_UID).findMany({
      filters: {
        status: 'scheduled',
        scheduledSendAt: { $notNull: true, $lte: now.toISOString() },
      },
      fields: ['documentId', 'status', 'scheduledSendAt'],
      limit: 10,
    })) as unknown as CampaignRow[]

    if (!due?.length) return 0

    let sent = 0
    for (const row of due) {
      const documentId = String(row.documentId || '')
      if (!documentId) continue
      try {
        await this.sendCampaign(documentId)
        sent += 1
      } catch (error) {
        strapi.log.error(
          `Scheduled newsletter campaign ${documentId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    return sent
  },
}))
