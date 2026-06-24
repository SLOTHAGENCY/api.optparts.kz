import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersRegistry } from './suppliers.registry';
import { SUPPLIERS } from './supplier-connector.interface';
import { RosskoConnector } from './connectors/rossko/rossko.connector';
import { TabysConnector } from './connectors/tabys/tabys.connector';
import { SuppliersController } from './suppliers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SuppliersRegistry,
    RosskoConnector,
    TabysConnector,
    {
      provide: SUPPLIERS,
      useFactory: (rossko: RosskoConnector, tabys: TabysConnector) => [
        rossko,
        tabys,
      ],
      inject: [RosskoConnector, TabysConnector],
    },
  ],
  exports: [SuppliersService, SuppliersRegistry, SUPPLIERS],
})
export class SuppliersModule {}
