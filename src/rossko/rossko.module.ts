import { Module } from '@nestjs/common';
import { RosskoService } from './rossko.service';
import { RosskoController } from './rossko.controller';

@Module({
  providers: [RosskoService],
  exports: [RosskoService],
  controllers: [RosskoController],
})
export class RosskoModule {}