import { getDatabase } from '../database';
import {
  WorkOrder,
  WorkOrderStatus,
  FaultLevel,
  WorkOrderPart,
  WorkOrderTimeoutInfo,
  TimeoutStatus,
  TimeoutConfig,
  WorkOrderStatisticsFilter,
  WorkOrderStatisticsItem,
  PartPreempt,
} from '../types';
import { generateId, now, BusinessError, validateRequiredFields } from '../utils';
import { getVehicleById, updateVehicle, incrementRepairCount, updateLastFaultLevel } from './vehicleService';
import { getMaintenancePlanById, completeMaintenancePlan, checkAndGeneratePlansForFault } from './maintenancePlanService';
import {
  getSparePartById,
  consumePart,
  returnPart,
  getWorkOrderParts,
  preemptPart,
  releaseAllPreempts,
  confirmAllPreempts,
  getWorkOrderPreempts,
} from './sparePartService';
import {
  getTechnicianById,
  isTechnicianAvailable,
  recommendTechnicians,
} from './technicianService';

export function createWorkOrder(data: {
  vehicle_id: string;
  title: string;
  fault_level: FaultLevel;
  description?: string;
  maintenance_plan_id?: string;
}): WorkOrder {
  validateRequiredFields(data, ['vehicle_id', 'title', 'fault_level']);

  const vehicle = getVehicleById(data.vehicle_id);
  if (!vehicle) {
    throw new BusinessError('VEHICLE_NOT_FOUND', '车辆不存在');
  }

  if (vehicle.status === 'running') {
    throw new BusinessError('VEHICLE_RUNNING', '车辆正在运行中，不能创建维修工单');
  }

  if (data.maintenance_plan_id) {
    const plan = getMaintenancePlanById(data.maintenance_plan_id);
    if (!plan) {
      throw new BusinessError('PLAN_NOT_FOUND', '保养计划不存在');
    }
    if (plan.vehicle_id !== data.vehicle_id) {
      throw new BusinessError('PLAN_VEHICLE_MISMATCH', '保养计划与车辆不匹配');
    }
  }

  const db = getDatabase();
  const id = generateId();
  const createdAt = now();

  const stmt = db.prepare(`
    INSERT INTO work_orders (
      id, vehicle_id, maintenance_plan_id, title, fault_level, description,
      status, labor_hours, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending_assign', 0, ?, ?)
  `);
  stmt.run(
    id,
    data.vehicle_id,
    data.maintenance_plan_id || null,
    data.title,
    data.fault_level,
    data.description || null,
    createdAt,
    createdAt
  );

  updateLastFaultLevel(data.vehicle_id, data.fault_level);

  checkAndGeneratePlansForFault(data.vehicle_id, data.fault_level);

  return getWorkOrderById(id)!;
}

export function getWorkOrderById(id: string): WorkOrder | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) as WorkOrder | undefined;
}

export function listWorkOrders(vehicleId?: string, status?: WorkOrderStatus): WorkOrder[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: any[] = [];

  if (vehicleId) {
    where.push('vehicle_id = ?');
    params.push(vehicleId);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM work_orders ${whereClause} ORDER BY created_at DESC`;

  return db.prepare(sql).all(...params) as WorkOrder[];
}

export function assignWorkOrder(id: string, assignedTo: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'pending_assign') {
    throw new BusinessError('INVALID_STATUS', '只有待派工状态的工单才能派工');
  }

  const tech = getTechnicianById(assignedTo);
  if (tech) {
    if (tech.status !== 'active') {
      throw new BusinessError('TECHNICIAN_INACTIVE', '技师状态为非激活，无法分配工单');
    }
    if (!isTechnicianAvailable(assignedTo, now())) {
      throw new BusinessError('TECHNICIAN_UNAVAILABLE', '技师当前不在值班时间，无法分配工单');
    }
  }

  const db = getDatabase();
  const updatedAt = now();
  const inRepairAt = now();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE work_orders 
      SET status = 'in_repair', assigned_to = ?, updated_at = ?, in_repair_at = ? 
      WHERE id = ?
    `).run(assignedTo, updatedAt, inRepairAt, id);

    updateVehicle(order.vehicle_id, { status: 'in_repair' } as any);
  });

  tx();

  return getWorkOrderById(id)!;
}

