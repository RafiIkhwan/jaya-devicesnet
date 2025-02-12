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
    await this.timescaleService.migrateAllTenants();
    return { message: 'Migration completed' };
  }
}
