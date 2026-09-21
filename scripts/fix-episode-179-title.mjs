/**
 * Fix EP179 title to match current YouTube title for video KoAeX65M1f0.
 * Usage: DATABASE_HOST=127.0.0.1 DATABASE_PORT=3307 node scripts/fix-episode-179-title.mjs
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

const TITLE = 'Fly Podcast S.O.S Bebucho Que Kuia #444'
const VIDEO_ID = 'KoAeX65M1f0'

const conn = await createConnection({
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT || 3307),
  user: process.env.DATABASE_USERNAME || 'strapi',
  password: process.env.DATABASE_PASSWORD || 'strapi',
  database: process.env.DATABASE_NAME || 'rebelafrique',
})

try {
  const [media] = await conn.query(
    `UPDATE media_sources SET title = ? WHERE provider = 'youtube' AND external_id = ?`,
    [TITLE, VIDEO_ID],
  )
  const [eps] = await conn.query(
    `UPDATE show_episodes e
     INNER JOIN show_episodes_media_source_lnk ml ON ml.show_episode_id = e.id
     INNER JOIN media_sources m ON m.id = ml.media_source_id
     SET e.title = ?
     WHERE m.external_id = ?`,
    [TITLE, VIDEO_ID],
  )
  const [synced] = await conn.query(
    `UPDATE synced_videos SET title = ? WHERE youtube_video_id = ?`,
    [TITLE, VIDEO_ID],
  )
  console.log(JSON.stringify({ media, eps, synced, title: TITLE }, null, 2))
} finally {
  await conn.end()
}
