import { getDatabase } from '../database';
import { SparePart, PartTransaction, WorkOrderPart, PartTransactionType } from '../types';
import { generateId, now, BusinessError, validateRequiredFields } from '../utils';

export function createSparePart(data: {
  name: string;
  code: string;
  specification?: string;
  unit: string;
  stock_quantity?: number;
  warning_threshold?: number;
  unit_price?: number;
}): SparePart {
  validateRequiredFields(data, ['name', 'code', 'unit']);

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM spare_parts WHERE code = ?').get(data.code);
  if (existing) {
    throw new BusinessError('DUPLICATE_CODE', '备件编码已存在');
  }

  const id = generateId();
  const createdAt = now();

  const stmt = db.prepare(`
    INSERT INTO spare_parts (
      id, name, code, specification, unit, stock_quantity,
      warning_threshold, unit_price, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.name,
    data.code,
    data.specification || null,
    data.unit,
    data.stock_quantity || 0,
    data.warning_threshold ?? 10,
    data.unit_price || 0,
    createdAt,
    createdAt
  );

  return getSparePartById(id)!;
}

export function getSparePartById(id: string): SparePart | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM spare_parts WHERE id = ?').get(id) as SparePart | undefined;
}

export function getSparePartByCode(code: string): SparePart | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM spare_parts WHERE code = ?').get(code) as SparePart | undefined;
}

export function listSpareParts(keyword?: string): SparePart[] {
  const db = getDatabase();
  if (keyword) {
    return db.prepare(`
      SELECT * FROM spare_parts 
      WHERE name LIKE ? OR code LIKE ? 
      ORDER BY created_at DESC
    `).all(`%${keyword}%`, `%${keyword}%`) as SparePart[];
  }
  return db.prepare('SELECT * FROM spare_parts ORDER BY created_at DESC').all() as SparePart[];
}

export function updateSparePart(id: string, data: Partial<SparePart>): SparePart {
  const part = getSparePartById(id);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  const db = getDatabase();
  const updatedAt = now();

  const fields = [];
  const values = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.specification !== undefined) { fields.push('specification = ?'); values.push(data.specification); }
  if (data.unit !== undefined) { fields.push('unit = ?'); values.push(data.unit); }
  if (data.warning_threshold !== undefined) { fields.push('warning_threshold = ?'); values.push(data.warning_threshold); }
  if (data.unit_price !== undefined) { fields.push('unit_price = ?'); values.push(data.unit_price); }

  if (fields.length === 0) {
    return part;
  }

  fields.push('updated_at = ?');
  values.push(updatedAt);
  values.push(id);

  const stmt = db.prepare(`UPDATE spare_parts SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getSparePartById(id)!;
}

export function inboundPart(partId: string, quantity: number, operator: string, remark?: string): PartTransaction {
  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  if (quantity <= 0) {
    throw new BusinessError('INVALID_QUANTITY', '入库数量必须大于0');
  }

  const db = getDatabase();
  const id = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance + quantity;

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, operator, remark, created_at
      ) VALUES (?, ?, NULL, 'inbound', ?, ?, ?, ?, ?, ?)
    `).run(id, partId, quantity, beforeBalance, afterBalance, operator, remark || null, createdAt);
  });

  tx();

  return getPartTransactionById(id)!;
}

export function consumePart(workOrderId: string, partId: string, quantity: number, operator: string): WorkOrderPart {
  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  if (quantity <= 0) {
    throw new BusinessError('INVALID_QUANTITY', '领用数量必须大于0');
  }

  if (part.stock_quantity < quantity) {
    throw new BusinessError('INSUFFICIENT_STOCK', `备件库存不足，当前库存: ${part.stock_quantity}，需要: ${quantity}`);
  }

  const db = getDatabase();
  const id = generateId();
  const txnId = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance - quantity;

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, operator, remark, created_at
      ) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, '工单领用', ?)
    `).run(txnId, partId, workOrderId, quantity, beforeBalance, afterBalance, operator, createdAt);

    db.prepare(`
      INSERT INTO work_order_parts (
        id, work_order_id, part_id, part_name, quantity, unit_price, returned, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, workOrderId, partId, part.name, quantity, part.unit_price, createdAt);
  });

  tx();

  return getWorkOrderPartById(id)!;
}

export function returnPart(workOrderId: string, partId: string, operator: string): WorkOrderPart {
  const db = getDatabase();

  const workOrderPart = db.prepare(`
    SELECT * FROM work_order_parts WHERE work_order_id = ? AND part_id = ? AND returned = 0
  `).get(workOrderId, partId) as WorkOrderPart | undefined;

  if (!workOrderPart) {
    throw new BusinessError('PART_NOT_FOUND', '未找到该工单的领用备件记录');
  }

  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  const txnId = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance + workOrderPart.quantity;

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, operator, remark, created_at
      ) VALUES (?, ?, ?, 'return', ?, ?, ?, ?, '工单退回', ?)
    `).run(txnId, partId, workOrderId, workOrderPart.quantity, beforeBalance, afterBalance, operator, createdAt);

    db.prepare('UPDATE work_order_parts SET returned = 1 WHERE id = ?')
      .run(workOrderPart.id);
  });

  tx();

  return getWorkOrderPartById(workOrderPart.id)!;
}

export function getWorkOrderParts(workOrderId: string): WorkOrderPart[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM work_order_parts WHERE work_order_id = ? ORDER BY created_at DESC')
    .all(workOrderId) as WorkOrderPart[];
}

export function getWorkOrderPartById(id: string): WorkOrderPart | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM work_order_parts WHERE id = ?').get(id) as WorkOrderPart | undefined;
}

export function getPartTransactionById(id: string): PartTransaction | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM part_transactions WHERE id = ?').get(id) as PartTransaction | undefined;
}

export function listPartTransactions(partId?: string, workOrderId?: string, type?: PartTransactionType): PartTransaction[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: any[] = [];

  if (partId) {
    where.push('part_id = ?');
    params.push(partId);
  }
  if (workOrderId) {
    where.push('work_order_id = ?');
    params.push(workOrderId);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM part_transactions ${whereClause} ORDER BY created_at DESC`;

  return db.prepare(sql).all(...params) as PartTransaction[];
}

export function getLowStockParts(): SparePart[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM spare_parts 
    WHERE stock_quantity <= warning_threshold 
    ORDER BY stock_quantity ASC
  `).all() as SparePart[];
}
