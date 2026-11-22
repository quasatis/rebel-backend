/**
 * Auto-fill providerExternalKey = provider:externalId for uniqueness.
 * Note: Strapi 5 REST create validates required fields before this runs;
 * the media-source controller also sets the key for API creates/updates.
 */

function providerExternalKeyFromData(data: Record<string, unknown>): string | null {
  const provider = String(data.provider || '').trim().toLowerCase()
  const externalId = String(data.externalId || '').trim()
  if (!provider || !externalId) return null
  if (provider === 'vimeo') {
    const type = String(
      (data.rawMeta && typeof data.rawMeta === 'object'
        ? (data.rawMeta as { type?: unknown }).type
        : '') || '',
    )
      .trim()
      .toLowerCase()
    return type === 'showcase' ? `vimeo:showcase:${externalId}` : `vimeo:${externalId}`
  }
  return `${provider}:${externalId}`
}

export default {
  async beforeCreate(event) {
    const { data } = event.params
    const key = data ? providerExternalKeyFromData(data) : null
    if (data && key && !data.providerExternalKey) {
      data.providerExternalKey = key
    }
    if (data && !data.origin) data.origin = 'manual'
  },
  async beforeUpdate(event) {
    const { data } = event.params
    const key = data ? providerExternalKeyFromData(data) : null
    if (data && key) {
      data.providerExternalKey = key
    }
  },
}
