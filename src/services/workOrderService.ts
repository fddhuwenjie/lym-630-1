import { getDatabase } from '../database';
import { WorkOrder, WorkOrderStatus, FaultLevel, WorkOrderPart } from '../types';
import { generateId, now, BusinessError, validateRequiredFields } from '../utils';
import { getVehicleById, updateVehicle, incrementRepairCount, updateLastFaultLevel } from './vehicleService';
import { getMaintenancePlanById, completeMaintenancePlan, checkAndGeneratePlansForFault } from './maintenancePlanService';
import { getSparePartById, consumePart, returnPart, getWorkOrderParts } from './sparePartService';

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

  const db = getDatabase();
  const updatedAt = now();

  db.prepare(`
    UPDATE work_orders SET status = 'in_repair', assigned_to = ?, updated_at = ? WHERE id = ?
  `).run(assignedTo, updatedAt, id);

  updateVehicle(order.vehicle_id, { status: 'in_repair' } as any);

  return getWorkOrderById(id)!;
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

  const db = getDatabase();
  const existingPart = db.prepare(`
    SELECT * FROM work_order_parts WHERE work_order_id = ? AND part_id = ? AND returned = 0
  `).get(orderId, partId);

  if (existingPart) {
    throw new BusinessError('DUPLICATE_PART', '该备件已在此工单中领用，不能重复领用');
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
} {
  const workOrder = getWorkOrderById(id);
  if (!workOrder) {
    throw new BusinessError('ORDER_NOT_FOUND', '工单不存在');
  }

  const parts = getWorkOrderParts(id);

  return { workOrder, parts };
}
