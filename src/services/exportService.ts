import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { getDatabase, getExportDir } from '../database';
import { ExportRecord, WorkOrder, WorkOrderPart, Vehicle } from '../types';
import { generateId, now, BusinessError } from '../utils';
import { getWorkOrderParts } from './sparePartService';

export async function exportWorkOrderDetails(
  params: {
    startDate?: string;
    endDate?: string;
    vehicleId?: string;
    status?: string;
  },
  operator: string
): Promise<ExportRecord> {
  const db = getDatabase();

  const where: string[] = [];
  const queryParams: any[] = [];

  if (params.startDate) {
    where.push('created_at >= ?');
    queryParams.push(params.startDate);
  }
  if (params.endDate) {
    where.push('created_at <= ?');
    queryParams.push(params.endDate + ' 23:59:59');
  }
  if (params.vehicleId) {
    where.push('vehicle_id = ?');
    queryParams.push(params.vehicleId);
  }
  if (params.status) {
    where.push('status = ?');
    queryParams.push(params.status);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM work_orders ${whereClause} ORDER BY created_at DESC`;

  const workOrders = db.prepare(sql).all(...queryParams) as WorkOrder[];

  const csvData: any[] = [];

  for (const order of workOrders) {
    const vehicle = db.prepare('SELECT plate_number, model FROM vehicles WHERE id = ?')
      .get(order.vehicle_id) as Vehicle | undefined;

    const parts = getWorkOrderParts(order.id);
    const partsInfo = parts
      .filter(p => !p.returned)
      .map(p => `${p.part_name} x${p.quantity}`)
      .join('; ');

    const totalPartsCost = parts
      .filter(p => !p.returned)
      .reduce((sum, p) => sum + p.quantity * p.unit_price, 0);

    csvData.push({
      work_order_id: order.id,
      title: order.title,
      plate_number: vehicle?.plate_number || '',
      vehicle_model: vehicle?.model || '',
      fault_level: order.fault_level,
      description: order.description || '',
      status: order.status,
      assigned_to: order.assigned_to || '',
      diagnosis: order.diagnosis || '',
      labor_hours: order.labor_hours,
      spare_parts: partsInfo,
      parts_total_cost: totalPartsCost,
      completion_result: order.completion_result || '',
      acceptance_result: order.acceptance_result || '',
      accepted_by: order.accepted_by || '',
      accepted_at: order.accepted_at || '',
      created_at: order.created_at,
    });
  }

  const fileName = `work_order_details_${Date.now()}.csv`;
  const filePath = path.join(getExportDir(), fileName);

  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'work_order_id', title: '工单ID' },
      { id: 'title', title: '工单标题' },
      { id: 'plate_number', title: '车牌号' },
      { id: 'vehicle_model', title: '车辆型号' },
      { id: 'fault_level', title: '故障等级' },
      { id: 'description', title: '问题描述' },
      { id: 'status', title: '状态' },
      { id: 'assigned_to', title: '维修人员' },
      { id: 'diagnosis', title: '诊断结果' },
      { id: 'labor_hours', title: '工时(小时)' },
      { id: 'spare_parts', title: '备件明细' },
      { id: 'parts_total_cost', title: '备件总费用' },
      { id: 'completion_result', title: '完工结果' },
      { id: 'acceptance_result', title: '验收结果' },
      { id: 'accepted_by', title: '验收人' },
      { id: 'accepted_at', title: '验收时间' },
      { id: 'created_at', title: '创建时间' },
    ],
  });

  await csvWriter.writeRecords(csvData);

  const id = generateId();
  const createdAt = now();
  const paramsStr = JSON.stringify(params);

  db.prepare(`
    INSERT INTO export_records (id, type, file_name, file_path, parameters, operator, created_at)
    VALUES (?, 'work_order_details', ?, ?, ?, ?, ?)
  `).run(id, fileName, filePath, paramsStr, operator, createdAt);

  return getExportRecordById(id)!;
}

export function getExportRecordById(id: string): ExportRecord | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM export_records WHERE id = ?').get(id) as ExportRecord | undefined;
}

export function listExportRecords(type?: string): ExportRecord[] {
  const db = getDatabase();
  if (type) {
    return db.prepare('SELECT * FROM export_records WHERE type = ? ORDER BY created_at DESC')
      .all(type) as ExportRecord[];
  }
  return db.prepare('SELECT * FROM export_records ORDER BY created_at DESC').all() as ExportRecord[];
}

export function getExportFilePath(id: string): string {
  const record = getExportRecordById(id);
  if (!record) {
    throw new BusinessError('EXPORT_NOT_FOUND', '导出记录不存在');
  }

  if (!fs.existsSync(record.file_path)) {
    throw new BusinessError('FILE_NOT_FOUND', '导出文件不存在');
  }

  return record.file_path;
}
