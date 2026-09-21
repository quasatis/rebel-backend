import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
  // Vite serves optimized admin deps with Cache-Control: max-age=31536000,immutable
  // while keeping the same `?v=` hash after a rebuild. Browsers then keep importers
  // that point at deleted ListPage-* filenames. Disable that cache in develop mode
  // and change `define` so the deps browserHash actually busts.
  return mergeConfig(config, {
    define: {
      'import.meta.env.REBEL_ADMIN_DEP_CACHE': JSON.stringify('no-store'),
    },
    server: {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  });
};
