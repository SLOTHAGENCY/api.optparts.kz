import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SUPPLIERS, SupplierConnector } from '../suppliers/supplier-connector.interface';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SearchLog } from '../search/entities/search-log.entity';
import {
  ConnectorStatus,
  MonitoringConnectorDto,
  MonitoringResponseDto,
  MonitoringStatsDto,
} from './dto/monitoring-response.dto';

const WINDOW_HOURS = 24;

@Injectable()
export class MonitoringService {
  constructor(
    @Inject(SUPPLIERS) private readonly connectors: SupplierConnector[],
    private readonly suppliersService: SuppliersService,
    @InjectRepository(SearchLog)
    private readonly searchLogRepo: Repository<SearchLog>,
  ) {}

  async getMonitoring(): Promise<MonitoringResponseDto> {
    const connectors = await this.buildConnectors();
    const stats = await this.buildStats();
    return { connectors, stats, generatedAt: new Date().toISOString() };
  }

  private async buildConnectors(): Promise<MonitoringConnectorDto[]> {
    const rows = await this.suppliersService.findAll();
    const activeByCode = new Map(rows.map((r) => [r.code, r.isActive]));

    const dtos = await Promise.all(
      this.connectors.map(async (c) => {
        const isActive = activeByCode.get(c.code) ?? false;
        let isConfigured = false;
        try {
          isConfigured = await c.isConfigured();
        } catch {
          isConfigured = false;
        }
        return {
          code: c.code,
          name: c.name,
          isActive,
          isConfigured,
          status: this.statusOf(isActive, isConfigured),
        };
      }),
    );

    return dtos.sort((a, b) => a.code.localeCompare(b.code));
  }

  private statusOf(isActive: boolean, isConfigured: boolean): ConnectorStatus {
    if (!isActive) return 'disabled';
    if (!isConfigured) return 'misconfigured';
    return 'online';
  }

  private async buildStats(): Promise<MonitoringStatsDto> {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);
    const raw = await this.searchLogRepo
      .createQueryBuilder('log')
      .select('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(log.suppliersQueried), 0)', 'queried')
      .addSelect('COALESCE(SUM(log.suppliersFailed), 0)', 'failed')
      .where('log.createdAt >= :since', { since })
      .getRawOne<{ cnt: string; queried: string; failed: string }>();

    const searchCount = Number(raw?.cnt ?? 0);
    const suppliersQueriedTotal = Number(raw?.queried ?? 0);
    const suppliersFailedTotal = Number(raw?.failed ?? 0);
    const successRate =
      suppliersQueriedTotal > 0
        ? Math.round(
            ((suppliersQueriedTotal - suppliersFailedTotal) / suppliersQueriedTotal) * 1000,
          ) / 1000
        : 1;

    return {
      windowHours: WINDOW_HOURS,
      searchCount,
      suppliersQueriedTotal,
      suppliersFailedTotal,
      successRate,
    };
  }
}
