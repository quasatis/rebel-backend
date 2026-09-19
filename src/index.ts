import dns from 'node:dns'
import type { Core } from '@strapi/strapi'

// Docker Desktop on Windows advertises NAT64 IPv6 for Cloudinary that is unreachable.
dns.setDefaultResultOrder('ipv4first')

const CONTENT_UIDS = [
  'api::article.article',
  'api::category.category',
  'api::tag.tag',
  'api::author.author',
  'api::artist.artist',
  'api::music-release.music-release',
  'api::track.track',
  'api::playlist.playlist',
  'api::show.show',
  'api::show-episode.show-episode',
  'api::studio-video.studio-video',
  'api::video-collection.video-collection',
  'api::event.event',
  'api::venue.venue',
  'api::event-category.event-category',
  'api::media-source.media-source',
  'api::homepage-feature.homepage-feature',
  'api::homepage-settings.homepage-settings',
  'api::launch-settings.launch-settings',
  'api::about-page.about-page',
  'api::newsletter-config.newsletter-config',
  'api::newsletter-subscription.newsletter-subscription',
  'api::contact-message.contact-message',
  'api::media-traffic-event.media-traffic-event',
  'api::synced-video.synced-video',
  'api::youtube-source.youtube-source',
]

async function ensurePermission(strapi: Core.Strapi, roleId: number, action: string) {
  const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
    where: { action, role: roleId },
  })
  if (!existing) {
    await strapi.db.query('plugin::users-permissions.permission').create({
      data: { action, role: roleId },
    })
  }
}

async function revokePermission(strapi: Core.Strapi, roleId: number, action: string) {
  const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
    where: { action, role: roleId },
  })
  if (existing) {
    await strapi.db.query('plugin::users-permissions.permission').delete({
      where: { id: existing.id },
    })
  }
}

async function setPublicPermissions(strapi: Core.Strapi) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  })
  if (!publicRole) return

  // Synced YouTube rows and YouTube source configs stay BO-only.
  // MediaSource stays public so FO can populate embeds on published content.
  const publicDenied = new Set([
    'api::newsletter-subscription.newsletter-subscription',
    'api::contact-message.contact-message',
    'api::media-traffic-event.media-traffic-event',
    'api::youtube-source.youtube-source',
    'api::synced-video.synced-video',
  ])

  for (const uid of CONTENT_UIDS) {
    if (publicDenied.has(uid)) continue
    for (const action of ['find', 'findOne']) {
      await ensurePermission(strapi, publicRole.id, `${uid}.${action}`)
    }
  }

  for (const uid of [
    'api::synced-video.synced-video',
    'api::youtube-source.youtube-source',
    'api::media-traffic-event.media-traffic-event',
  ]) {
    for (const action of ['find', 'findOne', 'create', 'update', 'delete']) {
      await revokePermission(strapi, publicRole.id, `${uid}.${action}`)
    }
  }

  await ensurePermission(
    strapi,
    publicRole.id,
    'api::newsletter-subscription.newsletter-subscription.create',
  )
  await ensurePermission(
    strapi,
    publicRole.id,
    'api::contact-message.contact-message.create',
  )
  await ensurePermission(
    strapi,
    publicRole.id,
    'api::media-traffic-event.media-traffic-event.create',
  )
  // Playlist detail may list synced YouTube videos without exposing synced-video find.
  await ensurePermission(strapi, publicRole.id, 'api::playlist.playlist.videos')
  await ensurePermission(strapi, publicRole.id, 'api::search.search.search')
  // Token-gated draft preview (no general status=draft on content APIs).
  await ensurePermission(strapi, publicRole.id, 'api::document-actions.document-actions.preview')
}

async function setRoleContentPermissions(
  strapi: Core.Strapi,
  roleId: number,
  mode: 'full' | 'read',
) {
  const actions =
    mode === 'full' ? ['find', 'findOne', 'create', 'update', 'delete'] : ['find', 'findOne']

  for (const uid of CONTENT_UIDS) {
    for (const action of actions) {
      await ensurePermission(strapi, roleId, `${uid}.${action}`)
    }
  }

  await ensurePermission(strapi, roleId, 'api::search.search.search')
  await ensurePermission(strapi, roleId, 'api::analytics.analytics.channelTraffic')
  await ensurePermission(strapi, roleId, 'plugin::upload.content-api.find')
  await ensurePermission(strapi, roleId, 'plugin::upload.content-api.findOne')
  await ensurePermission(strapi, roleId, 'plugin::users-permissions.user.me')

  if (mode === 'full') {
    await ensurePermission(strapi, roleId, 'api::youtube-source.youtube-source.sync')
    await ensurePermission(strapi, roleId, 'api::youtube-source.youtube-source.syncAll')
    await ensurePermission(strapi, roleId, 'api::show.show.sync')
    await ensurePermission(strapi, roleId, 'plugin::upload.content-api.upload')
    await ensurePermission(strapi, roleId, 'api::media-upload.media-upload.upload')
    await ensurePermission(strapi, roleId, 'api::document-actions.document-actions.unpublish')
    await ensurePermission(
      strapi,
      roleId,
      'api::document-actions.document-actions.setPublishDate',
    )
    await ensurePermission(
      strapi,
      roleId,
      'api::document-actions.document-actions.previewToken',
    )
  }
}

