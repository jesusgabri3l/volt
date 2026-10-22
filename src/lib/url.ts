// Prefixes a root-relative path with the deploy base ('/volt' on GitHub Pages), so links and
// assets work whether the site is served from / or a subfolder.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export const withBase = (path: string) => `${base}${path}`;
