import { getDatabase } from '../database';
import { Vehicle, VehicleHealthRecord, MileageRecord } from '../types';
import { generateId, now, BusinessError, validateRequiredFields } from '../utils';
import { checkAndGenerateMaintenancePlans } from '../services/maintenancePlanService';

export function createVehicle(data: {
  plate_number: string;
  model: string;
  purchase_date: string;
  current_mileage?: number;
  status?: string;
}): Vehicle {
  validateRequiredFields(data, ['plate_number', 'model', 'purchase_date']);

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM vehicles WHERE plate_number = ?').get(data.plate_number);
  if (existing) {
    throw new BusinessError('DUPLICATE_PLATE', '车牌号已存在');
  }

  const id = generateId();
  const createdAt = now();
  const mileage = data.current_mileage || 0;

  const stmt = db.prepare(`
    INSERT INTO vehicles (id, plate_number, model, status, current_mileage, purchase_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.plate_number, data.model, data.status || 'idle', mileage, data.purchase_date, createdAt, createdAt);

  const healthId = generateId();
  db.prepare(`
    INSERT INTO vehicle_health_records (id, vehicle_id, mileage, health_score, total_repair_count, total_maintenance_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(healthId, id, mileage, 100, 0, 0, createdAt);

  return getVehicleById(id)!;
}

export function getVehicleById(id: string): Vehicle | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle | undefined;
}

export function getVehicleByPlateNumber(plateNumber: string): Vehicle | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM vehicles WHERE plate_number = ?').get(plateNumber) as Vehicle | undefined;
}

export function listVehicles(status?: string): Vehicle[] {
  const db = getDatabase();
  if (status) {
    return db.prepare('SELECT * FROM vehicles WHERE status = ? ORDER BY created_at DESC').all(status) as Vehicle[];
  }
  return db.prepare('SELECT * FROM vehicles ORDER BY created_at DESC').all() as Vehicle[];
}

export function updateVehicle(id: string, data: Partial<Vehicle>): Vehicle {
  const vehicle = getVehicleById(id);
  if (!vehicle) {
    throw new BusinessError('VEHICLE_NOT_FOUND', '车辆不存在');
  }

  const db = getDatabase();
  const updatedAt = now();

  const fields = [];
  const values = [];

  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.purchase_date !== undefined) { fields.push('purchase_date = ?'); values.push(data.purchase_date); }

  if (fields.length === 0) {
    return vehicle;
  }

  fields.push('updated_at = ?');
  values.push(updatedAt);
  values.push(id);

  const stmt = db.prepare(`UPDATE vehicles SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getVehicleById(id)!;
}

export function recordMileage(vehicleId: string, mileage: number, operator: string): MileageRecord {
  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) {
    throw new BusinessError('VEHICLE_NOT_FOUND', '车辆不存在');
  }

  if (mileage < vehicle.current_mileage) {
    throw new BusinessError('MILEAGE_ROLLBACK', '里程读数不能倒退');
  }

  const db = getDatabase();
  const recordedAt = now();
  const id = generateId();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO mileage_records (id, vehicle_id, mileage, recorded_at, operator)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, vehicleId, mileage, recordedAt, operator);

    db.prepare('UPDATE vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?')
      .run(mileage, recordedAt, vehicleId);

    db.prepare('UPDATE vehicle_health_records SET mileage = ?, updated_at = ? WHERE vehicle_id = ?')
      .run(mileage, recordedAt, vehicleId);
  });

  tx();

  checkAndGenerateMaintenancePlans(vehicleId);

  return { id, vehicle_id: vehicleId, mileage, recorded_at: recordedAt, operator };
}

export function getVehicleHealthRecord(vehicleId: string): VehicleHealthRecord | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM vehicle_health_records WHERE vehicle_id = ?')
    .get(vehicleId) as VehicleHealthRecord | undefined;
}

export function listAllHealthRecords(): VehicleHealthRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM vehicle_health_records ORDER BY updated_at DESC').all() as VehicleHealthRecord[];
}

export function getMileageHistory(vehicleId: string, limit: number = 20): MileageRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM mileage_records WHERE vehicle_id = ? ORDER BY recorded_at DESC LIMIT ?')
    .all(vehicleId, limit) as MileageRecord[];
}

export function updateVehicleHealthScore(vehicleId: string, healthScore: number): void {
  const db = getDatabase();
  const updatedAt = now();
  db.prepare('UPDATE vehicle_health_records SET health_score = ?, updated_at = ? WHERE vehicle_id = ?')
    .run(healthScore, updatedAt, vehicleId);
}

export function incrementRepairCount(vehicleId: string): void {
  const db = getDatabase();
  const updatedAt = now();
  db.prepare(`
    UPDATE vehicle_health_records 
    SET total_repair_count = total_repair_count + 1, updated_at = ? 
    WHERE vehicle_id = ?
  `).run(updatedAt, vehicleId);
}

export function incrementMaintenanceCount(vehicleId: string): void {
  const db = getDatabase();
  const updatedAt = now();
  db.prepare(`
    UPDATE vehicle_health_records 
    SET total_maintenance_count = total_maintenance_count + 1, updated_at = ? 
    WHERE vehicle_id = ?
  `).run(updatedAt, vehicleId);
}

export function updateLastFaultLevel(vehicleId: string, faultLevel: string): void {
  const db = getDatabase();
  const updatedAt = now();
  db.prepare('UPDATE vehicle_health_records SET last_fault_level = ?, updated_at = ? WHERE vehicle_id = ?')
    .run(faultLevel, updatedAt, vehicleId);
}
