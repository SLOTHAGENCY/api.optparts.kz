import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { SupplierOrder } from '../orders/entities/supplier-order.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { SearchLog } from '../search/entities/search-log.entity';
import { User } from '../users/entities/user.entity';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, SupplierOrder, Supplier, SearchLog, User]),
  ],
  controllers: [AdminStatsController],
  providers: [AdminStatsService],
})
export class AdminStatsModule {}
