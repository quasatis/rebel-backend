/**
 * Prevent intermediary caches from serving stale public CMS JSON
 * (e.g. music page banner after a backoffice update).
 */
export default () => {
  return async (
    ctx: { method: string; path?: string; url?: string; set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    await next()
    const path = String(ctx.path || ctx.url || '')
    if (!(ctx.method === 'GET' || ctx.method === 'HEAD')) return
    if (!path.startsWith('/api/')) return
    ctx.set('Cache-Control', 'private, no-store, no-cache, must-revalidate')
    ctx.set('Pragma', 'no-cache')
  }
}
