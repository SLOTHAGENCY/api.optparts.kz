import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SuppliersModule, SettingsModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