async function setAuthenticatedPermissions(strapi: Core.Strapi) {
  const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  })
  if (!authRole) return
  await setRoleContentPermissions(strapi, authRole.id, 'full')
  // YouTube source deletion is admin-only.
  await revokePermission(strapi, authRole.id, 'api::youtube-source.youtube-source.delete')
}

async function ensureRole(
  strapi: Core.Strapi,
  data: { name: string; type: string; description: string },
) {
  const existing = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: data.type },
  })
  if (existing) return existing
  return strapi.db.query('plugin::users-permissions.role').create({ data })
}

/**
 * Repair up_users columns that may have been dropped when a shallow schema.json
 * extension replaced Users & Permissions attributes.
 */
async function ensureUpUsersColumns(strapi: Core.Strapi) {
  const knex = strapi.db.connection
  const database = knex.client?.database?.() || process.env.DATABASE_NAME || 'rebelafrique'

  let existing: Set<string>
  try {
    const rows = await knex('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: database, TABLE_NAME: 'up_users' })
      .select('COLUMN_NAME')
    existing = new Set(rows.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME))
  } catch (error) {
    strapi.log.warn(
      `Could not inspect up_users columns: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    )
    return
  }

  if (!existing.size) {
    strapi.log.warn('up_users table not found yet; skipping column repair.')
    return
  }

  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'provider', ddl: '`provider` varchar(255) NULL' },
    { name: 'password', ddl: '`password` varchar(255) NULL' },
    { name: 'resetPasswordToken', ddl: '`resetPasswordToken` varchar(255) NULL' },
    { name: 'confirmationToken', ddl: '`confirmationToken` varchar(255) NULL' },
    { name: 'confirmed', ddl: '`confirmed` tinyint(1) NULL DEFAULT 0' },
    { name: 'blocked', ddl: '`blocked` tinyint(1) NULL DEFAULT 0' },
    { name: 'firstName', ddl: '`firstName` varchar(255) NULL' },
    { name: 'lastName', ddl: '`lastName` varchar(255) NULL' },
    { name: 'inviteTokenHash', ddl: '`inviteTokenHash` varchar(255) NULL' },
    { name: 'inviteExpiresAt', ddl: '`inviteExpiresAt` datetime NULL' },
    { name: 'invitePending', ddl: '`invitePending` tinyint(1) NULL DEFAULT 0' },
    { name: 'totpSecretEnc', ddl: '`totpSecretEnc` longtext NULL' },
    { name: 'totpEnabled', ddl: '`totpEnabled` tinyint(1) NULL DEFAULT 0' },
    { name: 'emailMfaEnabled', ddl: '`emailMfaEnabled` tinyint(1) NULL DEFAULT 0' },
    { name: 'backupCodesHash', ddl: '`backupCodesHash` longtext NULL' },
    { name: 'emailOtpHash', ddl: '`emailOtpHash` varchar(255) NULL' },
    { name: 'emailOtpExpiresAt', ddl: '`emailOtpExpiresAt` datetime NULL' },
  ]

  for (const column of columns) {
    if (existing.has(column.name)) continue
    try {
      await knex.raw(`ALTER TABLE \`up_users\` ADD COLUMN ${column.ddl}`)
      strapi.log.info(`Restored missing up_users.${column.name} column`)
    } catch (error) {
      strapi.log.warn(
        `Could not add up_users.${column.name}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }
  }
}

async function ensureBackofficeUser(
  strapi: Core.Strapi,
  data: {
    username: string
    email: string
    password: string
    roleId: number
    firstName?: string
    lastName?: string
  },
) {
  const userService = strapi.plugin('users-permissions').service('user')
  const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: {
      $or: [{ email: data.email }, { username: data.username }],
    },
  })

  const firstName = String(data.firstName || '').trim() || null
  const lastName = String(data.lastName || '').trim() || null

  if (!existing) {
    const created = await userService.add({
      username: data.username,
      email: data.email,
      password: data.password,
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: data.roleId,
      firstName,
      lastName,
    })
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: created.id },
      data: { invitePending: false, firstName, lastName },
    })
    strapi.log.info(`Created backoffice user: ${data.email}`)
    return
  }

  const providerMissing = !existing.provider || String(existing.provider).trim() === ''
  const passwordMissing = !existing.password
  const forcePasswordReset = process.env.FORCE_SEED_USER_PASSWORDS === 'true'
  // Restore credentials after schema/column repair, or when explicitly forced.
  const shouldResetPassword = passwordMissing || providerMissing || forcePasswordReset
  const needsNameBackfill =
    Boolean(firstName || lastName) &&
    (!String(existing.firstName || '').trim() || !String(existing.lastName || '').trim())

  const patch: Record<string, unknown> = {
    username: data.username,
    email: data.email,
    provider: 'local',
    confirmed: true,
    blocked: false,
    role: data.roleId,
  }
  if (shouldResetPassword) {
    patch.password = data.password
  }
  if (needsNameBackfill) {
    if (firstName) patch.firstName = firstName
    if (lastName) patch.lastName = lastName
  }

  await userService.edit(existing.id, patch)
  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: existing.id },
    data: {
      invitePending: false,
      ...(needsNameBackfill
        ? {
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
          }
        : {}),
    },
  })
  strapi.log.info(
    shouldResetPassword
      ? `Repaired backoffice user credentials: ${data.email}`
      : `Updated backoffice user (password kept): ${data.email}`,
  )
}

async function seedBackofficeUsers(strapi: Core.Strapi) {
  await ensureUpUsersColumns(strapi)

  // Strapi local auth requires provider='local'. Backfill null/empty after column repair.
  try {
    const knex = strapi.db.connection
    await knex('up_users')
      .whereNull('provider')
      .orWhere('provider', '')
      .update({ provider: 'local' })
  } catch (error) {
    strapi.log.warn(
      `Provider backfill skipped: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }

  const adminRole = await ensureRole(strapi, {
    name: 'Admin',
    type: 'admin',
    description: 'Full backoffice access',
  })
  const editorRole = await ensureRole(strapi, {
    name: 'Editor',
    type: 'editor',
    description: 'Create and edit content',
  })
  const viewerRole = await ensureRole(strapi, {
    name: 'Viewer',
    type: 'viewer',
    description: 'Read-only backoffice access',
  })

  await setRoleContentPermissions(strapi, adminRole.id, 'full')
  await setRoleContentPermissions(strapi, editorRole.id, 'full')
  await setRoleContentPermissions(strapi, viewerRole.id, 'read')
  // Editors can manage sources, but only admins may delete them.
  await revokePermission(strapi, editorRole.id, 'api::youtube-source.youtube-source.delete')
  await ensurePermission(strapi, adminRole.id, 'api::youtube-source.youtube-source.delete')

  const adminUserActions = [
    'api::backoffice-users.backoffice-users.find',
    'api::backoffice-users.backoffice-users.findOne',
    'api::backoffice-users.backoffice-users.roles',
    'api::backoffice-users.backoffice-users.create',
    'api::backoffice-users.backoffice-users.update',
    'api::backoffice-users.backoffice-users.resetPassword',
    'api::backoffice-users.backoffice-users.invite',
    'api::backoffice-users.backoffice-users.resendInvite',
  ]
  for (const action of adminUserActions) {
    await ensurePermission(strapi, adminRole.id, action)
    await revokePermission(strapi, editorRole.id, action)
    await revokePermission(strapi, viewerRole.id, action)
  }

  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  })
  if (publicRole) {
    await ensurePermission(
      strapi,
      publicRole.id,
      'api::backoffice-users.backoffice-users.inviteStatus',
    )
    await ensurePermission(
      strapi,
      publicRole.id,
      'api::backoffice-users.backoffice-users.acceptInvite',
    )
  }

  const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  })
  if (authRole) {
    for (const action of adminUserActions) {
      await revokePermission(strapi, authRole.id, action)
    }
  }

  await ensureBackofficeUser(strapi, {
    username: 'admin',
    email: 'admin@rebelafrique.com',
    password: 'RebelAdmin123!',
    roleId: adminRole.id,
    firstName: 'Admin',
    lastName: 'Rebel',
  })
  await ensureBackofficeUser(strapi, {
    username: 'editor',
    email: 'editor@rebelafrique.com',
    password: 'RebelEditor123!',
    roleId: editorRole.id,
    firstName: 'Editor',
    lastName: 'Rebel',
  })
  await ensureBackofficeUser(strapi, {
    username: 'viewer',
    email: 'viewer@rebelafrique.com',
    password: 'RebelViewer123!',
    roleId: viewerRole.id,
    firstName: 'Viewer',
    lastName: 'Rebel',
  })
}

