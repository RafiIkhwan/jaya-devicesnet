import { Module } from '@nestjs/common';
import { TimescaleService } from './timescale.service';
import { TimescaleProvider } from './timescale.provider';
import { ConfigModule } from '@nestjs/config';
import { TenantsModule } from 'src/tenants/tenants.module';
import { NodesModule } from 'src/nodes/nodes.module';
import { GatewaysModule } from 'src/gateways/gateways.module';
import { TimescaleController } from './timescale.controller';
import { InfluxdbClientModule } from 'src/influxdb/influxdb.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TenantsModule,
    NodesModule,
    InfluxdbClientModule,
    GatewaysModule
  ],
  controllers: [TimescaleController],
  providers: [TimescaleProvider, TimescaleService],
  exports: [TimescaleService]
})
export class TimescaleModule {}
