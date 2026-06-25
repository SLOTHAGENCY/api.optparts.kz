import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersRegistry } from './suppliers.registry';
import { SUPPLIERS } from './supplier-connector.interface';
import { RosskoConnector } from './connectors/rossko/rossko.connector';
import { TabysConnector } from './connectors/tabys/tabys.connector';
import { ShateMConnector } from './connectors/shatem/shatem.connector';
import { AutotradeConnector } from './connectors/autotrade/autotrade.connector';
import { SuppliersController } from './suppliers.controller';
import { RateLimiterRegistry } from './rate-limiter.registry';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SuppliersRegistry,
    RateLimiterRegistry,
    RosskoConnector,
    TabysConnector,
    ShateMConnector,
    AutotradeConnector,
    {
      provide: SUPPLIERS,
      useFactory: (
        rossko: RosskoConnector,
        tabys: TabysConnector,
        shatem: ShateMConnector,
        autotrade: AutotradeConnector,
      ) => [rossko, tabys, shatem, autotrade],
      inject: [RosskoConnector, TabysConnector, ShateMConnector, AutotradeConnector],
    },
  ],
  exports: [SuppliersService, SuppliersRegistry, RateLimiterRegistry, SUPPLIERS],
})
export class SuppliersModule {}
