# Status

## Current position
- Implemented homepage improvements (hero pillars, “Start here”, explicit CTAs) and added an owned conversion channel via `RSS`.
- Added `draft` frontmatter support for blog posts; draft posts are excluded from being published.
- Added explicit ordering for talks via `order` frontmatter; talks lists are now sorted deterministically.
- Project external links are rendered on the project page header (similar to `slidesUrl` for talks), not on project cards.

## Task table

| Area | Task | Status |
| --- | --- | --- |
| Home | Add “Start here” section above latest writing | Done |
| Home | Add topic/pillar badges under the hero | Done |
| Home | Add explicit CTAs (blog + talks) and a speaking inquiry link | Done |
| Home | Tighten recent talks selection without relying on talk dates | Done |
| Growth | Add an RSS feed endpoint and link it from the homepage | Done |
| Content | Add `draft` metadata to blog posts and exclude drafts from publication | Done |
| Content | Add a way to reorder talks in the talks list | Done |
| Projects | Render project external URL link on the project page header (not on cards) | Done |
| Build | Run `npm run build` and fix any issues | Done |
