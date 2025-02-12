import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { NodesModule } from './nodes/nodes.module';
import { TenantsModule } from './tenants/tenants.module';
import { GatewaysModule } from './gateways/gateways.module';
import { TypesModule } from './types/types.module';
import { RequestLogsModule } from './request-logs/request-logs.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestLogsInterceptor } from './request-logs/request-logs.interceptor';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { ServiceConnectorModule } from './service-connector/service-connector.module';
import { MqttAccountModule } from './mqtt-account/mqtt-account.module';
import { MqttAclModule } from './mqtt-acl/mqtt-acl.module';
import { TimescaleModule } from './timescaledb/timescale.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    NodesModule,
    TenantsModule,
    GatewaysModule,
    TypesModule,
    RequestLogsModule,
    ProvisioningModule,
    ApiKeysModule,
    TelemetryModule,
    ServiceConnectorModule,
    MqttAccountModule,
    MqttAclModule,
    TimescaleModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLogsInterceptor,
    },
  ],
})
export class AppModule {}
