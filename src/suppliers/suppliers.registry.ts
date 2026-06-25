import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SUPPLIERS, SupplierConnector } from './supplier-connector.interface';
import { SuppliersService } from './suppliers.service';

@Injectable()
export class SuppliersRegistry {
  constructor(
    @Inject(SUPPLIERS) private readonly connectors: SupplierConnector[],
    private readonly suppliersService: SuppliersService,
  ) {}

  async getActive(): Promise<SupplierConnector[]> {
    const rows = await this.suppliersService.findAll();
    const activeCodes = new Set(rows.filter((r) => r.isActive).map((r) => r.code));
    const candidates = this.connectors.filter((c) => activeCodes.has(c.code));
    const checked = await Promise.all(
      candidates.map(async (c) => ((await c.isConfigured()) ? c : null)),
    );
    return checked.filter((c): c is SupplierConnector => c !== null);
  }

  async getByCode(code: string): Promise<SupplierConnector> {
    const connector = this.connectors.find((c) => c.code === code);
    if (!connector) {
      throw new NotFoundException(`Supplier connector "${code}" is not registered.`);
    }
    const row = await this.suppliersService.findByCode(code);
    if (!row || !row.isActive) {
      throw new BadRequestException(`Supplier "${code}" is inactive.`);
    }
    return connector;
  }
}
