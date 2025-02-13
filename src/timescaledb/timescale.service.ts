import { Injectable, Logger } from '@nestjs/common';
import { TimescaleProvider } from './timescale.provider';

@Injectable()
export class TimescaleService {
  private readonly logger = new Logger(TimescaleService.name);

  constructor(
    private timescaleProvider: TimescaleProvider,
  ) {  }

  async createSchema(): Promise<void> {
    try {
      await this.timescaleProvider.query(`
        -- Create extension if not exists
        CREATE EXTENSION IF NOT EXISTS timescaledb;

        -- Create device telemetry table
        CREATE TABLE IF NOT EXISTS device_telemetry (
          time TIMESTAMPTZ NOT NULL,
          device_id VARCHAR(30) NOT NULL,
          measurement VARCHAR(50) NOT NULL,
          field VARCHAR(50) NOT NULL,
          value DOUBLE PRECISION,
          tenant_id UUID NOT NULL,
          tags JSONB,
          FOREIGN KEY (tenant_id) REFERENCES "Tenants"(id)
        );

        -- Create device health table
        CREATE TABLE IF NOT EXISTS device_health (
          time TIMESTAMPTZ NOT NULL,
          device_id VARCHAR(30) NOT NULL,
          uptime INTEGER,
          status VARCHAR(20),
          tenant_id UUID NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES "Tenants"(id)
        );

        -- Create hypertables
        SELECT create_hypertable('device_telemetry', 'time', if_not_exists => TRUE);
        SELECT create_hypertable('device_health', 'time', if_not_exists => TRUE);

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_device_telemetry_device 
        ON device_telemetry(device_id, time DESC);
        
        CREATE INDEX IF NOT EXISTS idx_device_health_device 
        ON device_health(device_id, time DESC);
      `);
      
      this.logger.log('TimescaleDB schema created successfully');
    } catch (error) {
      this.logger.error('Failed to create TimescaleDB schema:', error);
      throw error;
    }
  }

  async seedData(): Promise<void> {
    try {
      await this.timescaleProvider.query(`
        -- Seed device telemetry data
        INSERT INTO device_telemetry (time, device_id, measurement, field, value, tenant_id, tags)
        VALUES 
          (NOW(), 'device1', 'temperature', 'temp', 23.5, '00000000-0000-0000-0000-000000000001', '{"location": "office"}'),
          (NOW(), 'device2', 'humidity', 'hum', 45.2, '00000000-0000-0000-0000-000000000002', '{"location": "warehouse"}');

        -- Seed device health data
        INSERT INTO device_health (time, device_id, uptime, status, tenant_id)
        VALUES 
          (NOW(), 'device1', 123456, 'online', '00000000-0000-0000-0000-000000000001'),
          (NOW(), 'device2', 654321, 'offline', '00000000-0000-0000-0000-000000000002');
      `);

      this.logger.log('TimescaleDB data seeded successfully');
    } catch (error) {
      this.logger.error('Failed to seed TimescaleDB data:', error);
      throw error;
    }
  }
}