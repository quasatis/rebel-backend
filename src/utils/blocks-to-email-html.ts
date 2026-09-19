/**
 * Convert Strapi blocks to email-safe HTML (subset suitable for transactional mail).
 */

type BlockChild = {
  type?: string
  text?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  code?: boolean
  url?: string
  children?: BlockChild[]
}

type ContentBlock = {
  type?: string
  level?: number
  format?: 'ordered' | 'unordered'
  children?: BlockChild[]
  image?: { url?: string; alternativeText?: string | null; width?: number; height?: number }
  caption?: string | null
  credit?: string | null
  language?: string | null
  url?: string | null
  videoId?: string
  embedId?: string
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function flattenText(children: BlockChild[] | undefined): string {
  if (!children?.length) return ''
  return children
    .map((child) => {
      if (!child || typeof child !== 'object') return ''
      if (child.type === 'text') return child.text || ''
      if (child.type === 'link') return flattenText(child.children)
      return flattenText(child.children)
    })
    .join('')
}

function renderInline(children: BlockChild[] | undefined): string {
  if (!children?.length) return ''
  return children
    .map((child) => {
      if (!child || typeof child !== 'object') return ''
      if (child.type === 'link') {
        const href = escapeHtml(String(child.url || '#'))
        const inner = renderInline(child.children)
        return `<a href="${href}" style="color:#c45c26;text-decoration:underline;">${inner}</a>`
      }
      if (child.type === 'text' || child.text != null) {
        let text = escapeHtml(child.text || '')
        if (child.code) text = `<code style="font-family:monospace;font-size:0.9em;">${text}</code>`
        if (child.bold) text = `<strong>${text}</strong>`
        if (child.italic) text = `<em>${text}</em>`
        if (child.underline) text = `<u>${text}</u>`
        if (child.strikethrough) text = `<s>${text}</s>`
        return text
      }
      return renderInline(child.children)
    })
    .join('')
}

function youtubeIdFromBlock(block: ContentBlock): string {
  if (block.videoId) return String(block.videoId)
  if (block.language === 'youtube' && block.children?.length) {
    try {
      const raw = flattenText(block.children)
      const parsed = JSON.parse(raw) as { videoId?: string }
      return String(parsed.videoId || '')
    } catch {
      return ''
    }
  }
  return ''
}

function spotifyIdFromBlock(block: ContentBlock): string {
  if (block.embedId) return String(block.embedId)
  if (block.language === 'spotify' && block.children?.length) {
    try {
      const raw = flattenText(block.children)
      const parsed = JSON.parse(raw) as { embedId?: string }
      return String(parsed.embedId || '')
    } catch {
      return ''
    }
  }
  return ''
}

function renderBlock(block: ContentBlock): string {
  const type = String(block.type || '')

  if (type === 'heading') {
    const level = Math.min(Math.max(Number(block.level) || 2, 1), 3)
    const tag = `h${level}` as 'h1' | 'h2' | 'h3'
    const size = level === 1 ? '28px' : level === 2 ? '22px' : '18px'
    return `<${tag} style="margin:0 0 12px;font-size:${size};line-height:1.3;color:#111;">${renderInline(block.children)}</${tag}>`
  }

  if (type === 'paragraph') {
    const inner = renderInline(block.children)
    if (!inner.trim()) return ''
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#222;">${inner}</p>`
  }

  if (type === 'quote') {
    return `<blockquote style="margin:0 0 16px;padding:8px 0 8px 16px;border-left:3px solid #c45c26;color:#444;font-style:italic;">${renderInline(block.children)}</blockquote>`
  }

  if (type === 'list') {
    const ordered = block.format === 'ordered'
    const tag = ordered ? 'ol' : 'ul'
    const items = (block.children || [])
      .map((item) => {
        const inner = renderInline((item as BlockChild).children)
        return `<li style="margin:0 0 6px;">${inner}</li>`
      })
      .join('')
    return `<${tag} style="margin:0 0 16px;padding-left:24px;font-size:16px;line-height:1.6;color:#222;">${items}</${tag}>`
  }

  if (type === 'image' && block.image?.url) {
    const src = escapeHtml(block.image.url)
    const alt = escapeHtml(block.image.alternativeText || '')
    const caption = block.caption ? escapeHtml(String(block.caption)) : ''
    const credit = block.credit ? escapeHtml(String(block.credit)) : ''
    const meta = [caption, credit].filter(Boolean).join(' — ')
    return `
      <div style="margin:0 0 20px;">
        <img src="${src}" alt="${alt}" width="600" style="display:block;max-width:100%;height:auto;border:0;" />
        ${meta ? `<p style="margin:8px 0 0;font-size:13px;color:#666;">${meta}</p>` : ''}
      </div>`
  }

  const yt = youtubeIdFromBlock(block)
  if (yt) {
    const href = escapeHtml(`https://www.youtube.com/watch?v=${yt}`)
    return `<p style="margin:0 0 16px;font-size:16px;"><a href="${href}" style="color:#c45c26;">Watch on YouTube</a></p>`
  }

  const spotify = spotifyIdFromBlock(block)
  if (spotify) {
    const href = escapeHtml(`https://open.spotify.com/${spotify}`)
    return `<p style="margin:0 0 16px;font-size:16px;"><a href="${href}" style="color:#c45c26;">Listen on Spotify</a></p>`
  }

  if (type === 'code' || type === 'link') {
    const text = flattenText(block.children).trim()
    if (!text) return ''
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#222;">${escapeHtml(text)}</p>`
  }

  const fallback = flattenText(block.children).trim()
  if (!fallback) return ''
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#222;">${escapeHtml(fallback)}</p>`
}

export function blocksToEmailBodyHtml(content: unknown): string {
  if (!Array.isArray(content) || !content.length) return ''
  return (content as ContentBlock[])
    .map((block) => renderBlock(block))
    .filter(Boolean)
    .join('\n')
}

export function blocksToPlainText(content: unknown): string {
  if (!Array.isArray(content) || !content.length) return ''
  return (content as ContentBlock[])
    .map((block) => {
      const type = String(block.type || '')
      if (type === 'image') return block.image?.url || ''
      const yt = youtubeIdFromBlock(block)
      if (yt) return `https://www.youtube.com/watch?v=${yt}`
      const spotify = spotifyIdFromBlock(block)
      if (spotify) return `https://open.spotify.com/${spotify}`
      if (type === 'list') {
        return (block.children || [])
          .map((item) => `• ${flattenText((item as BlockChild).children)}`)
          .join('\n')
      }
      return flattenText(block.children)
    })
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

export function wrapNewsletterEmail(opts: {
  subject: string
  previewText?: string | null
  bodyHtml: string
  unsubscribeUrl: string
  siteUrl: string
}): { html: string; text: string } {
  const subject = escapeHtml(opts.subject)
  const preview = escapeHtml(String(opts.previewText || '').trim())
  const unsub = escapeHtml(opts.unsubscribeUrl)
  const site = escapeHtml(opts.siteUrl.replace(/\/$/, ''))

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Georgia,serif;">
  ${preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5dfd5;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0 0 20px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#888;">REBEL AFRIQUE</p>
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;border-top:1px solid #eee;">
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#888;">
                You received this because you subscribed to REBEL AFRIQUE.
                <a href="${unsub}" style="color:#888;text-decoration:underline;">Unsubscribe</a>
                · <a href="${site}" style="color:#888;text-decoration:underline;">Visit the site</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textParts = [
    'REBEL AFRIQUE',
    '',
    blocksToPlainTextFromHtmlHint(opts.bodyHtml),
    '',
    `Unsubscribe: ${opts.unsubscribeUrl}`,
    `Site: ${opts.siteUrl.replace(/\/$/, '')}`,
  ]

  return {
    html,
    text: textParts.filter((p) => p !== undefined).join('\n'),
  }
}

/** Prefer calling with plain text separately; this strips tags as a last resort. */
function blocksToPlainTextFromHtmlHint(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildNewsletterEmail(opts: {
  subject: string
  previewText?: string | null
  content: unknown
  unsubscribeUrl: string
  siteUrl: string
}): { html: string; text: string } {
  const bodyHtml = blocksToEmailBodyHtml(opts.content)
  const plain = blocksToPlainText(opts.content)
  const wrapped = wrapNewsletterEmail({
    subject: opts.subject,
    previewText: opts.previewText,
    bodyHtml: bodyHtml || `<p style="margin:0 0 16px;font-size:16px;color:#222;">${escapeHtml(opts.subject)}</p>`,
    unsubscribeUrl: opts.unsubscribeUrl,
    siteUrl: opts.siteUrl,
  })
  return {
    html: wrapped.html,
    text: [
      'REBEL AFRIQUE',
      '',
      plain || opts.subject,
      '',
      `Unsubscribe: ${opts.unsubscribeUrl}`,
      `Site: ${opts.siteUrl.replace(/\/$/, '')}`,
    ].join('\n'),
  }
}
