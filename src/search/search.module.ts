import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchLog } from './entities/search-log.entity';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SearchLog]),
    SuppliersModule,
    PricingModule,
    SettingsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
