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
          (NOW(), 'MMA2CBCBB0CF8B8', 'QC', 'temp', 23.5, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"location": "office"}'),
          (NOW(), 'MMACC7B5CA69334', 'QC', 'hum', 45.2, '00000000-0000-0000-0000-000000000002', '{"location": "warehouse"}'),
          ('2025-01-29T09:01:42Z', 'MMA2CBCBB0CF8B8', 'QC', 'RPM', 0, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-29T09:01:42Z', 'MMA2CBCBB0CF8B8', 'QC', 'Test', 0, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-24T02:02:31Z', 'MMA2CBCBB0CF8B8', 'QC', 'Test1', 100, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-24T02:02:31Z', 'MMA2CBCBB0CF8B8', 'QC', 'Test2', 200, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-21T04:53:26Z', 'MMA2CBCBB0CF8B8', 'QC', 'TestRPM', 0, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-21T04:53:26Z', 'MMA2CBCBB0CF8B8', 'QC', 'TestSwitc', 0, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-24T02:02:19Z', 'MMA2CBCBB0CF8B8', 'QC', 'TestTCP1', 1000, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-24T02:02:19Z', 'MMA2CBCBB0CF8B8', 'QC', 'TestTCP2', 2000, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "HUBF09E9E0D8294"}'),
          ('2025-01-21T08:49:48Z', 'MMA2CBCBB0CF8B8', 'QC', 'cDecimal', 2801810943, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "MMA2CBCBB0CF8B8"}'),
          ('2025-01-21T08:49:48Z', 'MMA2CBCBB0CF8B8', 'QC', 'cFloat', 4283318625, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "MMA2CBCBB0CF8B8"}'),
          ('2025-01-21T08:49:48Z', 'MMA2CBCBB0CF8B8', 'QC', 'flowrate', 0, '07cc4859-64a1-45a7-bcd4-ba0d222708d5', '{"gateway": "MMA2CBCBB0CF8B8"}');

        -- Seed device health data
        INSERT INTO device_health (time, device_id, uptime, status, tenant_id)
        VALUES 
          (NOW(), 'MMA2CBCBB0CF8B8', 123456, 'online', '07cc4859-64a1-45a7-bcd4-ba0d222708d5'),
          (NOW(), 'MMACC7B5CA69334', 654321, 'offline', '00000000-0000-0000-0000-000000000002'),
          ('2025-02-05T09:39:29Z', 'MMA2CBCBB0CF8B8', 14, 'OFFLINE', '07cc4859-64a1-45a7-bcd4-ba0d222708d5');
      `);

      this.logger.log('TimescaleDB data seeded successfully');
    } catch (error) {
      this.logger.error('Failed to seed TimescaleDB data:', error);
      throw error;
    }
  }
}