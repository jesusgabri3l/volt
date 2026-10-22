// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Absolute URL of the deployed site, needed for the share card (og:image must be absolute).
  // Set SITE_URL in the hosting provider's environment, e.g. https://volt.vercel.app
  site: process.env.SITE_URL,
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
