import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle])],
  providers: [GarageService],
  controllers: [GarageController],
  exports: [GarageService],
})
export class GarageModule {}
