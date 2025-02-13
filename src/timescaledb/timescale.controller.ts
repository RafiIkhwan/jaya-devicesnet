import {
  ClassSerializerInterceptor,
  Controller,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { TimescaleService } from './timescale.service';

@Controller('timescale')
@UseInterceptors(ClassSerializerInterceptor)
export class TimescaleController {
  constructor(private timescaleService: TimescaleService) {}

  @Post('migrate')
  async migrateTenant() {
    await this.timescaleService.createSchema();
    return { message: 'Migration completed' };
  }

  @Post('seed')
  async seedData() {
    await this.timescaleService.seedData();
    return { message: 'Data seeded' };
  }
}
