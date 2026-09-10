# REBEL AFRIQUE Backend

Strapi 5 + MySQL 8 CMS API for REBEL AFRIQUE, packaged with Docker Compose.

## Stack

- **Strapi** 5 (TypeScript)
- **MySQL** 8
- **Docker** / Docker Compose
- YouTube Data API v3 sync (hourly cron + manual endpoint)
- Netlify build hook on content publish
- Public search endpoint

## Quick start (Docker)

1. Copy environment file and set secrets:

```bash
cp .env.example .env
```

Generate unique values for `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, and `JWT_SECRET` before production use.

2. Optional integrations in `.env`:

| Variable | Purpose |
|----------|---------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `NETLIFY_BUILD_HOOK_URL` | Trigger frontend rebuilds |
| `CORS_ORIGIN` | Comma-separated frontend origins |

3. Build and start:

```bash
docker compose up --build -d
```

4. Open (default Docker host mappings avoid busy local ports):

- Admin: http://localhost:1338/admin
- API: http://localhost:1338/api
- MySQL host port: `3307` → container `3306`

Create the first Strapi **Admin** user at http://localhost:1338/admin (system admin).

When `SEED_DEMO_CONTENT=true`, bootstrap also creates:
- Demo editorial content (article, artist, release, show, studio video, event, homepage feature)
- A users-permissions editor for the custom backoffice (see seed log / `src/index.ts`)

Backoffice: http://localhost:3001/login

### Compose helpers

```bash
docker compose logs -f strapi
docker compose logs -f mysql
docker compose down
docker compose down -v   # also deletes MySQL + uploads volumes
```

## Local development

Requirements: Node 20+, MySQL 8.

```bash
cp .env.example .env
# If only MySQL runs in Docker:
docker compose up -d mysql
# Point DATABASE_HOST=127.0.0.1 in .env

npm install
npm run develop
```

## Content types (21)

| API | Kind | Draft/Publish |
|-----|------|---------------|
| `article` | collection | yes |
| `category`, `tag`, `author` | collection | no |
| `artist`, `music-release`, `track`, `playlist` | collection | track no / others yes |
| `show`, `show-episode` | collection | yes |
| `studio-video`, `video-collection` | collection | yes |
| `event`, `venue`, `event-category` | collection | event yes / others no |
| `media-source` | collection | no — unique `providerExternalKey` (`provider:externalId`) |
| `youtube-source`, `synced-video` | collection | no |
| `homepage-feature` | collection | no |
| `newsletter-config` | **single** | no |
| `newsletter-subscription` | collection | no |

## Custom API routes

### Search

```http
GET /api/search?q=afrobeats&type=article&page=1&pageSize=25
```

`type` optional: `article` | `artist` | `event` | `show` | `studio-video` | `playlist` | `music-release` | `all`

### Manual YouTube sync

```http
POST /api/youtube-sources/:documentId/sync
```

Requires an authenticated API token / admin session. Hourly cron also syncs sources with `active` + `syncEnabled`.

Upsert is idempotent by `youtubeVideoId` and creates/updates linked `media-source` rows.

## Bootstrap permissions

On startup, the **public** role gets `find` / `findOne` on public content types, plus `create` for newsletter subscriptions. Users APIs and YouTube source write/sync actions are **not** granted to public.

## Project layout

```
config/                 # database, server (cron), admin, api, middlewares, plugins
src/api/*/content-types # schemas
src/api/youtube-source/services/
  youtube.ts            # YouTube Data API v3 client
  youtube-normalizer.ts # payload → entity shapes
  youtube-sync.ts       # idempotent upsert + syncAll
src/api/search/         # GET /api/search
src/index.ts            # public permissions + Netlify hooks
Dockerfile
docker-compose.yml
```

## Volumes & health

- Volumes: `mysql_data`, `strapi_uploads`
- MySQL healthcheck via `mysqladmin ping`
- Strapi waits for healthy MySQL; healthcheck hits `/_health`
