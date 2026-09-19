/**
 * Cron helper: send newsletter campaigns whose scheduledSendAt is due.
 */
export async function sendDueNewsletterCampaigns(strapi: any): Promise<number> {
  const service = strapi.service('api::newsletter-campaign.newsletter-campaign')
  if (!service?.sendDueCampaigns) return 0
  return service.sendDueCampaigns()
}
