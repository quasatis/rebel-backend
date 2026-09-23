/**
 * Copy local Rebel of the Week entries to another Strapi (usually production).
 *
 * Usage:
 *   REBEL_PROD_TOKEN=<jwt> node scripts/push-local-rebel-weeks.mjs
 *
 * Optional env:
 *   LOCAL_API=http://localhost:1337/api
 *   TARGET_API=https://rebel-backend-production.up.railway.app/api
 *   SLUGS=tyla
 *
 * JWT: log into the production backoffice → DevTools → Application →
 * Local Storage → rebel_backoffice_jwt
 */
const LOCAL_API = (process.env.LOCAL_API || 'http://localhost:1337/api').replace(/\/$/, '')
const TARGET_API = (
  process.env.TARGET_API || 'https://rebel-backend-production.up.railway.app/api'
).replace(/\/$/, '')
const TOKEN = String(process.env.REBEL_PROD_TOKEN || '').trim()
const SLUGS = String(process.env.SLUGS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!TOKEN) {
  console.error('Missing REBEL_PROD_TOKEN. Copy rebel_backoffice_jwt from the production backoffice.')
  process.exit(1)
}

function sanitizeMedia(value) {
  if (!value || typeof value !== 'object') return null
  const url = typeof value.url === 'string' ? value.url : ''
  if (!url) return null
  return {
    url,
    alternativeText: value.alternativeText ?? null,
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function sanitizeSections(sections) {
  if (!Array.isArray(sections)) return []
  return sections.map((section) => {
    const next = { ...section }
    if ('image' in next) next.image = sanitizeMedia(next.image)
    if ('stats' in next) next.stats = asArray(next.stats)
    if ('milestones' in next) next.milestones = asArray(next.milestones)
    if ('tracks' in next) next.tracks = asArray(next.tracks)
    if ('awards' in next) next.awards = asArray(next.awards)
    if ('items' in next) next.items = asArray(next.items)
    return next
  })
}

function toPayload(row) {
  return {
    slug: row.slug,
    weekStartsAt: row.weekStartsAt,
    weekLabel: row.weekLabel || '001',
    seoTitle: row.seoTitle || '',
    seoDescription: row.seoDescription || '',
    heroName: row.heroName || row.slug,
    sections: sanitizeSections(row.sections),
  }
}

async function api(base, path, { method = 'GET', token, body, query } = {}) {
  const qs = query
    ? `?${new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ).toString()}`
    : ''
  const res = await fetch(`${base}/${path.replace(/^\//, '')}${qs}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const message = json?.error?.message || json?.raw || res.statusText
    const err = new Error(`${method} ${path} → ${res.status} ${message}`)
    err.status = res.status
    throw err
  }
  return json
}

const local = await api(LOCAL_API, 'rebel-of-the-weeks', {
  query: { 'pagination[pageSize]': '50', 'populate[0]': 'artist' },
})
const rows = (local.data || []).filter((row) => !SLUGS.length || SLUGS.includes(row.slug))
if (!rows.length) {
  console.error('No local rebel-of-the-weeks matched.')
  process.exit(1)
}

const remote = await api(TARGET_API, 'rebel-of-the-weeks', {
  token: TOKEN,
  query: { 'pagination[pageSize]': '100', status: 'published' },
})
const remoteBySlug = new Map((remote.data || []).map((row) => [row.slug, row]))

const results = []
for (const row of rows) {
  const payload = toPayload(row)
  const existing = remoteBySlug.get(row.slug)
  try {
    if (existing?.documentId) {
      const updated = await api(TARGET_API, `rebel-of-the-weeks/${existing.documentId}`, {
        method: 'PUT',
        token: TOKEN,
        query: { status: 'published' },
        body: { data: payload },
      })
      results.push({
        action: 'updated',
        slug: row.slug,
        documentId: updated?.data?.documentId || existing.documentId,
        sections: payload.sections.length,
      })
    } else {
      const created = await api(TARGET_API, 'rebel-of-the-weeks', {
        method: 'POST',
        token: TOKEN,
        query: { status: 'published' },
        body: { data: payload },
      })
      results.push({
        action: 'created',
        slug: row.slug,
        documentId: created?.data?.documentId,
        sections: payload.sections.length,
      })
    }
  } catch (error) {
    results.push({ action: 'failed', slug: row.slug, error: error.message })
  }
}

console.log(JSON.stringify({ local: rows.map((r) => r.slug), target: TARGET_API, results }, null, 2))
if (results.some((r) => r.action === 'failed')) process.exit(1)