async function seedDemoContent(strapi: Core.Strapi) {

  async function ensureDocument(
    uid: any,
    slugOrKey: string,
    lookup: Record<string, unknown>,
    data: Record<string, unknown>,
    opts: { publish?: boolean } = {},
  ) {
    const found = await strapi.documents(uid).findMany({
      filters: lookup as never,
      limit: 1,
    })
    if (found.length) return found[0]
    const created = await strapi.documents(uid).create({
      data: data as never,
      ...(opts.publish ? { status: 'published' } : {}),
    })
    strapi.log.info(`Seeded ${uid} ${slugOrKey}`)
    return created
  }

  const category = await ensureDocument(
    'api::category.category',
    'culture',
    { slug: 'culture' },
    {
      name: 'Culture',
      slug: 'culture',
      description: 'Creative culture across Africa and the diaspora.',
    },
  )

  const categoryMusic = await ensureDocument(
    'api::category.category',
    'music',
    { slug: 'music' },
    {
      name: 'Music',
      slug: 'music',
      description: 'Releases, artists, and the sound of the continent.',
    },
  )

  const categoryShows = await ensureDocument(
    'api::category.category',
    'shows',
    { slug: 'shows' },
    {
      name: 'Shows',
      slug: 'shows',
      description: 'Episodes, conversations, and performances.',
    },
  )

  const categoryNews = await ensureDocument(
    'api::category.category',
    'news',
    { slug: 'news' },
    {
      name: 'News',
      slug: 'news',
      description: 'Headlines from African and Black creative culture.',
    },
  )

  const author = await ensureDocument(
    'api::author.author',
    'rebel-desk',
    { slug: 'rebel-desk' },
    {
      name: 'Rebel Desk',
      slug: 'rebel-desk',
      bio: 'Editorial desk at REBEL AFRIQUE.',
    },
  )

  const tag = await ensureDocument(
    'api::tag.tag',
    'afrobeats',
    { slug: 'afrobeats' },
    {
      name: 'Afrobeats',
      slug: 'afrobeats',
    },
  )

  const article = await ensureDocument(
    'api::article.article',
    'the-sound-of-a-new-generation',
    { slug: 'the-sound-of-a-new-generation' },
    {
      title: 'The Sound of a New Generation',
      slug: 'the-sound-of-a-new-generation',
      excerpt: "Discover the artists shaping Africa's creative future.",
      content: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'A new wave of African creatives is rewriting the rules of music, fashion, and film.',
            },
          ],
        },
      ],
      featured: true,
      readingTime: 4,
      seoTitle: 'The Sound of a New Generation',
      seoDescription: "Discover the artists shaping Africa's creative future.",
      category: category.documentId,
      author: author.documentId,
      tags: [tag.documentId],
    },
    { publish: true },
  )

  const articleOxlade = await ensureDocument(
    'api::article.article',
    'oxlade-drops-new-single-ku-lo-sa',
    { slug: 'oxlade-drops-new-single-ku-lo-sa' },
    {
      title: "Oxlade Drops New Single 'KU LO SA'",
      slug: 'oxlade-drops-new-single-ku-lo-sa',
      excerpt: 'The Afropop star returns with a nocturnal anthem built for late drives and louder speakers.',
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'KU LO SA lands as another chapter in Oxlade’s rise across the continent and diaspora.' }],
        },
      ],
      featured: true,
      readingTime: 4,
      category: categoryMusic.documentId,
      author: author.documentId,
      tags: [tag.documentId],
    },
    { publish: true },
  )

  const articleFashion = await ensureDocument(
    'api::article.article',
    'the-new-wave-of-african-fashion-is-here',
    { slug: 'the-new-wave-of-african-fashion-is-here' },
    {
      title: 'The New Wave of African Fashion Is Here',
      slug: 'the-new-wave-of-african-fashion-is-here',
      excerpt: 'Designers across Lagos, Accra, and Johannesburg are rewriting the global runway.',
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'From atelier to street, a new generation of African fashion houses is setting the pace.' }],
        },
      ],
      featured: false,
      readingTime: 5,
      category: category.documentId,
      author: author.documentId,
    },
    { publish: true },
  )

  const articleEpisode = await ensureDocument(
    'api::article.article',
    'episode-7-the-creative-process',
    { slug: 'episode-7-the-creative-process' },
    {
      title: 'Episode 7: The Creative Process',
      slug: 'episode-7-the-creative-process',
      excerpt: 'Behind the sessions, the rituals, and the late nights that shape Rebel Shows.',
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Episode 7 opens the door on how Rebel Shows are built — from guest booking to final cut.' }],
        },
      ],
      featured: false,
      readingTime: 3,
      category: categoryShows.documentId,
      author: author.documentId,
    },
    { publish: true },
  )

  const articleAfrobeats = await ensureDocument(
    'api::article.article',
    'afrobeats-hits-a-new-global-milestone',
    { slug: 'afrobeats-hits-a-new-global-milestone' },
    {
      title: 'Afrobeats Hits a New Global Milestone',
      slug: 'afrobeats-hits-a-new-global-milestone',
      excerpt: 'Charts, streaming records, and a sound that refuses to stay in one city.',
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Afrobeats continues its worldwide run with new chart peaks and festival headline slots.' }],
        },
      ],
      featured: false,
      readingTime: 4,
      category: categoryNews.documentId,
      author: author.documentId,
      tags: [tag.documentId],
    },
    { publish: true },
  )

  const articleJayC = await ensureDocument(
    'api::article.article',
    'inside-the-studio-with-jay-c',
    { slug: 'inside-the-studio-with-jay-c' },
    {
      title: 'Inside the Studio with Jay C',
      slug: 'inside-the-studio-with-jay-c',
      excerpt: 'A quiet night session with one of the producers shaping the Rebel sound.',
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Jay C walks us through pads, percussion, and the patience behind a hit record.' }],
        },
      ],
      featured: false,
      readingTime: 6,
      category: categoryMusic.documentId,
      author: author.documentId,
    },
    { publish: true },
  )

  // Pin publishedAt order so Latest grid matches mock hierarchy (featured Oxlade first).
  const publishOrder = [
    { doc: articleOxlade, daysAgo: 1 },
    { doc: articleFashion, daysAgo: 2 },
    { doc: articleEpisode, daysAgo: 3 },
    { doc: articleAfrobeats, daysAgo: 4 },
    { doc: articleJayC, daysAgo: 5 },
    { doc: article, daysAgo: 6 },
  ]
  for (const item of publishOrder) {
    const publishedAt = new Date()
    publishedAt.setDate(publishedAt.getDate() - item.daysAgo)
    await strapi.documents('api::article.article').update({
      documentId: item.doc.documentId,
      data: { publishedAt: publishedAt.toISOString() } as never,
      status: 'published',
    })
  }

  const artist = await ensureDocument(
    'api::artist.artist',
    'oxlade',
    { slug: 'oxlade' },
    {
      name: 'Oxlade',
      slug: 'oxlade',
      biography: 'Nigerian singer and songwriter defining a new Afropop era.',
      featured: true,
      genres: ['Afropop', 'R&B'],
    },
    { publish: true },
  )

  const release = await ensureDocument(
    'api::music-release.music-release',
    'ku-lo-sa',
    { slug: 'ku-lo-sa' },
    {
      title: 'KU LO SA',
      slug: 'ku-lo-sa',
      description: 'Breakout single shaping the sound of a generation.',
      releaseType: 'single',
      releaseDate: '2026-08-29',
      featured: true,
      artist: artist.documentId,
    },
    { publish: true },
  )

  await ensureDocument(
    'api::track.track',
    'ku-lo-sa-track-1',
    { title: 'KU LO SA' },
    {
      title: 'KU LO SA',
      trackNumber: 1,
      durationSeconds: 212,
      release: release.documentId,
    },
  )

  await ensureDocument(
    'api::playlist.playlist',
    'rebel-essentials',
    { slug: 'rebel-essentials' },
    {
      title: 'Rebel Essentials',
      slug: 'rebel-essentials',
      description: 'A starter playlist of Rebel-approved cuts.',
      featured: true,
      displayOrder: 1,
      active: true,
      artist: artist.documentId,
    },
    { publish: true },
  )

  const venue = await ensureDocument(
    'api::venue.venue',
    'terra-kulture',
    { slug: 'terra-kulture' },
    {
      name: 'Terra Kulture',
      slug: 'terra-kulture',
      address: 'Plot 1376 Tiamiyu Savage Street',
      city: 'Lagos',
      country: 'Nigeria',
    },
  )

  const eventCategory = await ensureDocument(
    'api::event-category.event-category',
    'live-music',
    { slug: 'live-music' },
    {
      name: 'Live Music',
      slug: 'live-music',
    },
  )

  const start = new Date()
  start.setDate(start.getDate() + 14)
  await ensureDocument(
    'api::event.event',
    'rebel-night-lagos',
    { slug: 'rebel-night-lagos' },
    {
      title: 'Rebel Night Lagos',
      slug: 'rebel-night-lagos',
      description: 'An evening of music, film, and culture.',
      startDate: start.toISOString(),
      timezone: 'Africa/Lagos',
      city: 'Lagos',
      country: 'Nigeria',
      status: 'upcoming',
      featured: true,
      ticketLabel: 'Get tickets',
      ticketUrl: 'https://example.com/tickets',
      venue: venue.documentId,
      category: eventCategory.documentId,
    },
    { publish: true },
  )

  await ensureDocument(
    'api::youtube-source.youtube-source',
    'rebel-demo-channel',
    { displayTitle: 'Rebel Demo Channel' },
    {
      displayTitle: 'Rebel Demo Channel',
      sourceType: 'username',
      username: 'GoogleDevelopers',
      description: 'Sample username/handle source for sync smoke tests (inactive by default).',
      active: false,
      syncEnabled: false,
      syncFrequency: 'hourly',
      videosImported: 0,
      lastSyncStatus: 'seeded-inactive',
    },
  )

  const existingHeroes = await strapi.documents('api::homepage-feature.homepage-feature').findMany({
    limit: 1,
  })
  if (!existingHeroes.length) {
    await ensureDocument(
      'api::homepage-feature.homepage-feature',
      'hero-1',
      { ctaUrl: '/news/the-sound-of-a-new-generation' },
      {
        contentType: 'article',
        headline: 'The Sound of a\nNew Generation',
        description: "Discover the artists shaping Africa's creative future.",
        categoryLabel: 'Culture',
        ctaLabel: 'Explore story →',
        ctaUrl: '/news/the-sound-of-a-new-generation',
        position: 1,
        priority: 1,
        active: true,
        article: article.documentId,
      },
    )

    await ensureDocument(
      'api::homepage-feature.homepage-feature',
      'hero-2',
      { ctaUrl: '/news/oxlade-drops-new-single-ku-lo-sa' },
      {
        contentType: 'article',
        headline: "Oxlade Drops New\nSingle 'KU LO SA'",
        description: 'A nocturnal Afropop anthem built for late drives.',
        categoryLabel: 'Music',
        ctaLabel: 'Explore story →',
        ctaUrl: '/news/oxlade-drops-new-single-ku-lo-sa',
        position: 2,
        priority: 2,
        active: true,
        article: articleOxlade.documentId,
      },
    )

    await ensureDocument(
      'api::homepage-feature.homepage-feature',
      'hero-3',
      { ctaUrl: '/news/the-new-wave-of-african-fashion-is-here' },
      {
        contentType: 'article',
        headline: 'The New Wave of\nAfrican Fashion Is Here',
        description: 'Designers rewriting the global runway from Lagos to Accra.',
        categoryLabel: 'Culture',
        ctaLabel: 'Explore story →',
        ctaUrl: '/news/the-new-wave-of-african-fashion-is-here',
        position: 3,
        priority: 3,
        active: true,
        article: articleFashion.documentId,
      },
    )

    await ensureDocument(
      'api::homepage-feature.homepage-feature',
      'hero-4',
      { ctaUrl: '/news/afrobeats-hits-a-new-global-milestone' },
      {
        contentType: 'article',
        headline: 'Afrobeats Hits a\nNew Global Milestone',
        description: 'Charts, festivals, and a sound that travels.',
        categoryLabel: 'News',
        ctaLabel: 'Explore story →',
        ctaUrl: '/news/afrobeats-hits-a-new-global-milestone',
        position: 4,
        priority: 4,
        active: true,
        article: articleAfrobeats.documentId,
      },
    )

    await ensureDocument(
      'api::homepage-feature.homepage-feature',
      'hero-5',
      { ctaUrl: '/news/inside-the-studio-with-jay-c' },
      {
        contentType: 'article',
        headline: 'Inside the Studio\nwith Jay C',
        description: 'Pads, percussion, and the patience behind a hit.',
        categoryLabel: 'Music',
        ctaLabel: 'Explore story →',
        ctaUrl: '/news/inside-the-studio-with-jay-c',
        position: 5,
        priority: 5,
        active: true,
        article: articleJayC.documentId,
      },
    )
  } else {
    strapi.log.info('Skipping homepage-feature seed — features already exist')
  }

  const newsletter = await strapi.documents('api::newsletter-config.newsletter-config').findMany({
    limit: 1,
  })
  if (!newsletter.length) {
    await strapi.documents('api::newsletter-config.newsletter-config').create({
      data: {
        headline: "Don't just follow the culture.",
        accentText: 'Be part of it.',
        supportingText:
          'Get exclusive updates on music, shows, events and stories\nstraight to your inbox.',
        placeholder: 'Your email address',
        ctaLabel: 'Join',
        active: true,
      },
    })
  } else {
    strapi.log.info('Skipping newsletter-config seed — config already exists')
  }

  const homepageSettings = await strapi
    .documents('api::homepage-settings.homepage-settings')
    .findMany({ limit: 1 })
  const defaultFooterTagline =
    'The platform for black creatives by black creatives. Music, Culture, Community.'
  if (!homepageSettings.length) {
    await strapi.documents('api::homepage-settings.homepage-settings').create({
      data: {
        latestTitle: 'Latest from Rebel',
        latestEnabled: true,
        musicTitle: 'Music',
        musicEnabled: true,
        showsTitle: 'Shows',
        showsEnabled: true,
        newsTitle: 'News',
        newsEnabled: true,
        studioTitle: 'Studio',
        studioEnabled: true,
        eventsTitle: 'Events',
        eventsEnabled: true,
        newsletterEnabled: true,
        footerTagline: defaultFooterTagline,
      },
    })
  } else if (!(homepageSettings[0] as { footerTagline?: string | null }).footerTagline) {
    await strapi.documents('api::homepage-settings.homepage-settings').update({
      documentId: homepageSettings[0].documentId,
      data: { footerTagline: defaultFooterTagline } as never,
    })
  }

  const about = await strapi.documents('api::about-page.about-page').findMany({ limit: 1 })
  if (!about.length) {
    await strapi.documents('api::about-page.about-page').create({
      data: {
        headline: 'About',
        intro:
          'REBEL AFRIQUE is a premium African and Black creative media platform covering music, shows, news, studio, and events.',
        body: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                text: 'Content is managed through our editorial backoffice and published to this static site.',
              },
            ],
          },
        ],
        seoTitle: 'About REBEL AFRIQUE',
        seoDescription: 'Premium African and Black creative media.',
      },
    })
  }

  const launchSettings = await strapi
    .documents('api::launch-settings.launch-settings')
    .findMany({ limit: 1 })
  if (!launchSettings.length) {
    await strapi.documents('api::launch-settings.launch-settings').create({
      data: {
        enabled: false,
        headline: 'We launch soon',
        subheadline: 'REBEL AFRIQUE is almost here — music, culture, and community.',
        showNewsletter: true,
      },
    })
  }

  strapi.log.info('Demo content seed complete')
}

