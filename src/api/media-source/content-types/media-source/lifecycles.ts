/**
 * Auto-fill providerExternalKey = provider:externalId for uniqueness.
 * Note: Strapi 5 REST create validates required fields before this runs;
 * the media-source controller also sets the key for API creates/updates.
 */
export default {
  async beforeCreate(event) {
    const { data } = event.params
    if (data?.provider && data?.externalId && !data.providerExternalKey) {
      data.providerExternalKey = `${data.provider}:${data.externalId}`
    }
    if (data && !data.origin) data.origin = 'manual'
  },
  async beforeUpdate(event) {
    const { data } = event.params
    if (data?.provider && data?.externalId) {
      data.providerExternalKey = `${data.provider}:${data.externalId}`
    }
  },
}
