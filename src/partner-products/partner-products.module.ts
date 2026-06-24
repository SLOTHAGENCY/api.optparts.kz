import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerProduct } from './entities/partner-product.entity';
import { PartnerProductsService } from './partner-products.service';
import { PartnerProductsController } from './partner-products.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerProduct])],
  providers: [PartnerProductsService],
  controllers: [PartnerProductsController],
  exports: [PartnerProductsService],
})
export class PartnerProductsModule {}