/** One-shot cleanup for retired seed content editors already tried to delete. */
async function removeRetiredDemoVideos(strapi: Core.Strapi) {
  const retiredStudioSlugs = ['studio-cut-night-drive']
  const retiredCollectionSlugs = ['night-drives']
  const retiredMediaKeys = ['youtube:dQw4w9WgXcQ']
  const retiredShowSlugs = ['rebel-sessions']
  const retiredEpisodeSlugs = ['episode-01-opening-night']

  async function deleteBySlug(
    uid: 'api::studio-video.studio-video' | 'api::video-collection.video-collection' | 'api::show.show' | 'api::show-episode.show-episode',
    slug: string,
    label: string,
  ) {
    const drafts = await strapi.documents(uid).findMany({
      filters: { slug },
      limit: 20,
      status: 'draft',
    })
    const published = await strapi.documents(uid).findMany({
      filters: { slug },
      limit: 20,
      status: 'published',
    })
    const seen = new Set<string>()
    for (const row of [...drafts, ...published]) {
      if (!row?.documentId || seen.has(row.documentId)) continue
      seen.add(row.documentId)
      await strapi.documents(uid).delete({
        documentId: row.documentId,
      })
      strapi.log.info(`Removed retired demo ${label}: ${slug}`)
    }
  }

  for (const slug of retiredStudioSlugs) {
    await deleteBySlug('api::studio-video.studio-video', slug, 'studio video')
  }

  for (const slug of retiredCollectionSlugs) {
    await deleteBySlug('api::video-collection.video-collection', slug, 'video collection')
  }

  for (const slug of retiredEpisodeSlugs) {
    await deleteBySlug('api::show-episode.show-episode', slug, 'show episode')
  }

  for (const slug of retiredShowSlugs) {
    // Episodes first so orphan relations do not block show delete.
    const showDrafts = await strapi.documents('api::show.show').findMany({
      filters: { slug },
      limit: 20,
      status: 'draft',
    })
    const showPublished = await strapi.documents('api::show.show').findMany({
      filters: { slug },
      limit: 20,
      status: 'published',
    })
    const showIds = new Set<string>()
    for (const show of [...showDrafts, ...showPublished]) {
      if (show?.documentId) showIds.add(show.documentId)
    }
    for (const documentId of showIds) {
      const epDrafts = await strapi.documents('api::show-episode.show-episode').findMany({
        filters: { show: { documentId } },
        limit: 100,
        status: 'draft',
      })
      const epPublished = await strapi.documents('api::show-episode.show-episode').findMany({
        filters: { show: { documentId } },
        limit: 100,
        status: 'published',
      })
      const epSeen = new Set<string>()
      for (const ep of [...epDrafts, ...epPublished]) {
        if (!ep?.documentId || epSeen.has(ep.documentId)) continue
        epSeen.add(ep.documentId)
        await strapi.documents('api::show-episode.show-episode').delete({
          documentId: ep.documentId,
        })
      }
      await strapi.documents('api::show.show').delete({ documentId })
      strapi.log.info(`Removed retired demo show: ${slug}`)
    }
  }

  for (const providerExternalKey of retiredMediaKeys) {
    const sources = await strapi.documents('api::media-source.media-source').findMany({
      filters: { providerExternalKey },
      limit: 10,
    })
    for (const source of sources) {
      if (!source?.documentId) continue

      const linkedTracks = await strapi.documents('api::track.track').findMany({
        filters: { mediaSource: { documentId: source.documentId } },
        limit: 50,
      })
      for (const track of linkedTracks) {
        if (!track?.documentId) continue
        await strapi.documents('api::track.track').update({
          documentId: track.documentId,
          data: { mediaSource: null } as never,
        })
      }

      const linkedPlaylists = await strapi.documents('api::playlist.playlist').findMany({
        filters: { mediaSource: { documentId: source.documentId } },
        limit: 50,
        status: 'published',
      })
      const draftPlaylists = await strapi.documents('api::playlist.playlist').findMany({
        filters: { mediaSource: { documentId: source.documentId } },
        limit: 50,
        status: 'draft',
      })
      const playlistSeen = new Set<string>()
      for (const playlist of [...linkedPlaylists, ...draftPlaylists]) {
        if (!playlist?.documentId || playlistSeen.has(playlist.documentId)) continue
        playlistSeen.add(playlist.documentId)
        await strapi.documents('api::playlist.playlist').update({
          documentId: playlist.documentId,
          data: { mediaSource: null } as never,
        })
      }

      await strapi.documents('api::media-source.media-source').delete({
        documentId: source.documentId,
      })
      strapi.log.info(`Removed retired demo media source: ${providerExternalKey}`)
    }
  }
}

