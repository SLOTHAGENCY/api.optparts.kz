import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersRegistry } from './suppliers.registry';
import { SUPPLIERS } from './supplier-connector.interface';
import { RosskoConnector } from './connectors/rossko/rossko.connector';
import { TabysConnector } from './connectors/tabys/tabys.connector';
import { ShateMConnector } from './connectors/shatem/shatem.connector';
import { SuppliersController } from './suppliers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SuppliersRegistry,
    RosskoConnector,
    TabysConnector,
    ShateMConnector,
    {
      provide: SUPPLIERS,
      useFactory: (
        rossko: RosskoConnector,
        tabys: TabysConnector,
        shatem: ShateMConnector,
      ) => [rossko, tabys, shatem],
      inject: [RosskoConnector, TabysConnector, ShateMConnector],
    },
  ],
  exports: [SuppliersService, SuppliersRegistry, SUPPLIERS],
})
export class SuppliersModule {}
