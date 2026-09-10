import type { Core } from '@strapi/strapi'

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

async function setPublicPermissions(strapi: Core.Strapi) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  })
  if (!publicRole) return

  for (const uid of CONTENT_UIDS) {
    if (uid.includes('newsletter-subscription') || uid.includes('youtube-source')) continue
    for (const action of ['find', 'findOne']) {
      await ensurePermission(strapi, publicRole.id, `${uid}.${action}`)
    }
  }

  await ensurePermission(
    strapi,
    publicRole.id,
    'api::newsletter-subscription.newsletter-subscription.create',
  )
  await ensurePermission(strapi, publicRole.id, 'api::search.search.search')
}

async function setAuthenticatedPermissions(strapi: Core.Strapi) {
  const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  })
  if (!authRole) return

  for (const uid of CONTENT_UIDS) {
    for (const action of ['find', 'findOne', 'create', 'update', 'delete']) {
      await ensurePermission(strapi, authRole.id, `${uid}.${action}`)
    }
  }
  await ensurePermission(strapi, authRole.id, 'api::youtube-source.youtube-source.sync')
  await ensurePermission(strapi, authRole.id, 'api::search.search.search')
  await ensurePermission(strapi, authRole.id, 'plugin::upload.content-api.find')
  await ensurePermission(strapi, authRole.id, 'plugin::upload.content-api.findOne')
  await ensurePermission(strapi, authRole.id, 'plugin::upload.content-api.upload')
}

async function seedDemoContent(strapi: Core.Strapi) {
  const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  })

  const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: 'editor@rebelafrique.com' },
  })
  if (!existingUser && authRole) {
    await strapi.plugin('users-permissions').service('user').add({
      username: 'editor',
      email: 'editor@rebelafrique.com',
      password: 'RebelEditor123!',
      confirmed: true,
      blocked: false,
      role: authRole.id,
    })
    strapi.log.info('Created demo editor user: editor@rebelafrique.com')
  }

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
    },
    { publish: true },
  )

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

  await ensureDocument(
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
    },
  )

  const show = await ensureDocument(
    'api::show.show',
    'rebel-sessions',
    { slug: 'rebel-sessions' },
    {
      title: 'Rebel Sessions',
      slug: 'rebel-sessions',
      description: 'Live conversations and performances with Black creatives.',
      featured: true,
    },
    { publish: true },
  )

  await ensureDocument(
    'api::show-episode.show-episode',
    'episode-01-opening-night',
    { slug: 'episode-01-opening-night' },
    {
      title: 'Episode 01 — Opening Night',
      slug: 'episode-01-opening-night',
      description: 'The debut episode of Rebel Sessions.',
      episodeNumber: 1,
      durationSeconds: 212,
      mediaSource: mediaSource.documentId,
      show: show.documentId,
    },
    { publish: true },
  )

  await ensureDocument(
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
    },
    { publish: true },
  )

  await ensureDocument(
    'api::homepage-feature.homepage-feature',
    'hero-1',
    { headline: 'The Sound of a New Generation' },
    {
      contentType: 'article',
      headline: 'The Sound of a New Generation',
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

  const newsletter = await strapi.documents('api::newsletter-config.newsletter-config').findMany({
    limit: 1,
  })
  if (!newsletter.length) {
    await strapi.documents('api::newsletter-config.newsletter-config').create({
      data: {
        headline: "Don't just follow the culture.",
        accentText: 'Be part of it.',
        supportingText: 'Exclusive updates from REBEL AFRIQUE.',
        placeholder: 'Your email address',
        ctaLabel: 'Join',
        active: true,
      },
    })
  }

  const homepageSettings = await strapi
    .documents('api::homepage-settings.homepage-settings')
    .findMany({ limit: 1 })
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
      },
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

    if (process.env.SEED_DEMO_CONTENT === 'true') {
      try {
        await seedDemoContent(strapi)
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
