/** Canonical key for grouping/deduping offers across supplier writing variants. */
export function normalizeArticle(value: string): string {
  return (value ?? '').toUpperCase().replace(/[-\s./]/g, '');
}