export function getRecommendedTechnicians(
  workOrderId: string
): { technician: any; available: boolean; score: number }[] {
  const order = getWorkOrderById(workOrderId);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  const techs = recommendTechnicians(order.fault_level, order.description);
  const results = techs.map((tech, index) => ({
    technician: tech,
    available: isTechnicianAvailable(tech.id, now()),
    score: Math.max(100 - index * 10, 0),
  }));

  return results;
}

export function recordDiagnosis(id: string, diagnosis: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'in_repair') {
    throw new BusinessError('INVALID_STATUS', '只有维修中状态的工单才能登记诊断');
  }

  const db = getDatabase();
  const updatedAt = now();

  db.prepare('UPDATE work_orders SET diagnosis = ?, updated_at = ? WHERE id = ?')
    .run(diagnosis, updatedAt, id);

  return getWorkOrderById(id)!;
}

export function recordLaborHours(id: string, laborHours: number): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'in_repair') {
    throw new BusinessError('INVALID_STATUS', '只有维修中状态的工单才能登记工时');
  }

  if (laborHours < 0) {
    throw new BusinessError('INVALID_LABOR_HOURS', '工时不能为负数');
  }

  const db = getDatabase();
  const updatedAt = now();

  db.prepare('UPDATE work_orders SET labor_hours = ?, updated_at = ? WHERE id = ?')
    .run(laborHours, updatedAt, id);

  return getWorkOrderById(id)!;
}

export function preemptSparePart(orderId: string, partId: string, quantity: number, operator: string): PartPreempt {
  const order = getWorkOrderById(orderId);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'in_repair') {
    throw new BusinessError('INVALID_STATUS', '只有维修中状态的工单才能预占备件');
  }

  return preemptPart(orderId, partId, quantity, operator);
}

export function useSparePart(orderId: string, partId: string, quantity: number, operator: string): WorkOrderPart {
  const order = getWorkOrderById(orderId);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'in_repair') {
    throw new BusinessError('INVALID_STATUS', '只有维修中状态的工单才能领用备件');
  }

  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  if (quantity <= 0) {
    throw new BusinessError('INVALID_QUANTITY', '领用数量必须大于0');
  }

  return consumePart(orderId, partId, quantity, operator);
}

export function completeWorkOrder(id: string, completionResult: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'in_repair') {
    throw new BusinessError('INVALID_STATUS', '只有维修中状态的工单才能完工');
  }

  const db = getDatabase();
  const updatedAt = now();

  db.prepare(`
    UPDATE work_orders SET status = 'pending_acceptance', completion_result = ?, updated_at = ? WHERE id = ?
  `).run(completionResult, updatedAt, id);

  return getWorkOrderById(id)!;
}

export function acceptWorkOrder(id: string, acceptanceResult: string, acceptedBy: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'pending_acceptance') {
    throw new BusinessError('INVALID_STATUS', '只有待验收状态的工单才能验收');
  }

  const db = getDatabase();
  const acceptedAt = now();
  const updatedAt = acceptedAt;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE work_orders 
      SET status = 'completed', acceptance_result = ?, accepted_by = ?, accepted_at = ?, updated_at = ? 
      WHERE id = ?
    `).run(acceptanceResult, acceptedBy, acceptedAt, updatedAt, id);

    confirmAllPreempts(id, acceptedBy);

    updateVehicle(order.vehicle_id, { status: 'idle' } as any);

    incrementRepairCount(order.vehicle_id);

    if (order.maintenance_plan_id) {
      completeMaintenancePlan(order.maintenance_plan_id);
    }

    db.prepare(`
      UPDATE vehicles 
      SET last_maintenance_date = ?, last_maintenance_mileage = current_mileage, updated_at = ?
      WHERE id = ?
    `).run(acceptedAt, updatedAt, order.vehicle_id);
  });

  tx();

  return getWorkOrderById(id)!;
}

export function rejectWorkOrder(id: string, rejectReason: string, operator: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status !== 'pending_acceptance') {
    throw new BusinessError('INVALID_STATUS', '只有待验收状态的工单才能驳回');
  }

  const db = getDatabase();
  const rejectedAt = now();
  const updatedAt = rejectedAt;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE work_orders 
      SET status = 'rejected', rejected_at = ?, reject_reason = ?, updated_at = ? 
      WHERE id = ?
    `).run(rejectedAt, rejectReason, updatedAt, id);

    releaseAllPreempts(id, operator, '验收驳回');
  });

  tx();

  return getWorkOrderById(id)!;
}

