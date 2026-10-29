// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { existsSync, readdirSync } from 'node:fs';
import { BLOGS, blogUrl } from './src/blogs.ts';

// Old addresses only forward to new ones (see src/pages/[...moved].astro), so keep them out of the sitemap
const formerBlogPaths = BLOGS.flatMap((blog) => (blog.formerSlugs ?? []).map((slug) => `/${slug}/`));
/** @param {string} path */
const isMoved = (path) => /\/\d{4}\/\d{2}\/\d{2}\//.test(path) || formerBlogPaths.some((prefix) => path.startsWith(prefix));

// A blog's page with no posts is marked noindex (src/pages/[blog]/index.astro), so it doesn't belong in the sitemap either
const hasPosts = (/** @type {string} */ id) =>
  existsSync(`_posts/${id}`) && readdirSync(`_posts/${id}`).some((file) => /^\d{4}-\d{2}-\d{2}-.+\.mdx?$/.test(file));
const emptyBlogPaths = BLOGS.filter((blog) => !hasPosts(blog.id)).map(blogUrl);

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
