/**
 * Copy show.description into shortDescription when short is empty, then
 * editors only maintain the short field (long description is removed from schema).
 */

const SHORT_MAX = 200

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd()
}

export async function migrateShowShortDescriptions(strapi: any): Promise<{ migrated: number }> {
  const knex = strapi.db.connection
  const hasDescription = await knex.schema.hasColumn('shows', 'description')
  if (!hasDescription) {
    return { migrated: 0 }
  }

  const rows: Array<{ id: number; description?: string | null; short_description?: string | null }> =
    await knex('shows').select('id', 'description', 'short_description')

  let migrated = 0
  for (const row of rows) {
    const short = String(row.short_description || '').trim()
    const long = String(row.description || '').trim()
    if (short || !long) continue
    await knex('shows').where({ id: row.id }).update({
      short_description: clip(long, SHORT_MAX),
    })
    migrated += 1
  }

  return { migrated }
}
