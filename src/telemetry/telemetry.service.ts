import { InfluxDB, QueryApi } from '@influxdata/influxdb-client';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodesService } from 'src/nodes/nodes.service';
import { INFLUXDB_CLIENT } from 'src/influxdb/influxdb.constant';
import { TenantsService } from 'src/tenants/tenants.service';
import { GatewaysService } from 'src/gateways/gateways.service';
import { GatewaysEntity } from 'src/gateways/entity/gateways.entity';
import { NodesEntity } from 'src/nodes/entity/node.entity';
import { TimescaleProvider } from 'src/timescaledb/timescale.provider';

Injectable();
export class TelemetryService {
  private queryApi: QueryApi;

  constructor(
    @Inject(INFLUXDB_CLIENT) private influx: InfluxDB,
    private configService: ConfigService,
    private nodesService: NodesService,
    private tenantsService: TenantsService,
    private gatewaysService: GatewaysService,
    private timescaleProvider: TimescaleProvider,
  ) {
    const org = this.configService.get('INFLUXDB_ORG_ID');
    const queryApi = this.influx.getQueryApi(org);
    this.queryApi = queryApi;
  }
  async findLast(query: any, deviceNumber: string) {
    const device = await this.nodesService.findOneWithSerialNumber({
      serialNumber: deviceNumber,
    });

    const { serialNumber, tenant, type } = device;
    const { fields, ...tags }: { fields: string } = query;
    const filterFields =
      fields !== undefined
        ? fields
            .split(',')
            .map((x) => `field = '${x}'`)
            .join(' OR ')
        : '';
  
    const filterTags: Array<string> = [];
    for (const key in tags) {
      if (Object.prototype.hasOwnProperty.call(tags, key)) {
        filterTags.push(`tags->>'${key}' = '${tags[key]}'`);
      }
    }

    const filterTagsSQL =
      filterTags.length !== 0 ? `AND (${filterTags.join(' OR ')})` : '';
    const filterFieldsSQL =
      filterFields === '' ? '' : `AND (${filterFields})`;

    const sqlQuery = `
    WITH fields AS (
      SELECT DISTINCT field 
      FROM device_telemetry 
      WHERE measurement = '${type}'
    )
    SELECT 
      time_bucket('30 days', dt.time) AS bucket,
      dt.device_id,
      dt.field,
      dt.value
    FROM fields f
    CROSS JOIN LATERAL (
      SELECT time, device_id, field, value
      FROM device_telemetry
      WHERE tenant_id = '${tenant?.id}'
        AND measurement = '${type}'
        AND device_id = '${serialNumber}'
        AND field = f.field
        ${filterTagsSQL}
        ${filterFieldsSQL}
      ORDER BY time DESC
      LIMIT 1
    ) dt;`;

    const resultQuery = await this.timescaleProvider.query(sqlQuery);
    const obj = {};
    resultQuery.forEach((data: any) => {
      obj[data.field] = data;
    });

    const statusSQL = `
    SELECT * FROM device_health
    WHERE tenant_id = '${tenant?.id}'
    AND device_id = '${serialNumber}'
    ORDER BY time DESC
    LIMIT 1`;
    const resultStatus = await this.timescaleProvider.query(statusSQL);
    const timeNow = new Date().getTime();
    const dataOnline = resultStatus?.map((data: any) => {
      const point = data;
      const diff =
        (timeNow - new Date(point.time as string).getTime()) / 1000;
      point['status'] = diff < 60 ? 'ONLINE' : 'OFFLINE';
      point['alias'] = device.alias;
      return point;
    });
    return { telemetry: obj, statusDevice: dataOnline?.[0] };
  }

  async findHistory(query: any, deviceNumber: string) {
    const device = await this.nodesService.findOneWithSerialNumber({
      serialNumber: deviceNumber,
    });

    const { serialNumber, tenant, type } = device;
    const {
      fields,
      startTime,
      endTime,
      aggregate,
      ...tags
    }: {
      fields: string;
      startTime: string;
      endTime: string;
      aggregate: string;
    } = query;
    const filterFields = fields
      .split(',')
      .map((x) => `r["_field"] == "${x}"`)
      .join(' or ');

    const filterTags: Array<string> = [];
    for (const key in tags) {
      if (Object.prototype.hasOwnProperty.call(tags, key)) {
        filterTags.push(`r["${key}"] == "${tags[key]}"`);
      }
    }

    const filterTagsFlux =
      filterTags.length !== 0
        ? `|> filter(fn: (r) => ${filterTags.join(' or ')})`
        : '';

    const aggreateFlux =
      aggregate !== undefined
        ? `|> aggregateWindow(every: ${aggregate}, fn: median)`
        : '';

    const fluxQuery = `
    from(bucket: "${tenant?.name}")
    |> range(start: ${startTime}, stop: ${endTime})
    |> filter(fn: (r) => r["_measurement"] == "${type}")
    ${filterTagsFlux}
    |> filter(fn: (r) => r["device"] == "${serialNumber}")
    |> filter(fn: (r) => ${filterFields})
    ${aggreateFlux}
    |> drop(columns: ["_start", "_stop"])`;

    const resultQuery = await this.queryApi.collectRows(fluxQuery);
    const obj = {};
    fields.split(',').forEach((data) => {
      const dataInflux = resultQuery.filter(
        (x: any) => x._field === data,
      ) as any;
      obj[data] = dataInflux;
    });
    return obj;
  }

