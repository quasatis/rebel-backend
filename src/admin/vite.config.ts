import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
  // Develop-mode Vite otherwise serves optimized deps as immutable year-long
  // cache, so browsers keep importing deleted ListPage-* chunk filenames.
  return mergeConfig(config, {
    server: {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  });
};
