// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site: https://jesusgabri3l.github.io/volt/
  // `site` makes the share card URL absolute (og:image must be).
  site: 'https://jesusgabri3l.github.io',
  base: '/volt',
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
    },
  ],
});
