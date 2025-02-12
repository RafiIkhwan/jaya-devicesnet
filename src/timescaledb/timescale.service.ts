import { Inject, Injectable, Logger } from '@nestjs/common';
import { InfluxDB } from '@influxdata/influxdb-client';
import { INFLUXDB_CLIENT } from '../influxdb/influxdb.constant';
import { TenantsService } from '../tenants/tenants.service';
import { NodesService } from '../nodes/nodes.service';
import { GatewaysService } from '../gateways/gateways.service';
import { MigrationOptions } from './interfaces/migration.interface';
import { ConfigService } from '@nestjs/config';
import { TimescaleProvider } from './timescale.provider';

@Injectable()
export class TimescaleService {
  private readonly logger = new Logger(TimescaleService.name);
  private queryApi;

  constructor(
    private timescaleProvider: TimescaleProvider,
    @Inject(INFLUXDB_CLIENT)
    private influxDb: InfluxDB,
    private configService: ConfigService,
    private tenantsService: TenantsService,
    private nodesService: NodesService,
    private gatewaysService: GatewaysService,
  ) {
    const org = this.configService.get('INFLUXDB_ORG_ID');
    const queryApi = this.influxDb.getQueryApi(org);
    this.queryApi = queryApi;
  }

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

  async migrateTelemetryData(options: MigrationOptions): Promise<void> {
    const {
      tenant,
      startTime = '-30d',
      endTime = 'now()',
      batchSize = 1000,
    } = options;

    const fluxQuery = `
      from(bucket: "${tenant}")
        |> range(start: ${startTime}, stop: ${endTime})
        |> filter(fn: (r) => r["_measurement"] != "deviceshealth")
    `;

    try {
      
      await this.timescaleProvider.query('BEGIN');
      
      let recordCount = 0;
      for await (const record of this.queryApi.queryRows(fluxQuery)) {
        const values = [
          record._time,
          record.device,
          record._measurement,
          record._field,
          record._value,
          record.tenant_id,
          this.extractTags(record)
        ];

        await this.timescaleProvider.query(
          `INSERT INTO device_telemetry 
           (time, device_id, measurement, field, value, tenant_id, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          values
        );

        recordCount++;
        if (recordCount % batchSize === 0) {
          await this.timescaleProvider.query('COMMIT');
          await this.timescaleProvider.query('BEGIN');
          this.logger.log(`Processed ${recordCount} telemetry records`);
        }
      }

      await this.timescaleProvider.query('COMMIT');
      this.logger.log(`Telemetry migration completed. Total records: ${recordCount}`);
    } catch (error) {
      await this.timescaleProvider.query('ROLLBACK');
      this.logger.error('Failed to migrate telemetry data:', error);
      throw error;
    }
  }

  async migrateHealthData(options: MigrationOptions): Promise<void> {
    const {
      tenant,
      startTime = '-30d',
      endTime = 'now()',
      batchSize = 1000,
    } = options;

    const fluxQuery = `
      from(bucket: "${tenant}")
        |> range(start: ${startTime}, stop: ${endTime})
        |> filter(fn: (r) => r["_measurement"] == "deviceshealth")
    `;

    try {
      await this.timescaleProvider.query('BEGIN');

      let recordCount = 0;
      for await (const record of this.queryApi.queryRows(fluxQuery)) {
        const values = [
          record._time,
          record.device,
          record.uptime || 0,
          this.calculateStatus(record),
          record.tenant_id
        ];

        await this.timescaleProvider.query(
          `INSERT INTO device_health 
           (time, device_id, uptime, status, tenant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          values
        );

        recordCount++;
        if (recordCount % batchSize === 0) {
          await this.timescaleProvider.query('COMMIT');
          await this.timescaleProvider.query('BEGIN');
          this.logger.log(`Processed ${recordCount} health records`);
        }
      }

      await this.timescaleProvider.query('COMMIT');
      this.logger.log(`Health data migration completed. Total records: ${recordCount}`);
    } catch (error) {
      await this.timescaleProvider.query('ROLLBACK');
      this.logger.error('Failed to migrate health data:', error);
      throw error;
    }
  }

  async verifyMigration(tenantId: string): Promise<any> {
    try {
      const result = await this.timescaleProvider.query(`
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT device_id) as unique_devices,
          MIN(time) as earliest_record,
          MAX(time) as latest_record
        FROM device_telemetry
        WHERE tenant_id = $1;
      `, [tenantId]);

      return result.rows[0];
    } catch (error) {
      this.logger.error('Failed to verify migration:', error);
      throw error;
    }
  }

  async migrateAllTenants(): Promise<void> {
    try {
      // Create schema first
      await this.createSchema();

      // Get all tenants
      const tenants = await this.tenantsService.findAll({});

      // Migrate each tenant's data
      for (const tenant of tenants) {
        this.logger.log(`Starting migration for tenant: ${tenant.name}`);
        
        await this.migrateTelemetryData({
          tenant: tenant.name,
          startTime: '-90d', // Adjust time range as needed
          endTime: 'now()',
        });

        await this.migrateHealthData({
          tenant: tenant.name,
          startTime: '-90d',
          endTime: 'now()',
        });

        const verificationResult = await this.verifyMigration(tenant.id);
        this.logger.log(`Migration verification for ${tenant.name}:`, verificationResult);
      }

      this.logger.log('All tenants migrated successfully');
    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    }
  }

  

  private extractTags(record: any): object {
    const tags: any = {};
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith('_') && key !== 'device' && key !== 'tenant_id') {
        tags[key] = value;
      }
    }
    return tags;
  }

  private calculateStatus(record: any): string {
    const timeNow = new Date().getTime();
    const recordTime = new Date(record._time).getTime();
    const diff = (timeNow - recordTime) / 1000;
    return diff < 60 ? 'ONLINE' : 'OFFLINE';
  }
}