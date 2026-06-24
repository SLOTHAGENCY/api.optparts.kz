import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersRegistry } from './suppliers.registry';
import { SUPPLIERS } from './supplier-connector.interface';
import { RosskoConnector } from './connectors/rossko/rossko.connector';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier])],
  providers: [
    SuppliersService,
    SuppliersRegistry,
    RosskoConnector,
    {
      provide: SUPPLIERS,
      useFactory: (rossko: RosskoConnector) => [rossko],
      inject: [RosskoConnector],
    },
  ],
  exports: [SuppliersService, SuppliersRegistry, SUPPLIERS],
})
export class SuppliersModule {}
