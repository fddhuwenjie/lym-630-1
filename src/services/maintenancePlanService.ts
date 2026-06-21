import { getDatabase } from '../database';
import { MaintenancePlan, MaintenanceType, FaultLevel } from '../types';
import { generateId, now, BusinessError, addMonths } from '../utils';
import { getVehicleById } from './vehicleService';

const MILEAGE_INTERVAL = 5000;
const MONTHS_INTERVAL = 6;

export function createMaintenancePlan(data: {
  vehicle_id: string;
  type: MaintenanceType;
  name: string;
  description?: string;
  due_mileage?: number | null;
  due_date?: string | null;
  fault_level?: FaultLevel | null;
}): MaintenancePlan {
  const vehicle = getVehicleById(data.vehicle_id);
  if (!vehicle) {
    throw new BusinessError('VEHICLE_NOT_FOUND', '车辆不存在');
  }

  const db = getDatabase();
  const id = generateId();
  const createdAt = now();

  const stmt = db.prepare(`
    INSERT INTO maintenance_plans (id, vehicle_id, type, name, description, due_mileage, due_date, fault_level, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  stmt.run(
    id,
    data.vehicle_id,
    data.type,
    data.name,
    data.description || null,
    data.due_mileage ?? null,
    data.due_date ?? null,
    data.fault_level ?? null,
    createdAt
  );

  return getMaintenancePlanById(id)!;
}

export function getMaintenancePlanById(id: string): MaintenancePlan | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(id) as MaintenancePlan | undefined;
}

export function listMaintenancePlans(vehicleId?: string, status?: string): MaintenancePlan[] {
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
  const sql = `SELECT * FROM maintenance_plans ${whereClause} ORDER BY created_at DESC`;

  return db.prepare(sql).all(...params) as MaintenancePlan[];
}

export function completeMaintenancePlan(id: string): MaintenancePlan {
  const plan = getMaintenancePlanById(id);
  if (!plan) {
    throw new BusinessError('PLAN_NOT_FOUND', '保养计划不存在');
  }

  if (plan.status === 'completed') {
    return plan;
  }

  const db = getDatabase();
  const completedAt = now();

  db.prepare(`
    UPDATE maintenance_plans SET status = 'completed', completed_at = ? WHERE id = ?
  `).run(completedAt, id);

  return getMaintenancePlanById(id)!;
}

export function cancelMaintenancePlan(id: string): MaintenancePlan {
  const plan = getMaintenancePlanById(id);
  if (!plan) {
    throw new BusinessError('PLAN_NOT_FOUND', '保养计划不存在');
  }

  if (plan.status === 'completed' || plan.status === 'cancelled') {
    return plan;
  }

  const db = getDatabase();
  db.prepare("UPDATE maintenance_plans SET status = 'cancelled' WHERE id = ?").run(id);

  return getMaintenancePlanById(id)!;
}

export function checkAndGenerateMaintenancePlans(vehicleId: string): MaintenancePlan[] {
  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) {
    throw new BusinessError('VEHICLE_NOT_FOUND', '车辆不存在');
  }

  const db = getDatabase();
  const generatedPlans: MaintenancePlan[] = [];

  const pendingPlans = listMaintenancePlans(vehicleId, 'pending');

  const hasPendingMileagePlan = pendingPlans.some(p => p.type === 'mileage_based');
  if (!hasPendingMileagePlan && vehicle.current_mileage > 0) {
    const lastMaintenanceMileage = vehicle.last_maintenance_mileage || 0;
    const nextDueMileage = lastMaintenanceMileage + MILEAGE_INTERVAL;

    if (vehicle.current_mileage >= nextDueMileage - MILEAGE_INTERVAL * 0.2) {
      const plan = createMaintenancePlan({
        vehicle_id: vehicleId,
        type: 'mileage_based',
        name: `${MILEAGE_INTERVAL}公里常规保养`,
        description: `车辆行驶里程达到${nextDueMileage}公里，建议进行常规保养`,
        due_mileage: nextDueMileage,
      });
      generatedPlans.push(plan);
    }
  }

  const hasPendingTimePlan = pendingPlans.some(p => p.type === 'time_based');
  if (!hasPendingTimePlan) {
    const lastDate = vehicle.last_maintenance_date ? new Date(vehicle.last_maintenance_date) : new Date(vehicle.purchase_date);
    const nextDueDate = addMonths(lastDate, MONTHS_INTERVAL);
    const today = new Date();
    const thirtyDaysBefore = new Date(nextDueDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (today >= thirtyDaysBefore) {
      const plan = createMaintenancePlan({
        vehicle_id: vehicleId,
        type: 'time_based',
        name: `${MONTHS_INTERVAL}个月定期保养`,
        description: `车辆距上次保养已满${MONTHS_INTERVAL}个月，建议进行定期保养`,
        due_date: nextDueDate.toISOString().split('T')[0],
      });
      generatedPlans.push(plan);
    }
  }

  return generatedPlans;
}

export function checkAndGeneratePlansForFault(vehicleId: string, faultLevel: FaultLevel): MaintenancePlan | null {
  if (faultLevel === 'minor' || faultLevel === 'medium') {
    return null;
  }

  const plan = createMaintenancePlan({
    vehicle_id: vehicleId,
    type: 'fault_based',
    name: faultLevel === 'critical' ? '重大故障维修保养' : '较严重故障维修保养',
    description: `因${faultLevel === 'critical' ? '重大' : '较严重'}故障，建议进行全面检查保养`,
    fault_level: faultLevel,
  });

  return plan;
}

export function getDueMaintenancePlans(): MaintenancePlan[] {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  return db.prepare(`
    SELECT * FROM maintenance_plans 
    WHERE status = 'pending' 
    AND (due_mileage IS NOT NULL OR due_date IS NOT NULL)
    ORDER BY created_at DESC
  `).all() as MaintenancePlan[];
}
