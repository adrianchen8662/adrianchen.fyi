// @ts-check
import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { BLOGS } from './src/blogs.ts';

// Old addresses only forward to new ones (see src/pages/[...moved].astro), so keep them out of the sitemap
const formerBlogPaths = BLOGS.flatMap((blog) => (blog.formerSlugs ?? []).map((slug) => `/${slug}/`));
/** @param {string} path */
const isMoved = (path) => /\/\d{4}\/\d{2}\/\d{2}\//.test(path) || formerBlogPaths.some((prefix) => path.startsWith(prefix));

// Blogs with no posts yet only say "No posts yet.", which Google counts as thin content, so they wait until they have one
const emptyBlogPaths = BLOGS.filter((blog) => {
  const dir = `./_posts/${blog.id}`;
  return !existsSync(dir) || !readdirSync(dir).some((name) => /\.mdx?$/.test(name));
}).map((blog) => `/${blog.slug}/`);

export default defineConfig({
  site: 'https://adrianchen.fyi',
  // Code blocks: GitHub's dark theme, whose comments stay readable (the default's don't pass contrast)
  markdown: { shikiConfig: { theme: 'github-dark-default' } },
  // Images next to posts and in the timeline are compressed and served in several sizes;
  // files in public/ (full-size photos, say) are published untouched
  image: { layout: 'constrained' },
  integrations: [
    react(),
    mdx(),
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        return !isMoved(path) && !emptyBlogPaths.includes(path);
      },
    }),
  ],
});
