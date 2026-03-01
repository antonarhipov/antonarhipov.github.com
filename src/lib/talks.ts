import type { CollectionEntry } from 'astro:content';

type TalkEntry = CollectionEntry<'talks'>;

function getNumericPrefix(id: string): number | null {
  const match = id.match(/^(\d+)[-_]/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getEffectiveOrder(talk: TalkEntry): number | null {
  return talk.data.order ?? getNumericPrefix(talk.id);
}

/**
 * Sort talks by an explicit `order` (higher is earlier). If `order` is not set,
 * fall back to numeric filename prefix (e.g., `06-...`) and finally to `id`.
 */
export function compareTalks(a: TalkEntry, b: TalkEntry): number {
  const aOrder = getEffectiveOrder(a);
  const bOrder = getEffectiveOrder(b);

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return bOrder - aOrder;
  if (aOrder !== null && bOrder === null) return -1;
  if (aOrder === null && bOrder !== null) return 1;

  return b.id.localeCompare(a.id);
}
