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
| `CLOUDINARY_NAME` | Cloudinary cloud name (required for media uploads) |
| `CLOUDINARY_KEY` | Cloudinary API key |
| `CLOUDINARY_SECRET` | Cloudinary API secret |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `CONTACT_TO` / `CONTACT_FROM` | Contact form recipient / sender (default `team@quasatis.com`) |
| `BREVO_API_KEY` | Brevo Transactional API key (preferred email provider) |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Brevo default from address / display name |
| `BACKOFFICE_URL` | Backoffice origin for invite magic links (e.g. `http://localhost:3001`) |
| `FRONTOFFICE_URL` | Public site origin for newsletter unsubscribe links (e.g. `http://localhost:3000`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Fallback Nodemailer SMTP when Brevo is unset |
| `NETLIFY_BUILD_HOOK_URL` | Trigger frontend rebuilds |
| `CORS_ORIGIN` | Comma-separated frontend origins |

New media uploads are stored in Cloudinary when these variables are set. Legacy files uploaded before Cloudinary was configured remain on the local `public/uploads` volume and are still served at `/uploads/...` URLs.

Uploads are organized in Cloudinary folders by site section: `Home`, `Music`, `Shows`, `News`, `Studio`, `Events`, `About`, and `General` (fallback for Strapi Admin uploads).

3. Build and start:

```bash
docker compose up --build -d
```

4. Open (default Docker host mappings avoid busy local ports):

- Admin: http://localhost:1337/admin
- API: http://localhost:1337/api
- MySQL host port: `3307` → container `3306`

Create the first Strapi **Admin** user at http://localhost:1337/admin (system admin).

Bootstrap always creates Users & Permissions roles/users for the custom backoffice (`:3001/login` — not Strapi Admin):

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@rebelafrique.com` | `RebelAdmin123!` |
| Editor | `editor@rebelafrique.com` | `RebelEditor123!` |
| Viewer (read-only) | `viewer@rebelafrique.com` | `RebelViewer123!` |

Seeded accounts are create-if-missing: existing users are never role/blocked/email-rewritten on restart. Passwords are kept unless the account is missing `provider`/`password` (e.g. after a DB repair), or you set `FORCE_SEED_USER_PASSWORDS=true`. Admins manage additional users from the custom backoffice **Users** page (invite magic links via Brevo when `BREVO_API_KEY` is set).

Strapi **Admin** (system) remains at http://localhost:1337/admin and is separate from these accounts.

When `SEED_DEMO_CONTENT=true`, bootstrap creates demo editorial content **once** (store marker `rebel_seed.demo_content`). Existing documents are never updated; deleted seed rows are not recreated. Set `FORCE_SEED_DEMO_CONTENT=true` only when you intentionally want a full re-seed.

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

`type` optional: `article` | `artist` | `event` | `show` | `episode` | `studio-video` | `playlist` | `music` (alias: `music-release`) | omit for all

### Manual YouTube sync

```http
POST /api/youtube-sources/:documentId/sync
```

Requires an authenticated API token / JWT (custom backoffice). Hourly cron also syncs sources with `active` + `syncEnabled`.

Supported `sourceType` values: `channel`, `playlist`, `video`, `username` (YouTube `@handle` or legacy username via the `username` field).

Upsert is idempotent by `youtubeVideoId` and creates/updates linked `media-source` rows (`rawMeta` stores provider extras; uniqueness via `providerExternalKey`).

## Bootstrap permissions

On startup, the **public** role gets `find` / `findOne` on published-facing content types (including `media-source` for embed populate), plus `create` for newsletter subscriptions. **Public does not** get `synced-video` or `youtube-source`. Authenticated (demo editor) gets full CRUD + YouTube sync.

Backoffice users: see table under Quick start (Admin / Editor / Viewer).

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
