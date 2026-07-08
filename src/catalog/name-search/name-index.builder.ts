import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PartsCatalogService } from '../services/parts-catalog.service';
import { CatalogNameIndex } from '../entities/catalog-name-index.entity';
import { GroupNodeDto } from '../dto/catalog.dto';
import { NameSearchIndex } from './name-search-index.service';
import { normToString } from './name-normalize';

type NewRow = Pick<
  CatalogNameIndex,
  'kind' | 'catalogId' | 'groupId' | 'name' | 'parentName' | 'lang' | 'norm'
>;

/**
 * Материализует категории + подгруппы PartsIndex в таблицу catalog_name_index.
 * Дефолт крона — раз в месяц (1-го числа, полночь); переопределяется NAME_INDEX_CRON.
 * На старте грузит индекс из таблицы; если пусто — запускает первичный rebuild
 * в фоне (best-effort, не блокирует запуск приложения).
 */
@Injectable()
export class NameIndexBuilder implements OnModuleInit {
  private readonly logger = new Logger(NameIndexBuilder.name);
  private running = false;

  constructor(
    private readonly catalog: PartsCatalogService,
    private readonly dataSource: DataSource,
    private readonly index: NameSearchIndex,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.index.load();
    if (this.index.size() === 0) {
      this.logger.warn('Name index empty on startup — triggering initial rebuild.');
      this.rebuild().catch((err) =>
        this.logger.error('Initial name-index rebuild failed.', err?.stack ?? String(err)),
      );
    }
  }

  @Cron(process.env.NAME_INDEX_CRON || '0 0 1 * *', { name: 'rebuild-name-index' })
  cron(): Promise<void> {
    return this.rebuild()
      .then(() => undefined)
      .catch((err) =>
        this.logger.error('Scheduled name-index rebuild failed.', err?.stack ?? String(err)),
      );
  }

  async rebuild(lang = 'ru'): Promise<{ categories: number; groups: number }> {
    if (this.running) {
      this.logger.warn('Skipping rebuild: previous run still in progress.');
      return { categories: 0, groups: 0 };
    }
    this.running = true;
    try {
      const categories = await this.catalog.listCategories(lang);
      const rows: NewRow[] = [];

      for (const cat of categories) {
        rows.push({
          kind: 'category',
          catalogId: cat.id,
          groupId: null,
          name: cat.name,
          parentName: null,
          lang,
          norm: normToString(cat.name),
        });

        let tree: GroupNodeDto[] = [];
        try {
          tree = await this.catalog.groups(cat.id, lang);
        } catch (err: any) {
          this.logger.warn(`groups(${cat.id}) failed: ${err?.message ?? err}`);
        }
        this.flatten(tree, cat.id, cat.name, lang, rows);
      }

      const groupCount = rows.filter((r) => r.kind === 'group').length;

      await this.dataSource.transaction(async (manager) => {
        await manager.delete(CatalogNameIndex, { lang });
        // insert батчами по 500, чтобы не упереться в лимит параметров драйвера
        for (let i = 0; i < rows.length; i += 500) {
          await manager.insert(CatalogNameIndex, rows.slice(i, i + 500));
        }
      });

      await this.index.reload(lang);
      this.logger.log(
        `Name index rebuilt: categories=${categories.length} groups=${groupCount}`,
      );
      return { categories: categories.length, groups: groupCount };
    } finally {
      this.running = false;
    }
  }

  private flatten(
    nodes: GroupNodeDto[],
    catalogId: string,
    parentName: string,
    lang: string,
    out: NewRow[],
  ): void {
    for (const n of nodes) {
      out.push({
        kind: 'group',
        catalogId,
        groupId: n.id,
        name: n.name,
        parentName,
        lang,
        norm: normToString(n.name),
      });
      if (n.children?.length) this.flatten(n.children, catalogId, parentName, lang, out);
    }
  }
}