  async statusDevices(tenantName: string, type?: string) {
    const tenant = await this.tenantsService.findOne({
      name: tenantName,
    });
    const nodes = await this.nodesService.findAll({
      where: {
        tenantId: tenant.id,
        AND: {
          type,
        },
      },
    });
    const gateways = await this.gatewaysService.findAll({
      where: {
        tenantId: tenant.id,
        AND: {
          type,
        },
      },
    });
    const devices = nodes.concat(gateways);
    if (devices.length === 0)
      return {
        nodes: [],
        gateways: [],
        timeNow: new Date().getTime(),
      };

    const filterDevices = devices
      .map((device) => device.serialNumber)
      .join('|');
    const devicefluxQuery = `
    from(bucket: "${tenant.name}")
    |> range(start: 0)
    |> filter(fn: (r) => r["_measurement"] == "deviceshealth")
    |> filter(fn: (r) => r["device"] =~ /${filterDevices}/)
    |> last()
    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group(columns: ["device"])
    |> sort(columns: ["_time"], desc: false) 
    |> last(column: "device")
    |> drop(columns: ["_start", "_stop"])`;
    const deviceHealthData = await this.queryApi.collectRows(devicefluxQuery);

    const timeNow = new Date().getTime();

    const calculateDataOnline = (
      data: Array<any>,
      devices: { alias: string; serialNumber: string; id: string }[],
    ) => {
      return devices
        .map((device) => {
          const point = data.find((x) => x.device === device.serialNumber);
          if (point === undefined) return;
          const diff =
            (timeNow - new Date(point._time as string).getTime()) / 1000;
          point['status'] = diff < 60 ? 'ONLINE' : 'OFFLINE';
          point['alias'] = device.alias;
          point['id'] = device.id;
          return point;
        })
        .filter((x) => x);
    };
    return {
      nodes: calculateDataOnline(deviceHealthData, nodes),
      gateways: calculateDataOnline(deviceHealthData, gateways),
      timeNow,
    };
  }

  async runtime(
    startTime: string,
    endTime: string,
    tenantName: string,
    type: string,
    field: string,
  ) {
    const tenant = await this.tenantsService.findOne({
      name: tenantName,
    });
    const nodes = await this.nodesService.findAll({
      where: {
        tenantId: tenant.id,
        type,
      },
    });

    const filterNodes = nodes.map((node) => node.serialNumber).join('|');
    const fluxQuery = `
    import "contrib/tomhollingworth/events"
    import "experimental/array"
    import "math"

    from(bucket: "${tenantName}")
      |> range(start: ${startTime}, stop: ${endTime})
      |> filter(fn: (r) => r["_measurement"] == "${type}")
      |> filter(fn: (r) => r["device"] =~ /${filterNodes}/)
      |> filter(fn: (r) => r["_field"] == "${field}")
      |> events.duration(unit: 1s)
      |> filter(fn: (r) => r["_value"] == 1)
      |> sum(column: "duration")
      |> map(fn: (r) => ({  device: r["device"], _value: math.round(x: float(v:r["duration"]) / 60.00) }))`;

    const runtimeData = await this.queryApi.collectRows(fluxQuery);
    return nodes.map((node) => {
      const runtime: any = runtimeData.find(
        (data: any) => data.device === node.serialNumber,
      );
      return {
        _value: runtime === undefined ? 0 : runtime._value,
        alias: node.alias,
        serialNumber: node.serialNumber,
      };
    });
  }

  async runtimePerDevice(
    startTime: string,
    endTime: string,
    serialNumber: string,
    field: string,
  ) {
    const node = await this.nodesService.findOne({
      serialNumber,
    });
    const fluxQuery = `
    import "contrib/tomhollingworth/events"
    import "experimental/array"
    import "math"

    from(bucket: "${node.tenant?.name}")
      |> range(start: ${startTime}, stop: ${endTime})
      |> filter(fn: (r) => r["_measurement"] == "${node.type}")
      |> filter(fn: (r) => r["device"] == "${node.serialNumber}")
      |> filter(fn: (r) => r["_field"] == "${field}")
      |> events.duration(unit: 1s)
      |> filter(fn: (r) => r["_value"] == 1)
      |> sum(column: "duration")
      |> map(fn: (r) => ({  device: r["device"], _value: math.round(x: float(v:r["duration"]) / 60.00) }))`;

    const runtimeData = await this.queryApi.collectRows(fluxQuery);
    const runtime: any = runtimeData.find(
      (data: any) => data.device === node.serialNumber,
    );
    return {
      _value: runtime === undefined ? 0 : runtime._value,
      alias: node.alias,
      serialNumber: node.serialNumber,
    };
  }

