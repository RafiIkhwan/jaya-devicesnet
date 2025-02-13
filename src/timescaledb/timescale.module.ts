import { Module } from '@nestjs/common';
import { TimescaleService } from './timescale.service';
import { TimescaleProvider } from './timescale.provider';
import { ConfigModule } from '@nestjs/config';
import { TimescaleController } from './timescale.controller';
@Module({
  imports: [
    ConfigModule.forRoot()
  ],
  controllers: [TimescaleController],
  providers: [TimescaleProvider, TimescaleService],
  exports: [TimescaleService]
})
export class TimescaleModule {}
