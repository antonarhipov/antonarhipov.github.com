import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    url: z.string().default('#'),
    category: z.string().default('code'),
  }),
});

const talks = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/talks" }),
  schema: z.object({
    title: z.string(),
    order: z.coerce.number().int().optional(),
    summary: z.string().optional(),
    slidesUrl: z.string().url().optional(),
    videoUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, projects, talks };
