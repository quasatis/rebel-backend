'use strict'

/**
 * Strapi email provider — Brevo Transactional API.
 * @see https://developers.brevo.com/reference/sendtransacemail
 */
module.exports = {
  provider: 'brevo',
  name: 'Brevo',

  init(providerOptions = {}, settings = {}) {
    const apiKey = String(providerOptions.apiKey || '').trim()
    const apiUrl = String(
      providerOptions.apiUrl || 'https://api.brevo.com/v3/smtp/email',
    ).trim()

    function formatAddress(value, fallbackName) {
      if (!value) return null
      if (typeof value === 'object' && value.email) {
        return {
          email: String(value.email).trim(),
          name: value.name ? String(value.name).trim() : undefined,
        }
      }
      const raw = String(value).trim()
      // Support "Name <email@x.com>" and plain emails.
      const angled = raw.match(/^(.*)<([^>]+)>$/)
      if (angled) {
        const name = angled[1].replace(/["']/g, '').trim()
        return { email: angled[2].trim(), name: name || fallbackName || undefined }
      }
      return { email: raw, name: fallbackName || undefined }
    }

    function toRecipientList(value) {
      if (!value) return []
      const list = Array.isArray(value) ? value : String(value).split(',')
      return list
        .map((item) => formatAddress(item))
        .filter((item) => item && item.email)
    }

    return {
      async send(options = {}) {
        if (!apiKey) {
          throw new Error('Brevo email provider requires BREVO_API_KEY')
        }

        const senderName = settings.defaultFromName || providerOptions.defaultFromName
        const from =
          formatAddress(options.from || settings.defaultFrom, senderName) ||
          formatAddress(settings.defaultFrom, senderName)

        if (!from?.email) {
          throw new Error('Brevo email provider requires a from address')
        }

        const to = toRecipientList(options.to)
        if (!to.length) {
          throw new Error('Brevo email provider requires at least one recipient')
        }

        const replyTo = formatAddress(options.replyTo || settings.defaultReplyTo)
        const payload = {
          sender: from,
          to,
          subject: options.subject || '',
          htmlContent: options.html || options.text || '',
          textContent: options.text || undefined,
        }

        if (replyTo?.email) payload.replyTo = replyTo

        const cc = toRecipientList(options.cc)
        const bcc = toRecipientList(options.bcc)
        if (cc.length) payload.cc = cc
        if (bcc.length) payload.bcc = bcc

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          let detail = response.statusText
          try {
            const body = await response.json()
            detail = body?.message || body?.error || JSON.stringify(body)
          } catch {
            // ignore parse errors
          }
          throw new Error(`Brevo email send failed (${response.status}): ${detail}`)
        }

        try {
          return await response.json()
        } catch {
          return { ok: true }
        }
      },
    }
  },
}