  async completeness(
    startTime: string,
    endTime: string,
    serialNumber: string,
    timezone: string,
  ) {
    const device = await this.findGatewayorNode(serialNumber);
    if (!device) throw new NotFoundException('Device not found');

    const healthCountQuery = `
    import "timezone"

    from(bucket: "${device.tenant?.name}")
    |> range(start: ${startTime}, stop: ${endTime})
    |> filter(fn: (r) => r["_measurement"] == "deviceshealth")
    |> filter(fn: (r) => r["_field"] == "uptime")
    |> filter(fn: (r) => r["device"] == "${serialNumber}")
    |> group(columns: ["device"], mode:"by")  
    |> aggregateWindow(every: 1d, fn: count, location: timezone.location(name: "${timezone}"))   
    `;
    const dataCountQuery = `
    import "timezone"

    from(bucket: "${device.tenant?.name}")
    |> range(start: ${startTime}, stop: ${endTime})
    |> filter(fn: (r) => r["_measurement"] == "${device.type}")
    |> filter(fn: (r) => r["device"] == "${serialNumber}")
    |> group(columns: ["device", "_field"], mode:"by")  
    |> aggregateWindow(every: 1d, fn: count, location: timezone.location(name: "${timezone}"))  
    `;
    const healthCount = await this.queryApi.collectRows(healthCountQuery);
    const dataCount = await this.queryApi.collectRows(dataCountQuery);

    const cleanedHealthCount = healthCount.map(({ _time, device, _value }) => ({
      time: _time,
      device: device,
      count: _value,
    }));
    const dataCountGroupedByField = dataCount.reduce(
      (acc: any, item: any) => {
        if (!acc[item._field]) {
          acc[item._field] = [];
        }
        acc[item._field].push({
          time: item._time,
          device: item.device,
          count: item._value,
        });
        return acc;
      },
      {} as Record<string, typeof dataCount>,
    );
    return {
      healthCount: cleanedHealthCount,
      dataCount: dataCountGroupedByField,
    };
  }

  async findGatewayorNode(serialNumber: string) {
    let gateway: GatewaysEntity | null = null;
    let node: NodesEntity | null = null;

    try {
      gateway = await this.gatewaysService.findOneWithSerialNumber({
        serialNumber,
      });
    } catch (error) {}

    try {
      node = await this.nodesService.findOneWithSerialNumber({
        serialNumber,
      });
    } catch (error) {}

    return gateway || node;
  }

  async gatewayHealth(deviceNumber: string) {
    const device = await this.gatewaysService.findOneWithSerialNumber({
      serialNumber: deviceNumber,
    });

    const { serialNumber, tenant } = device;
    const statusFlux = `
    from(bucket: "${tenant?.name}")
    |> range(start: 0)
    |> filter(fn: (r) => r["_measurement"] == "deviceshealth")
    |> filter(fn: (r) => r["device"] == "${serialNumber}")
    |> last()
    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group(columns: ["device"])
    |> sort(columns: ["_time"], desc: false)
    |> last(column: "device")
    |> drop(columns: ["_start", "_stop"])`;
    const resultStatus = await this.queryApi.collectRows(statusFlux);
    const timeNow = new Date().getTime();
    const dataOnline = resultStatus.map(
      ({ result: _x, table: _y, ...data }) => {
        const point = data;
        const diff =
          (timeNow - new Date(point._time as string).getTime()) / 1000;
        point['status'] = diff < 60 ? 'ONLINE' : 'OFFLINE';
        point['alias'] = device.alias;
        return point;
      },
    );
    return dataOnline[0];
  }

  async healthHistory(
    serialNumber: string,
    startTime: string,
    endTime: string,
  ) {
    const [gatewayResult, nodeResult] = await Promise.allSettled([
      this.gatewaysService.findOneWithSerialNumber({ serialNumber }),
      this.nodesService.findOneWithSerialNumber({ serialNumber }),
    ]);

    const device =
      gatewayResult.status === 'fulfilled'
        ? gatewayResult.value
        : nodeResult.status === 'fulfilled'
          ? nodeResult.value
          : null;

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const flux = `
    from(bucket: "${device.tenant?.name}")
    |> range(start: ${startTime}, stop: ${endTime})
    |> filter(fn: (r) => r["_measurement"] == "deviceshealth")
    |> filter(fn: (r) => r["device"] == "${device.serialNumber}")
    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group(columns: ["device"])
    |> sort(columns: ["_time"], desc: false)
    |> drop(columns: ["_start", "_stop"])`;
    return await this.queryApi.collectRows(flux);
  }
}
