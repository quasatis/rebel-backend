export type IpGeoLookup = {
  queryIp: string
  asn: string
  isp: string
  org: string
  services: string
  country: string
  countryCode: string
  region: string
  city: string
  latitude: string
  longitude: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const LOOKUP_TIMEOUT_MS = 8000
const IP_API_FIELDS =
  'status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,proxy,hosting,mobile,query'
const cache = new Map<string, { at: number; data: IpGeoLookup | null }>()

const PRIVATE_IP =
  /^(::1|::|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[0-1])\.|fc|fd|fe80:|localhost)/i

export function isPrivateIp(ip: string): boolean {
  const value = String(ip || '').trim()
  if (!value) return true
  return PRIVATE_IP.test(value)
}

export function pickPublicIp(candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    const first = String(raw || '')
      .split(',')[0]
      .trim()
      .replace(/^::ffff:/i, '')
    if (first && !isPrivateIp(first)) return first.slice(0, 80)
  }
  for (const raw of candidates) {
    const first = String(raw || '')
      .split(',')[0]
      .trim()
      .replace(/^::ffff:/i, '')
    if (first) return first.slice(0, 80)
  }
  return ''
}

function asText(value: unknown, max = 160): string {
  if (value == null) return ''
  return String(value).trim().slice(0, max)
}

function asCoord(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 1e6) / 1e6)
}

function cacheKey(ip: string): string {
  return isPrivateIp(ip) ? '__self__' : ip
}

function servicesFromFlags(flags: Record<string, unknown> | null | undefined): string {
  if (!flags) return ''
  const tags: string[] = []
  if (flags.is_vpn || flags.proxy) tags.push(flags.is_vpn ? 'VPN' : 'Proxy')
  if (flags.is_proxy && !flags.proxy && !flags.is_vpn) tags.push('Proxy')
  if (flags.is_tor) tags.push('Tor')
  if (flags.is_datacenter || flags.hosting) tags.push('Datacenter')
  if (flags.is_mobile || flags.mobile) tags.push('Mobile')
  return [...new Set(tags)].join(', ')
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function fromIpWho(data: Record<string, unknown>): IpGeoLookup | null {
  if (data.success === false) return null
  const connection =
    (data.connection && typeof data.connection === 'object' ? data.connection : {}) as Record<
      string,
      unknown
    >
  const asnRaw = connection.asn
  const asn =
    typeof asnRaw === 'number' ? `AS${asnRaw}` : asText(asnRaw, 80).replace(/^as/i, 'AS')
  const country = asText(data.country)
  const queryIp = asText(data.ip, 80)
  if (!country && !asn && !asText(connection.isp) && !queryIp) return null
  return {
    queryIp,
    asn: asn && !asn.startsWith('AS') ? `AS${asn}` : asn,
    isp: asText(connection.isp, 160),
    org: asText(connection.org, 160),
    services: '',
    country,
    countryCode: asText(data.country_code, 8),
    region: asText(data.region, 120),
    city: asText(data.city, 120),
    latitude: asCoord(data.latitude),
    longitude: asCoord(data.longitude),
  }
}

function fromIpApi(data: Record<string, unknown>): IpGeoLookup | null {
  if (asText(data.status) === 'fail') return null
  const country = asText(data.country)
  const asn = asText(data.as, 80)
  const queryIp = asText(data.query, 80)
  if (!country && !asn && !asText(data.isp) && !queryIp) return null
  return {
    queryIp,
    asn,
    isp: asText(data.isp, 160),
    org: asText(data.org, 160),
    services: servicesFromFlags({
      proxy: data.proxy,
      hosting: data.hosting,
      mobile: data.mobile,
    }),
    country,
    countryCode: asText(data.countryCode, 8),
    region: asText(data.regionName, 120),
    city: asText(data.city, 120),
    latitude: asCoord(data.lat),
    longitude: asCoord(data.lon),
  }
}

function fromIpQuery(data: Record<string, unknown>): IpGeoLookup | null {
  const isp = (data.isp && typeof data.isp === 'object' ? data.isp : {}) as Record<string, unknown>
  const location =
    (data.location && typeof data.location === 'object' ? data.location : {}) as Record<
      string,
      unknown
    >
  const risk =
    (data.risk && typeof data.risk === 'object' ? data.risk : {}) as Record<string, unknown>
  const country = asText(location.country)
  const queryIp = asText(data.ip, 80)
  if (!country && !asText(isp.asn) && !asText(isp.isp) && !queryIp) return null
  return {
    queryIp,
    asn: asText(isp.asn, 80),
    isp: asText(isp.isp, 160),
    org: asText(isp.org, 160),
    services: servicesFromFlags(risk),
    country,
    countryCode: asText(location.country_code, 8),
    region: asText(location.state, 120),
    city: asText(location.city, 120),
    latitude: asCoord(location.latitude),
    longitude: asCoord(location.longitude),
  }
}

async function queryProviders(ip: string): Promise<IpGeoLookup | null> {
  const self = !ip || isPrivateIp(ip)
  const encoded = encodeURIComponent(ip)
  const urls = self
    ? [
        'https://ipwho.is/',
        `http://ip-api.com/json/?fields=${IP_API_FIELDS}`,
        'https://api.ipquery.io/',
      ]
    : [
        `https://ipwho.is/${encoded}`,
        `http://ip-api.com/json/${encoded}?fields=${IP_API_FIELDS}`,
        `https://api.ipquery.io/${encoded}`,
      ]

  for (const url of urls) {
    const data = await fetchJson(url)
    if (!data) continue
    const parsed = url.includes('ip-api.com')
      ? fromIpApi(data)
      : url.includes('ipwho')
        ? fromIpWho(data)
        : fromIpQuery(data)
    if (parsed && (parsed.country || parsed.asn || parsed.isp)) return parsed
  }
  return null
}

export async function lookupIpGeo(ip: string): Promise<IpGeoLookup | null> {
  const value = String(ip || '').trim()
  const key = cacheKey(value)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data

  const result = await queryProviders(value)
  cache.set(key, { at: Date.now(), data: result })
  if (result?.queryIp && result.queryIp !== value) {
    cache.set(result.queryIp, { at: Date.now(), data: result })
  }
  return result
}
