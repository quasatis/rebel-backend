import type { Core } from '@strapi/strapi'

const STORE_KEY = 'restored_purged_20260923'

async function findOne(
  strapi: Core.Strapi,
  uid: string,
  filters: Record<string, unknown>,
) {
  const rows = await strapi.documents(uid as never).findMany({
    filters: filters as never,
    limit: 1,
  })
  return rows[0] || null
}

async function fileExists(strapi: Core.Strapi, id: number) {
  const row = await strapi.db.query('plugin::upload.file').findOne({ where: { id } })
  return Boolean(row)
}

async function media(strapi: Core.Strapi, id: number) {
  return (await fileExists(strapi, id)) ? id : null
}

function tylaSections() {
  const id = () => `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return [
    {
      id: id(),
      type: 'hero',
      layout: 'fullBleed',
      eyebrow: 'REBEL OF THE WEEK',
      name: 'TYLA',
      blurb:
        'Johannesburg to the world. The artist turning South African rhythm, movement and self-belief into a new global language.',
      ctaLabel: "MEET THIS WEEK'S REBEL",
      image: null,
    },
    {
      id: id(),
      type: 'intro',
      layout: 'twoCol',
      label: 'WHO IS TYLA?',
      headline: 'THE GIRL FROM JOBURG WHO MADE THE WORLD MOVE.',
      quote: 'I always wanted to be the first me, not the next anyone.',
      bioLeft:
        'Born and raised in Johannesburg, Tyla Laura Seethal grew up inside a rich collision of sound: amapiano basslines, R&B melodies, pop spectacle and the kinetic pulse of South African dance.',
      bioRight:
        "Her answer is 'popiano' — a fluid world that belongs everywhere without surrendering where it comes from. The music is polished, but the attitude remains instinctive: playful, proud and impossible to copy.",
    },
    {
      id: id(),
      type: 'breakthrough',
      layout: 'imageLeft',
      label: 'THE BREAKTHROUGH',
      titleWhite: 'ONE DROP.',
      titleRed: 'A TIDAL WAVE.',
      body:
        "When 'Water' arrived, it did more than soundtrack a dance challenge. It brought the sensual snap of Bacardi dance into living rooms across continents — on its own terms. The record reached the Billboard Hot 100 top ten and helped open a new Grammy chapter for African music.",
      caption: 'PORTRAIT STUDY / JOHANNESBURG ENERGY',
      image: null,
      stats: [
        { value: '#7', label: 'US HOT 100 PEAK' },
        { value: '1B+', label: 'GLOBAL STREAMS' },
      ],
    },
    {
      id: id(),
      type: 'ascent',
      layout: 'grid4',
      label: 'THE ASCENT',
      title: 'A REBEL IN MOTION',
      range: '2019 — TODAY',
      milestones: [
        {
          year: '2019',
          title: 'THE FIRST SPARK',
          body: 'Tyla introduces her sound with Getting Late — a meeting point between R&B ease and South African rhythm.',
        },
        {
          year: '2023',
          title: 'WATER MOVES THE WORLD',
          body: 'A hypnotic hook and a viral Bacardi-inspired dance turn a homegrown record into a global pop phenomenon.',
        },
        {
          year: '2024',
          title: 'HISTORY, MADE',
          body: 'Water earns the inaugural Grammy for Best African Music Performance. Her self-titled debut album follows.',
        },
        {
          year: 'NOW',
          title: 'A WORLD OF HER OWN',
          body: 'With a new visual language and a borderless fanbase, Tyla continues to expand what African pop can look and feel like.',
        },
      ],
    },
    {
      id: id(),
      type: 'quote',
      layout: 'split',
      text: 'BEING AFRICAN IS THE COOL THING. THE WORLD IS FINALLY CATCHING UP.',
      accent: 'THE COOL THING',
      image: null,
    },
    {
      id: id(),
      type: 'listening',
      layout: 'tracksAlbum',
      label: 'ESSENTIAL LISTENING',
      title: 'PRESS PLAY',
      tracks: [
        {
          title: 'WATER',
          duration: '3:20',
          url: 'https://open.spotify.com/track/5aIVCx5tnk0ntmdiinnYvw',
        },
        {
          title: 'TRUTH OR DARE',
          duration: '3:10',
          url: 'https://www.youtube.com/watch?v=UKpz-I9EV84',
        },
        {
          title: 'JUMP',
          duration: '2:55',
          url: 'https://open.spotify.com/track/0ve0CavjqrUqVmZ605RhTV',
        },
        {
          title: 'ART',
          duration: '3:05',
          url: 'https://www.youtube.com/watch?v=mGyN2NMuS4A',
        },
      ],
      albumEyebrow: 'DEBUT ALBUM',
      albumName: 'TYLA',
      albumDescription:
        'A vivid, self-assured debut; intimate R&B, amapiano swing and global pop scale in one unmistakable voice.',
      albumCtaLabel: 'LISTEN TO THE ALBUM',
      albumUrl: 'https://open.spotify.com/album/3KGVOGmIbinlrR97aFufGE',
      albumMonogram: 'T',
    },
    {
      id: id(),
      type: 'awards',
      layout: 'grid4',
      label: 'BY THE NUMBERS',
      title: 'THE TROPHY SHELF',
      awards: [
        { title: 'GRAMMY AWARD', description: 'BEST AFRICAN MUSIC PERFORMANCE' },
        { title: 'BILLBOARD HOT 100', description: "TOP 10 WITH 'WATER'" },
        { title: 'MTV VMA', description: 'BEST AFROBEATS' },
        { title: 'BET AWARDS', description: 'BEST NEW ARTIST / INTERNATIONAL ACT' },
      ],
    },
    {
      id: id(),
      type: 'whatsNext',
      layout: 'split',
      label: "WHAT'S NEXT",
      headline: 'THE NEXT WAVE IS LOADING.',
      body:
        "New music, bigger stages and a visual world that keeps evolving. Official dates and project announcements land first through Tyla's channels.",
      ctaLabel: 'FOLLOW OFFICIAL UPDATES',
      ctaUrl: '',
      items: [
        { title: 'JOHANNESBURG · HOMECOMING', subtitle: 'DATES VIA OFFICIAL CHANNELS', url: '' },
        { title: 'LONDON · FESTIVAL SEASON', subtitle: 'DATES VIA OFFICIAL CHANNELS', url: '' },
        { title: 'NEW YORK · LIVE STAGE', subtitle: 'DATES VIA OFFICIAL CHANNELS', url: '' },
        { title: 'GLOBAL · MORE TO BE ANNOUNCED', subtitle: 'DATES VIA OFFICIAL CHANNELS', url: '' },
      ],
    },
    {
      id: id(),
      type: 'dropCta',
      layout: 'split',
      eyebrow: "NEXT WEEK'S REBEL",
      headline: 'NEVER MISS THE DROP.',
      placeholder: 'YOUR EMAIL ADDRESS',
      ctaLabel: 'JOIN',
    },
  ]
}

/** Restore CMS rows deleted by the 2026-09-23 slug purge. Runs once. */
export async function restorePurgedContent(strapi: Core.Strapi) {
  const store = strapi.store({ type: 'core', name: 'rebel_seed' })
  if ((await store.get({ key: STORE_KEY })) === true) return

  const created: string[] = []

  async function ensure(
    uid: string,
    slugOrKey: string,
    lookup: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    const existing = await findOne(strapi, uid, lookup)
    if (existing) return existing
    const row = await strapi.documents(uid as never).create({
      data: data as never,
      status: 'published',
    })
    created.push(`${uid} ${slugOrKey}`)
    return row
  }

  const categoryCulture = await findOne(strapi, 'api::category.category', { slug: 'culture' })
  const categoryMusic = await findOne(strapi, 'api::category.category', { slug: 'music' })

  const author = await ensure(
    'api::author.author',
    'rebel-desk',
    { slug: 'rebel-desk' },
    { name: 'Rebel Desk', slug: 'rebel-desk', bio: 'Editorial desk at REBEL AFRIQUE.' },
  )

  const tag = await ensure(
    'api::tag.tag',
    'afrobeats',
    { slug: 'afrobeats' },
    { name: 'Afrobeats', slug: 'afrobeats' },
  )

  const articleSound = await ensure(
    'api::article.article',
    'the-sound-of-a-new-generation',
    { slug: 'the-sound-of-a-new-generation' },
    {
      title: 'The Sound of  a New Generation',
      slug: 'the-sound-of-a-new-generation',
      excerpt: "Discover the artists shaping Africa's creative future.",
      content: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'This is a test!', bold: true }],
        },
      ],
      featured: true,
      category: categoryMusic?.documentId || categoryCulture?.documentId,
      author: author?.documentId,
      featuredImage: await media(strapi, 24),
    },
  )

  const articleOxlade = await ensure(
    'api::article.article',
    'oxlade-drops-new-single-ku-lo-sa',
    { slug: 'oxlade-drops-new-single-ku-lo-sa' },
    {
      title: "Oxlade Drops New Single 'KU LO SA'",
      slug: 'oxlade-drops-new-single-ku-lo-sa',
      excerpt:
        'The Afropop star returns with a nocturnal anthem built for late drives and louder speakers.',
      content: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'KU LO SA lands as another chapter in Oxlade’s rise across the continent and diaspora.',
            },
          ],
        },
      ],
      featured: true,
      readingTime: 4,
      category: categoryMusic?.documentId,
      author: author?.documentId,
      tags: tag?.documentId ? [tag.documentId] : [],
      featuredImage: await media(strapi, 22),
    },
  )

  const artist = await ensure(
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
  )

  const release = await ensure(
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
      artist: artist?.documentId,
    },
  )

  await ensure(
    'api::track.track',
    'ku-lo-sa-track',
    { title: 'KU LO SA' },
    {
      title: 'KU LO SA',
      trackNumber: 1,
      durationSeconds: 212,
      release: release?.documentId,
    },
  )

  const venue = await ensure(
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

  const eventCategory = await ensure(
    'api::event-category.event-category',
    'live-music',
    { slug: 'live-music' },
    { name: 'Live Music', slug: 'live-music' },
  )

  const start = new Date()
  start.setDate(start.getDate() + 14)
  await ensure(
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
      venue: venue?.documentId,
      category: eventCategory?.documentId,
      featuredImage: await media(strapi, 19),
    },
  )

  await ensure(
    'api::homepage-feature.homepage-feature',
    'hero-sound',
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
      article: articleSound?.documentId,
      image: await media(strapi, 15),
    },
  )

  await ensure(
    'api::homepage-feature.homepage-feature',
    'hero-oxlade',
    { ctaUrl: '/news/oxlade-drops-new-single-ku-lo-sa' },
    {
      contentType: 'article',
      headline: 'Oxlade Drops New',
      description: 'A nocturnal Afropop anthem built for late drives.',
      categoryLabel: 'Music',
      ctaLabel: 'Explore story →',
      ctaUrl: '/news/oxlade-drops-new-single-ku-lo-sa',
      position: 2,
      priority: 2,
      active: true,
      article: articleOxlade?.documentId,
      image: await media(strapi, 25),
    },
  )

  const existingTyla = await findOne(strapi, 'api::rebel-of-the-week.rebel-of-the-week', {
    slug: 'tyla',
  })
  if (!existingTyla) {
    await strapi.documents('api::rebel-of-the-week.rebel-of-the-week').create({
      data: {
        slug: 'tyla',
        weekStartsAt: new Date().toISOString(),
        weekLabel: '001',
        seoTitle: 'REBEL — Rebel of the Week',
        seoDescription:
          'Meet this week’s Rebel — artists reshaping African and Black creative culture.',
        heroName: 'TYLA',
        heroEyebrow: 'REBEL OF THE WEEK',
        heroImage: await media(strapi, 54),
        sections: tylaSections(),
      } as never,
      status: 'published',
    })
    created.push('api::rebel-of-the-week.rebel-of-the-week tyla')
  }

  await store.set({ key: STORE_KEY, value: true })
  if (created.length) {
    strapi.log.info(`Restored purged CMS documents: ${created.join(', ')}`)
  } else {
    strapi.log.info('Purged CMS restore: all target documents already exist')
  }
}
