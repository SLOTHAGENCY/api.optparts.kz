import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { normalize, levenshtein } from './name-normalize';
import { SYNONYMS } from './synonyms';
import { NameSuggestionDto } from './name-search.dto';

interface Entry {
  kind: 'category' | 'group';
  categoryId: string;
  groupId: string | null;
  name: string;
  parentName: string | null;
  tokens: string[];
}

@Injectable()
export class NameSearchIndex {
  private readonly logger = new Logger(NameSearchIndex.name);
  private entries: Entry[] = [];

  constructor(
    @InjectRepository(CatalogNameIndex)
    private readonly repo: Repository<CatalogNameIndex>,
  ) {}

  async load(lang = 'ru'): Promise<void> {
    const rows = await this.repo.find({ where: { lang } });
    this.entries = rows.map((r) => ({
      kind: r.kind,
      categoryId: r.catalogId,
      groupId: r.groupId,
      name: r.name,
      parentName: r.parentName,
      tokens: r.norm.split(' ').filter(Boolean),
    }));
    this.logger.log(`Name index loaded: ${this.entries.length} entries (lang=${lang})`);
  }

  reload(lang = 'ru'): Promise<void> {
    return this.load(lang);
  }

  size(): number {
    return this.entries.length;
  }

  suggest(query: string, _lang = 'ru', limit = 8): NameSuggestionDto[] {
    const qTokens = normalize(query);
    if (qTokens.length === 0) return [];

    const scored: Array<{ e: Entry; score: number }> = [];
    for (const e of this.entries) {
      let total = 0;
      let matchedAll = true;
      for (const qt of qTokens) {
        const s = this.bestTokenScore(qt, e.tokens);
        if (s <= 0) {
          matchedAll = false;
          break;
        }
        total += s;
      }
      if (!matchedAll) continue;
      if (e.kind === 'category') total += 15;
      if (e.name.length <= 15) total += 5;
      scored.push({ e, score: total });
    }

    scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length);
    return scored.slice(0, limit).map(({ e, score }) => ({
      kind: e.kind,
      categoryId: e.categoryId,
      groupId: e.groupId,
      name: e.name,
      parentName: e.parentName,
      score,
    }));
  }

  /** Лучший балл сопоставления одного query-токена с токенами записи. */
  private bestTokenScore(qt: string, tokens: string[]): number {
    const candidates = [qt, ...(SYNONYMS[qt] ?? [])];
    let best = 0;
    for (const tok of tokens) {
      for (const c of candidates) {
        const isPrimary = c === qt;
        if (tok === c) {
          best = Math.max(best, isPrimary ? 100 : 70);
        } else if (c.length >= 3 && tok.startsWith(c)) {
          best = Math.max(best, isPrimary ? 60 : 45);
        } else if (isPrimary) {
          const d = levenshtein(qt, tok);
          const tol = qt.length > 6 ? 2 : qt.length >= 3 ? 1 : 0;
          if (d > 0 && d <= tol) best = Math.max(best, 30 - d * 5);
        }
      }
    }
    return best;
  }
}
