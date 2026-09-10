/**
 * Auto-fill providerExternalKey = provider:externalId for uniqueness.
 */
export default {
  async beforeCreate(event) {
    const { data } = event.params
    if (data?.provider && data?.externalId && !data.providerExternalKey) {
      data.providerExternalKey = `${data.provider}:${data.externalId}`
    }
  },
  async beforeUpdate(event) {
    const { data } = event.params
    if (data?.provider && data?.externalId) {
      data.providerExternalKey = `${data.provider}:${data.externalId}`
    }
  },
}
