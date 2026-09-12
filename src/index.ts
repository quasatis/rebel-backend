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
  'api::about-page.about-page',
  'api::newsletter-config.newsletter-config',
  'api::newsletter-subscription.newsletter-subscription',
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
  await ensurePermission(strapi, publicRole.id, 'api::search.search.search')
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
  await ensurePermission(strapi, roleId, 'plugin::upload.content-api.find')
  await ensurePermission(strapi, roleId, 'plugin::upload.content-api.findOne')
  await ensurePermission(strapi, roleId, 'plugin::users-permissions.user.me')

  if (mode === 'full') {
    await ensurePermission(strapi, roleId, 'api::youtube-source.youtube-source.sync')
    await ensurePermission(strapi, roleId, 'api::youtube-source.youtube-source.syncAll')
    await ensurePermission(strapi, roleId, 'api::show.show.sync')
    await ensurePermission(strapi, roleId, 'plugin::upload.content-api.upload')
    await ensurePermission(strapi, roleId, 'api::media-upload.media-upload.upload')
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

async function ensureBackofficeUser(
  strapi: Core.Strapi,
  data: {
    username: string
    email: string
    password: string
    roleId: number
  },
) {
  const userService = strapi.plugin('users-permissions').service('user')
  const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: {
      $or: [{ email: data.email }, { username: data.username }],
    },
  })

  if (!existing) {
    await userService.add({
      username: data.username,
      email: data.email,
      password: data.password,
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: data.roleId,
    })
    strapi.log.info(`Created backoffice user: ${data.email}`)
    return
  }

  await userService.edit(existing.id, {
    username: data.username,
    email: data.email,
    password: data.password,
    provider: 'local',
    confirmed: true,
    blocked: false,
    role: data.roleId,
  })
  strapi.log.info(`Updated backoffice user: ${data.email}`)
}

async function seedBackofficeUsers(strapi: Core.Strapi) {
  // Strapi local auth looks up users with provider='local'. Missing provider => 400.
  const missingProvider = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { provider: { $null: true } },
  })
  for (const user of missingProvider) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { provider: 'local' },
    })
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

  await ensureBackofficeUser(strapi, {
    username: 'admin',
    email: 'admin@rebelafrique.com',
    password: 'RebelAdmin123!',
    roleId: adminRole.id,
  })
  await ensureBackofficeUser(strapi, {
    username: 'editor',
    email: 'editor@rebelafrique.com',
    password: 'RebelEditor123!',
    roleId: editorRole.id,
  })
  await ensureBackofficeUser(strapi, {
    username: 'viewer',
    email: 'viewer@rebelafrique.com',
    password: 'RebelViewer123!',
    roleId: viewerRole.id,
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

  const mediaSource = await ensureDocument(
    'api::media-source.media-source',
    'youtube:dQw4w9WgXcQ',
    { providerExternalKey: 'youtube:dQw4w9WgXcQ' },
    {
      provider: 'youtube',
      externalId: 'dQw4w9WgXcQ',
      externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Featured Studio Session',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      durationSeconds: 212,
      providerExternalKey: 'youtube:dQw4w9WgXcQ',
      rawMeta: { seed: true },
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
      mediaSource: mediaSource.documentId,
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
      mediaSource: mediaSource.documentId,
    },
    { publish: true },
  )

  const studioVideo = await ensureDocument(
    'api::studio-video.studio-video',
    'studio-cut-night-drive',
    { slug: 'studio-cut-night-drive' },
    {
      title: 'Studio Cut: Night Drive',
      slug: 'studio-cut-night-drive',
      description: 'A cinematic short from the Rebel Studio desk.',
      mediaSource: mediaSource.documentId,
      durationSeconds: 212,
      releaseDate: new Date().toISOString(),
      featured: true,
      visibility: 'public',
      sortOrder: 1,
    },
    { publish: true },
  )

  await ensureDocument(
    'api::video-collection.video-collection',
    'night-drives',
    { slug: 'night-drives' },
    {
      title: 'Night Drives',
      slug: 'night-drives',
      description: 'Cinematic studio cuts for late hours.',
      featured: true,
      videos: [studioVideo.documentId],
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

  strapi.log.info('Demo content seed complete')
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
    await setPublicPermissions(strapi)
    await setAuthenticatedPermissions(strapi)

    try {
      await seedBackofficeUsers(strapi)
    } catch (error) {
      strapi.log.error(
        `Backoffice user seed failed: ${error instanceof Error ? error.message : 'unknown'}`,
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
