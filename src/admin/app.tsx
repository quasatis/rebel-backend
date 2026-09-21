export default {
  config: {
    locales: ['en'],
  },
  bootstrap() {
    // #region agent log
    const DEBUG_ENDPOINT =
      'http://127.0.0.1:7942/ingest/62e9c20b-80f7-427e-9c94-2f7fa55442a7';
    const staleChunk =
      '/admin/node_modules/.strapi/vite/deps/ListPage-BWROSFVE.js?v=c20fc924';
    const metaUrl = '/admin/node_modules/.strapi/vite/deps/_metadata.json';

    const send = (payload: Record<string, unknown>) => {
      fetch(DEBUG_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '401ee2',
        },
        body: JSON.stringify({
          sessionId: '401ee2',
          timestamp: Date.now(),
          runId: 'post-fix',
          ...payload,
        }),
      }).catch(() => {});
    };

    send({
      hypothesisId: 'D',
      location: 'src/admin/app.tsx:bootstrap',
      message: 'Admin bootstrap started',
      data: {
        href: typeof location !== 'undefined' ? location.href : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });

    window.addEventListener('vite:preloadError', (event) => {
      const key = 'rebel-vite-preload-reload';
      const willReload = !sessionStorage.getItem(key);
      send({
        hypothesisId: 'A',
        location: 'src/admin/app.tsx:preloadError',
        message: 'vite preloadError observed',
        data: {
          href: typeof location !== 'undefined' ? location.href : null,
          willReload,
          payload:
            event && typeof event === 'object' && 'payload' in event
              ? String((event as { payload?: unknown }).payload)
              : String(event),
        },
      });
      const viteEvent = event as Event & { preventDefault?: () => void };
      viteEvent.preventDefault?.();
      if (willReload) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    });

    void (async () => {
      let staleStatus: number | null = null;
      let staleOk = false;
      let staleCacheControl: string | null = null;
      try {
        const staleRes = await fetch(staleChunk, { cache: 'no-store' });
        staleStatus = staleRes.status;
        staleOk = staleRes.ok;
        staleCacheControl = staleRes.headers.get('cache-control');
      } catch (error) {
        send({
          hypothesisId: 'A',
          location: 'src/admin/app.tsx:stale-fetch',
          message: 'Stale ListPage fetch threw',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      let browserHash: string | null = null;
      let listPageChunks: string[] = [];
      let hasBwrosfve = false;
      try {
        const metaRes = await fetch(metaUrl, { cache: 'no-store' });
        const meta = await metaRes.json();
        browserHash = meta?.browserHash ?? null;
        const chunkNames = Object.keys(meta?.chunks || {});
        listPageChunks = chunkNames.filter((name) => name.includes('ListPage'));
        hasBwrosfve = listPageChunks.some((name) => name.includes('BWROSFVE'));
      } catch (error) {
        send({
          hypothesisId: 'C',
          location: 'src/admin/app.tsx:meta-fetch',
          message: 'Vite metadata fetch failed',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const resourceEntries =
        typeof performance !== 'undefined'
          ? performance
              .getEntriesByType('resource')
              .map((entry) => (entry as PerformanceResourceTiming).name)
              .filter((name) => name.includes('ListPage'))
          : [];

      send({
        hypothesisId: 'A',
        location: 'src/admin/app.tsx:probe',
        message: 'ListPage stale vs current deps probe',
        data: {
          staleChunk,
          staleStatus,
          staleOk,
          staleCacheControl,
          browserHash,
          hasBwrosfve,
          listPageChunks,
          resourceEntries,
        },
      });

      try {
        const abs = await fetch(`http://localhost:1337${staleChunk}`, {
          cache: 'no-store',
        });
        send({
          hypothesisId: 'B',
          location: 'src/admin/app.tsx:abs-probe',
          message: 'Absolute localhost stale chunk probe',
          data: { status: abs.status, ok: abs.ok },
        });
      } catch (error) {
        send({
          hypothesisId: 'B',
          location: 'src/admin/app.tsx:abs-probe',
          message: 'Absolute localhost probe threw',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      if (listPageChunks.length > 0) {
        const currentFile = `${listPageChunks[0]}.js`;
        const currentUrl = `/admin/node_modules/.strapi/vite/deps/${currentFile}?v=${browserHash || 'c20fc924'}`;
        try {
          const currentRes = await fetch(currentUrl, { cache: 'no-store' });
          send({
            hypothesisId: 'E',
            location: 'src/admin/app.tsx:current-chunk',
            message: 'Current ListPage chunk probe',
            data: {
              currentUrl,
              status: currentRes.status,
              ok: currentRes.ok,
              cacheControl: currentRes.headers.get('cache-control'),
            },
          });
        } catch (error) {
          send({
            hypothesisId: 'E',
            location: 'src/admin/app.tsx:current-chunk',
            message: 'Current ListPage chunk probe threw',
            data: {
              currentUrl,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    })();
    // #endregion
  },
};
