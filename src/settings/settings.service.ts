import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from './entities/app-setting.entity';

export interface AppSettings {
  DEFAULT_MARKUP_PERCENT: number;
  FX_RATES: Record<string, number>;
  FX_BUFFER_PERCENT: number;
}

const DEFAULTS: AppSettings = {
  DEFAULT_MARKUP_PERCENT: 20,
  FX_RATES: { KZT: 1 },
  FX_BUFFER_PERCENT: 0,
};

const CACHE_TTL_MS = 10_000;

@Injectable()
export class SettingsService {
  private cache: AppSettings | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
  ) {}

  async getAll(): Promise<AppSettings> {
    if (this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: keyof AppSettings, d: number) => {
      const v = Number(map.get(k as string));
      return Number.isFinite(v) ? v : d;
    };
    this.cache = {
      DEFAULT_MARKUP_PERCENT: num('DEFAULT_MARKUP_PERCENT', DEFAULTS.DEFAULT_MARKUP_PERCENT),
      FX_RATES:
        (map.get('FX_RATES') as Record<string, number>) ?? DEFAULTS.FX_RATES,
      FX_BUFFER_PERCENT: num('FX_BUFFER_PERCENT', DEFAULTS.FX_BUFFER_PERCENT),
    };
    this.cachedAt = Date.now();
    return this.cache;
  }

  async getDefaultMarkup(): Promise<number> {
    return (await this.getAll()).DEFAULT_MARKUP_PERCENT;
  }
  async getFxRates(): Promise<Record<string, number>> {
    return (await this.getAll()).FX_RATES;
  }
  async getFxBufferPercent(): Promise<number> {
    return (await this.getAll()).FX_BUFFER_PERCENT;
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.repo.save({ key, value } as AppSetting);
    }
    this.cache = null;
  }
}
