import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingService } from './pricing.service';
import { BrandMarkup } from './entities/brand-markup.entity';
import { BrandMarkupService } from './brand-markup.service';
import { BrandMarkupController } from './brand-markup.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([BrandMarkup]), SuppliersModule, SettingsModule],
  controllers: [BrandMarkupController],
  providers: [PricingService, BrandMarkupService],
  exports: [PricingService, BrandMarkupService],
})
export class PricingModule {}