export function cancelWorkOrder(id: string, cancelReason: string, operator: string): WorkOrder {
  const order = getWorkOrderById(id);
  if (!order) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    throw new BusinessError('INVALID_STATUS', '已完成或已作废的工单不能再次作废');
  }

  const db = getDatabase();
  const cancelledAt = now();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE work_orders 
      SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? 
      WHERE id = ?
    `).run(cancelledAt, cancelReason, cancelledAt, id);

    releaseAllPreempts(id, operator, `工单取消：${cancelReason}`);

    const parts = getWorkOrderParts(id);
    for (const part of parts) {
      if (!part.returned) {
        returnPart(id, part.part_id, operator);
      }
    }

    if (order.status === 'in_repair') {
      updateVehicle(order.vehicle_id, { status: 'idle' } as any);
    }
  });

  tx();

  return getWorkOrderById(id)!;
}

export function getWorkOrderDetail(id: string): {
  workOrder: WorkOrder;
  parts: WorkOrderPart[];
  preempts: PartPreempt[];
  timeoutInfo: WorkOrderTimeoutInfo | null;
} {
  const workOrder = getWorkOrderById(id);
  if (!workOrder) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  const parts = getWorkOrderParts(id);
  const preempts = getWorkOrderPreempts(id);
  const timeoutInfo = getWorkOrderTimeoutInfo(id);

  return { workOrder, parts, preempts, timeoutInfo };
}

export function getTimeoutConfig(faultLevel: FaultLevel): TimeoutConfig | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM timeout_configs WHERE fault_level = ?').get(faultLevel) as TimeoutConfig | undefined;
}

export function updateTimeoutConfig(faultLevel: FaultLevel, warningHours: number, overdueHours: number): TimeoutConfig {
  if (warningHours <= 0 || overdueHours <= 0) {
    throw new BusinessError('INVALID_HOURS', '超时时间必须大于0');
  }
  if (warningHours >= overdueHours) {
    throw new BusinessError('INVALID_HOURS', '预警时间必须小于超时时间');
  }

  const db = getDatabase();
  const existing = getTimeoutConfig(faultLevel);
  const updatedAt = now();

  if (existing) {
    db.prepare(`
      UPDATE timeout_configs 
      SET warning_hours = ?, overdue_hours = ?, updated_at = ? 
      WHERE id = ?
    `).run(warningHours, overdueHours, updatedAt, existing.id);
  } else {
    const id = generateId();
    db.prepare(`
      INSERT INTO timeout_configs (id, fault_level, warning_hours, overdue_hours, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, faultLevel, warningHours, overdueHours, updatedAt, updatedAt);
  }

  return getTimeoutConfig(faultLevel)!;
}

export function listTimeoutConfigs(): TimeoutConfig[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM timeout_configs ORDER BY fault_level').all() as TimeoutConfig[];
}

export function getWorkOrderTimeoutInfo(workOrderId: string): WorkOrderTimeoutInfo | null {
  const order = getWorkOrderById(workOrderId);
  if (!order) {
    return null;
  }

  if (!order.in_repair_at || order.status === 'completed' || order.status === 'cancelled') {
    return null;
  }

  const config = getTimeoutConfig(order.fault_level);
  if (!config) {
    return null;
  }

  const nowTime = new Date().getTime();
  const startTime = new Date(order.in_repair_at).getTime();
  const elapsedMs = nowTime - startTime;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const warningMs = config.warning_hours * 60 * 60 * 1000;
  const overdueMs = config.overdue_hours * 60 * 60 * 1000;

  let timeoutStatus: TimeoutStatus = 'normal';
  let remainingHours = config.overdue_hours - elapsedHours;

  if (elapsedMs >= overdueMs) {
    timeoutStatus = 'overdue';
    remainingHours = -Math.abs(remainingHours);
  } else if (elapsedMs >= warningMs) {
    timeoutStatus = 'warning';
  }

  return {
    work_order_id: workOrderId,
    timeout_status: timeoutStatus,
    remaining_hours: Number(remainingHours.toFixed(2)),
    elapsed_hours: Number(elapsedHours.toFixed(2)),
    warning_hours: config.warning_hours,
    overdue_hours: config.overdue_hours,
  };
}

