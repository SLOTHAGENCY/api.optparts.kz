/** Русские окончания для суффиксного стеммера, отсортированы длинными вперёд. */
const ENDINGS = [
  'иями', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ями', 'ами', 'иях', 'иям',
  'ах', 'ях', 'ая', 'яя', 'ое', 'ее', 'ые', 'ый', 'ий', 'ой', 'ем', 'ом',
  'им', 'ым', 'их', 'ых', 'ов', 'ев', 'ей', 'ью', 'ья', 'ье', 'ам', 'ям',
  'а', 'я', 'о', 'е', 'ы', 'и', 'й', 'ь', 'у', 'ю',
].sort((x, y) => y.length - x.length);

/** Минимальная длина остатка после отсечения окончания. */
const MIN_STEM = 3;

export function stemRu(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= MIN_STEM) return w;
  for (const end of ENDINGS) {
    if (w.length - end.length >= MIN_STEM && w.endsWith(end)) {
      return w.slice(0, w.length - end.length);
    }
  }
  return w;
}

/** Диграфы латиница->кириллица (применяются раньше одиночных букв). */
const DIGRAPHS: Array<[RegExp, string]> = [
  [/shch/g, 'щ'], [/sch/g, 'щ'], [/sh/g, 'ш'], [/ch/g, 'ч'], [/zh/g, 'ж'],
  [/kh/g, 'х'], [/ya/g, 'я'], [/yu/g, 'ю'], [/yo/g, 'ё'], [/ts/g, 'ц'],
];
const SINGLES: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т',
  u: 'у', f: 'ф', h: 'х', c: 'ц', y: 'ы', w: 'в', x: 'кс', q: 'к',
};

export function transliterate(token: string): string {
  let t = token.toLowerCase();
  for (const [re, ru] of DIGRAPHS) t = t.replace(re, ru);
  return t
    .split('')
    .map((ch) => SINGLES[ch] ?? ch)
    .join('');
}

const STOPWORDS = new Set(['для', 'и', 'с', 'со', 'на', 'в', 'по', 'из', 'к', 'от', 'а']);

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^[a-z0-9]+$/.test(t) ? transliterate(t) : t))
    .filter((t) => !STOPWORDS.has(t))
    .map(stemRu)
    .filter(Boolean);
}

export function normToString(text: string): string {
  return normalize(text).join(' ');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
