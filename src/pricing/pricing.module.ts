import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { SuppliersModule } from '../suppliers/suppliers.module';

@Module({
  imports: [SuppliersModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