let netlifyTimer: ReturnType<typeof setTimeout> | null = null
let netlifyPendingReason = ''

async function triggerNetlifyBuild(strapi: Core.Strapi, reason = 'content-change') {
  const hook = process.env.NETLIFY_BUILD_HOOK_URL
  if (!hook) return

  netlifyPendingReason = reason
  if (netlifyTimer) clearTimeout(netlifyTimer)

  const delayMs = Number(process.env.NETLIFY_BUILD_DEBOUNCE_MS || 15000)
  netlifyTimer = setTimeout(async () => {
    const pending = netlifyPendingReason
    netlifyPendingReason = ''
    netlifyTimer = null
    try {
      const response = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: pending }),
      })
      if (!response.ok) {
        strapi.log.warn(`Netlify build hook returned ${response.status}`)
      } else {
        strapi.log.info(`Netlify build hook triggered (${pending})`)
      }
    } catch (error) {
      strapi.log.warn(
        `Netlify build hook failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  }, delayMs)

  strapi.log.info(`Netlify build hook debounced ${delayMs}ms (${reason})`)
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Repair up_users before any auth/permission work that reads users.
    try {
      await ensureUpUsersColumns(strapi)
    } catch (error) {
      strapi.log.warn(
        `up_users column repair skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    await setPublicPermissions(strapi)
    await setAuthenticatedPermissions(strapi)

    try {
      const existingLaunch = await strapi
        .documents('api::launch-settings.launch-settings')
        .findMany({ limit: 1 })
      if (!existingLaunch.length) {
        await strapi.documents('api::launch-settings.launch-settings').create({
          data: {
            enabled: false,
            headline: 'We launch soon',
            subheadline: 'REBEL AFRIQUE is almost here — music, culture, and community.',
            showNewsletter: true,
          },
        })
        strapi.log.info('Created default launch-settings.')
      }
    } catch (error) {
      strapi.log.warn(
        `Launch settings ensure skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    try {
      await seedBackofficeUsers(strapi)
    } catch (error) {
      strapi.log.error(
        `Backoffice user seed failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }

    try {
      await removeRetiredDemoVideos(strapi)
    } catch (error) {
      strapi.log.warn(
        `Retired demo video cleanup skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    if (process.env.SEED_DEMO_CONTENT === 'true') {
      try {
        // Run demo seed once. Re-running on every bootstrap recreated deleted
        // demo rows (e.g. Rebel Essentials) after intentional backoffice deletes.
        const seedStore = strapi.store({ type: 'core', name: 'rebel_seed' })
        const force = process.env.FORCE_SEED_DEMO_CONTENT === 'true'
        const alreadySeeded = (await seedStore.get({ key: 'demo_content' })) === true

        if (!force && alreadySeeded) {
          // no-op
        } else if (!force) {
          // Prior installs seeded without a marker — detect and mark so we do
          // not recreate rows the editor already deleted.
          const prior = await strapi.documents('api::artist.artist').findMany({
            filters: { slug: 'oxlade' },
            limit: 1,
          })
          if (prior.length) {
            await seedStore.set({ key: 'demo_content', value: true })
            strapi.log.info(
              'Demo content seed marker set (prior seed detected); skipping recreate.',
            )
          } else {
            await seedDemoContent(strapi)
            await seedStore.set({ key: 'demo_content', value: true })
          }
        } else {
      await seedDemoContent(strapi)
      await seedStore.set({ key: 'demo_content', value: true })
      strapi.log.info('Demo content seed completed (forced).')
    }
      } catch (error) {
        strapi.log.error(
          `Demo seed failed: ${error instanceof Error ? error.message : 'unknown'}`,
        )
      }
    }

    try {
      const {
        syncAllYoutubeSourcesToMediaSources,
        linkPlaylistsToYoutubeMediaSources,
        backfillPlaylistChannelAttribution,
      } = await import('./utils/youtube-media-source')
      const synced = await syncAllYoutubeSourcesToMediaSources(strapi)
      if (synced > 0) {
        strapi.log.info(`Synced ${synced} YouTube source(s) into media sources.`)
      }
      const linked = await linkPlaylistsToYoutubeMediaSources(strapi)
      if (linked > 0) {
        strapi.log.info(`Linked ${linked} playlist(s) to YouTube media sources.`)
      }
      const backfill = await backfillPlaylistChannelAttribution(strapi)
      if (backfill.sourcesUpdated || backfill.trafficUpdated) {
        strapi.log.info(
          `Playlist channel attribution backfill: sources=${backfill.sourcesUpdated} media=${backfill.mediaUpdated} traffic=${backfill.trafficUpdated}`,
        )
      }
    } catch (error) {
      strapi.log.warn(
        `YouTube → media source sync skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    try {
      const { migratePlaylistVimeoSources } = await import('./utils/migrate-playlist-vimeo')
      const result = await migratePlaylistVimeoSources(strapi)
      if (result.moved > 0) {
        strapi.log.info(
          `Migrated ${result.moved} playlist Vimeo link(s); published ${result.published} document(s).`,
        )
      }
    } catch (error) {
      strapi.log.warn(
        `Playlist Vimeo migration skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    strapi.db.lifecycles.subscribe({
      models: [
        'api::article.article',
        'api::event.event',
        'api::show.show',
        'api::show-episode.show-episode',
        'api::studio-video.studio-video',
        'api::video-collection.video-collection',
        'api::music-release.music-release',
        'api::artist.artist',
        'api::playlist.playlist',
        'api::homepage-feature.homepage-feature',
        'api::homepage-settings.homepage-settings',
        'api::launch-settings.launch-settings',
        'api::about-page.about-page',
        'api::newsletter-config.newsletter-config',
      ],
      async afterCreate() {
        await triggerNetlifyBuild(strapi, 'create')
      },
      async afterUpdate() {
        await triggerNetlifyBuild(strapi, 'update')
      },
    })
  },
}
