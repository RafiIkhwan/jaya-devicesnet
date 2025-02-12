import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TimescaleProvider implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    this.pool = new Pool({
      user: this.configService.get<string>('TIMESCALEDB_USER'),
      host: this.configService.get<string>('TIMESCALEDB_HOST'),
      database: this.configService.get<string>('TIMESCALEDB_NAME'),
      password: this.configService.get<string>('TIMESCALEDB_PASSSWORD'),
      port: this.configService.get<number>('TIMESCALEDB_PORT'),
    });
  }

  async onModuleInit() {
    try {
      const extensions = await this.pool.query('select extname, extversion from pg_extension', []);
      extensions.rows.forEach(e => {
        console.log(e)
      });
    } catch (error) {
      console.error('Failed to connect to TimescaleDB:', error);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query(text: string, params?: any[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  }
}