export function getTimeoutWorkOrders(status?: TimeoutStatus): WorkOrder[] {
  const db = getDatabase();
  const allInRepair = db.prepare(`
    SELECT * FROM work_orders 
    WHERE status = 'in_repair' AND in_repair_at IS NOT NULL
    ORDER BY in_repair_at ASC
  `).all() as WorkOrder[];

  const result: WorkOrder[] = [];

  for (const order of allInRepair) {
    const info = getWorkOrderTimeoutInfo(order.id);
    if (info) {
      if (!status || info.timeout_status === status) {
        result.push(order);
      }
    }
  }

  return result;
}

export function getWorkOrderStatistics(filter: WorkOrderStatisticsFilter): WorkOrderStatisticsItem[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: any[] = [];

  if (filter.vehicle_id) {
    where.push('wo.vehicle_id = ?');
    params.push(filter.vehicle_id);
  }
  if (filter.status) {
    where.push('wo.status = ?');
    params.push(filter.status);
  }
  if (filter.fault_level) {
    where.push('wo.fault_level = ?');
    params.push(filter.fault_level);
  }
  if (filter.technician_id) {
    where.push('wo.assigned_to = ?');
    params.push(filter.technician_id);
  }
  if (filter.start_date) {
    where.push('wo.created_at >= ?');
    params.push(filter.start_date);
  }
  if (filter.end_date) {
    where.push('wo.created_at <= ?');
    params.push(filter.end_date);
  }

  let partJoin = '';
  if (filter.part_id) {
    partJoin = `
      LEFT JOIN work_order_parts wop ON wop.work_order_id = wo.id AND wop.returned = 0
      LEFT JOIN part_preempts pp ON pp.work_order_id = wo.id AND pp.status IN ('preempted', 'confirmed')
    `;
    where.push('(wop.part_id = ? OR pp.part_id = ?)');
    params.push(filter.part_id, filter.part_id);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT DISTINCT
      wo.id,
      wo.title,
      wo.fault_level,
      wo.status,
      wo.vehicle_id,
      v.plate_number,
      wo.assigned_to,
      t.name as technician_name,
      wo.created_at,
      wo.in_repair_at,
      wo.accepted_at as completed_at
    FROM work_orders wo
    INNER JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN technicians t ON t.id = wo.assigned_to
    ${partJoin}
    ${whereClause}
    ORDER BY wo.created_at DESC
  `;

  const rows = db.prepare(sql).all(...params) as any[];

  const result: WorkOrderStatisticsItem[] = rows.map(row => {
    const timeoutInfo = getWorkOrderTimeoutInfo(row.id);
    const parts = getWorkOrderParts(row.id);
    const preempts = getWorkOrderPreempts(row.id, 'confirmed');

    const partsCount = parts.length;
    let totalCost = 0;

    for (const p of parts) {
      if (!p.returned) {
        totalCost += p.quantity * p.unit_price;
      }
    }
    for (const p of preempts) {
      totalCost += p.quantity * p.unit_price;
    }

    return {
      id: row.id,
      title: row.title,
      fault_level: row.fault_level,
      status: row.status,
      vehicle_id: row.vehicle_id,
      plate_number: row.plate_number,
      assigned_to: row.assigned_to,
      technician_name: row.technician_name || null,
      created_at: row.created_at,
      in_repair_at: row.in_repair_at,
      completed_at: row.completed_at,
      timeout_status: timeoutInfo?.timeout_status || 'normal',
      parts_count: partsCount,
      total_cost: Number(totalCost.toFixed(2)),
    };
  });

  if (filter.timeout_status) {
    return result.filter(item => item.timeout_status === filter.timeout_status);
  }

  return result;
}
