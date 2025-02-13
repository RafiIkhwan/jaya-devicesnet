import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { InfluxdbClientModule } from 'src/influxdb/influxdb.module';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { NodesModule } from 'src/nodes/nodes.module';
import { ApiKeysModule } from 'src/api-keys/api-keys.module';
import { TenantsModule } from 'src/tenants/tenants.module';
import { GatewaysModule } from 'src/gateways/gateways.module';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { ApiKeysGuard } from 'src/api-keys/guards/api-keys.guard';
import { TimescaleProvider } from 'src/timescaledb/timescale.provider';

@Module({
  imports: [
    AuthModule,
    InfluxdbClientModule,
    NodesModule,
    ApiKeysModule,
    TenantsModule,
    GatewaysModule,
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService, AccessTokenGuard, ApiKeysGuard, TimescaleProvider],
})
export class TelemetryModule {}
