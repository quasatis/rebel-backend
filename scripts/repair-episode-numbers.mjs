/**
 * One-shot: renumber show episodes by YouTube release date
 * (media_sources.rawMeta.publishedAt), oldest = 1.
 * Also repairs sync-stamped show_episodes.published_at.
 *
 * Usage: node scripts/repair-episode-numbers.mjs
 */
import { createConnection } from 'mysql2/promise'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (!m) continue
    const key = m[1].trim()
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

function releaseMs(row) {
  let raw = null
  const meta = row.raw_meta
  if (meta) {
    try {
      const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
      if (typeof parsed?.publishedAt === 'string' && parsed.publishedAt.trim()) {
        raw = parsed.publishedAt.trim()
      }
    } catch {
      /* ignore */
    }
  }
  if (raw) {
    const ms = Date.parse(raw)
    if (Number.isFinite(ms)) return { ms, youtube: raw }
  }
  const cms = row.published_at ? Date.parse(row.published_at) : NaN
  if (Number.isFinite(cms)) return { ms: cms, youtube: null }
  const created = row.created_at ? Date.parse(row.created_at) : NaN
  if (Number.isFinite(created)) return { ms: created, youtube: null }
  return { ms: Number.POSITIVE_INFINITY, youtube: null }
}

const conn = await createConnection({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 3306),
  user: process.env.DATABASE_USERNAME || 'strapi',
  password: process.env.DATABASE_PASSWORD || 'strapi',
  database: process.env.DATABASE_NAME || 'rebelafrique',
})

try {
  const [tables] = await conn.query(`SHOW TABLES`)
  const names = tables.map((r) => Object.values(r)[0])
  const episodeTable =
    names.find((n) => n === 'show_episodes') ||
    names.find((n) => String(n).includes('show_episode') && !String(n).includes('cmps') && !String(n).includes('lnk'))
  const mediaTable =
    names.find((n) => n === 'media_sources') ||
    names.find((n) => String(n).includes('media_source') && !String(n).includes('cmps') && !String(n).includes('lnk'))
  const linkTable =
    names.find((n) => n === 'show_episodes_media_source_lnk') ||
    names.find((n) => String(n).includes('show_episodes') && String(n).includes('media_source'))
  const showLink =
    names.find((n) => n === 'show_episodes_show_lnk') ||
    names.find((n) => String(n).includes('show_episodes') && String(n).includes('show_lnk'))

  if (!episodeTable || !mediaTable || !linkTable || !showLink) {
    console.error('Could not resolve tables', { episodeTable, mediaTable, linkTable, showLink, names })
    process.exit(1)
  }

  console.log('Using tables', { episodeTable, mediaTable, linkTable, showLink })

  const [showRows] = await conn.query(`
    SELECT DISTINCT sl.show_id AS show_id
    FROM \`${showLink}\` sl
  `)

  let numbered = 0
  let datesFixed = 0

  for (const { show_id: showId } of showRows) {
    const [eps] = await conn.query(
      `
      SELECT
        e.id,
        e.document_id,
        e.episode_number,
        e.published_at,
        e.created_at,
        m.raw_meta
      FROM \`${episodeTable}\` e
      INNER JOIN \`${showLink}\` sl ON sl.show_episode_id = e.id
      LEFT JOIN \`${linkTable}\` ml ON ml.show_episode_id = e.id
      LEFT JOIN \`${mediaTable}\` m ON m.id = ml.media_source_id
      WHERE sl.show_id = ?
        AND e.published_at IS NOT NULL
      ORDER BY e.id ASC
      `,
      [showId],
    )

    const sortable = eps.map((row) => {
      const { ms, youtube } = releaseMs(row)
      return { ...row, ms, youtube }
    })
    sortable.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.id - b.id))

    for (let i = 0; i < sortable.length; i += 1) {
      const next = i + 1
      const row = sortable[i]
      if (row.episode_number !== next) {
        await conn.query(`UPDATE \`${episodeTable}\` SET episode_number = ? WHERE id = ?`, [
          next,
          row.id,
        ])
        numbered += 1
      }
      if (row.youtube) {
        const cmsMs = row.published_at ? Date.parse(row.published_at) : NaN
        const createdMs = row.created_at ? Date.parse(row.created_at) : NaN
        const youtubeMs = row.ms
        const looksLikeSyncStamp =
          !Number.isFinite(cmsMs) ||
          (Number.isFinite(createdMs) && Math.abs(cmsMs - createdMs) < 5000)
        const drifted =
          Number.isFinite(cmsMs) &&
          Number.isFinite(youtubeMs) &&
          Math.abs(cmsMs - youtubeMs) > 60_000
        if (looksLikeSyncStamp || drifted) {
          const iso = new Date(row.youtube).toISOString().slice(0, 19).replace('T', ' ')
          await conn.query(`UPDATE \`${episodeTable}\` SET published_at = ? WHERE id = ?`, [
            iso,
            row.id,
          ])
          datesFixed += 1
        }
      }
    }
  }

  console.log(JSON.stringify({ shows: showRows.length, numbered, datesFixed }, null, 2))
} finally {
  await conn.end()
}
