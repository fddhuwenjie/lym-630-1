import { getDatabase } from '../database';
import { SparePart, PartTransaction, WorkOrderPart, PartTransactionType, PartPreempt, PreemptStatus } from '../types';
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
  const stockQty = data.stock_quantity || 0;

  const stmt = db.prepare(`
    INSERT INTO spare_parts (
      id, name, code, specification, unit, stock_quantity,
      preempt_quantity, available_quantity,
      warning_threshold, unit_price, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.name,
    data.code,
    data.specification || null,
    data.unit,
    stockQty,
    stockQty,
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
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable + quantity;

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, available_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, afterAvailable, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, NULL, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, partId, quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, remark || null, createdAt);
  });

  tx();

  return getPartTransactionById(id)!;
}

export function preemptPart(
  workOrderId: string,
  partId: string,
  quantity: number,
  operator: string
): PartPreempt {
  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  if (quantity <= 0) {
    throw new BusinessError('INVALID_QUANTITY', '预占数量必须大于0');
  }

  if (part.available_quantity < quantity) {
    throw new BusinessError('INSUFFICIENT_STOCK', `可用库存不足，当前可用: ${part.available_quantity}，需要: ${quantity}`);
  }

  const db = getDatabase();
  const txnId = generateId();
  const preemptId = generateId();
  const createdAt = now();

  const existingPreempt = db.prepare(`
    SELECT * FROM part_preempts 
    WHERE work_order_id = ? AND part_id = ? AND status = 'preempted'
  `).get(workOrderId, partId) as PartPreempt | undefined;

  if (existingPreempt) {
    throw new BusinessError('DUPLICATE_PREEMPT', '该备件已在此工单中预占，不能重复预占');
  }

  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance;
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt + quantity;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable - quantity;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE spare_parts 
      SET preempt_quantity = ?, available_quantity = ?, updated_at = ? 
      WHERE id = ?
    `).run(afterPreempt, afterAvailable, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, ?, 'preempt', ?, ?, ?, ?, ?, ?, '备件预占', ?)
    `).run(txnId, partId, workOrderId, quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, createdAt);

    db.prepare(`
      INSERT INTO part_preempts (
        id, work_order_id, part_id, part_name, quantity, unit_price,
        status, preempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'preempted', ?)
    `).run(preemptId, workOrderId, partId, part.name, quantity, part.unit_price, createdAt);
  });

  tx();

  return getPartPreemptById(preemptId)!;
}

export function releasePreempt(
  workOrderId: string,
  partId: string,
  operator: string,
  reason?: string
): PartPreempt {
  const db = getDatabase();

  const preempt = db.prepare(`
    SELECT * FROM part_preempts 
    WHERE work_order_id = ? AND part_id = ? AND status = 'preempted'
  `).get(workOrderId, partId) as PartPreempt | undefined;

  if (!preempt) {
    throw new BusinessError('PREEMPT_NOT_FOUND', '未找到该工单的预占备件记录');
  }

  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  const txnId = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance;
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt - preempt.quantity;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable + preempt.quantity;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE spare_parts 
      SET preempt_quantity = ?, available_quantity = ?, updated_at = ? 
      WHERE id = ?
    `).run(afterPreempt, afterAvailable, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, ?, 'preempt_release', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(txnId, partId, workOrderId, preempt.quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, reason || '预占释放', createdAt);

    db.prepare(`
      UPDATE part_preempts 
      SET status = 'released', released_at = ?, released_by = ?, release_reason = ? 
      WHERE id = ?
    `).run(createdAt, operator, reason || null, preempt.id);
  });

  tx();

  return getPartPreemptById(preempt.id)!;
}

export function confirmPreempt(
  workOrderId: string,
  partId: string,
  operator: string
): PartPreempt {
  const db = getDatabase();

  const preempt = db.prepare(`
    SELECT * FROM part_preempts 
    WHERE work_order_id = ? AND part_id = ? AND status = 'preempted'
  `).get(workOrderId, partId) as PartPreempt | undefined;

  if (!preempt) {
    throw new BusinessError('PREEMPT_NOT_FOUND', '未找到该工单的预占备件记录');
  }

  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  const txnId = generateId();
  const workOrderPartId = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance - preempt.quantity;
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt - preempt.quantity;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE spare_parts 
      SET stock_quantity = ?, preempt_quantity = ?, updated_at = ? 
      WHERE id = ?
    `).run(afterBalance, afterPreempt, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, ?, 'preempt_confirm', ?, ?, ?, ?, ?, ?, '预占确认-正式扣减', ?)
    `).run(txnId, partId, workOrderId, preempt.quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, createdAt);

    db.prepare(`
      UPDATE part_preempts 
      SET status = 'confirmed', confirmed_at = ?, confirmed_by = ? 
      WHERE id = ?
    `).run(createdAt, operator, preempt.id);

    db.prepare(`
      INSERT INTO work_order_parts (
        id, work_order_id, part_id, part_name, quantity, unit_price, returned, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(workOrderPartId, workOrderId, partId, part.name, preempt.quantity, part.unit_price, createdAt);
  });

  tx();

  return getPartPreemptById(preempt.id)!;
}

export function releaseAllPreempts(workOrderId: string, operator: string, reason?: string): PartPreempt[] {
  const db = getDatabase();
  const preempts = db.prepare(`
    SELECT * FROM part_preempts WHERE work_order_id = ? AND status = 'preempted'
  `).all(workOrderId) as PartPreempt[];

  const results: PartPreempt[] = [];
  for (const preempt of preempts) {
    const result = releasePreempt(workOrderId, preempt.part_id, operator, reason);
    results.push(result);
  }

  return results;
}

export function confirmAllPreempts(workOrderId: string, operator: string): PartPreempt[] {
  const db = getDatabase();
  const preempts = db.prepare(`
    SELECT * FROM part_preempts WHERE work_order_id = ? AND status = 'preempted'
  `).all(workOrderId) as PartPreempt[];

  const results: PartPreempt[] = [];
  for (const preempt of preempts) {
    const result = confirmPreempt(workOrderId, preempt.part_id, operator);
    results.push(result);
  }

  return results;
}

export function getPartPreemptById(id: string): PartPreempt | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM part_preempts WHERE id = ?').get(id) as PartPreempt | undefined;
}

export function getWorkOrderPreempts(workOrderId: string, status?: PreemptStatus): PartPreempt[] {
  const db = getDatabase();
  if (status) {
    return db.prepare(`
      SELECT * FROM part_preempts WHERE work_order_id = ? AND status = ? ORDER BY preempted_at DESC
    `).all(workOrderId, status) as PartPreempt[];
  }
  return db.prepare('SELECT * FROM part_preempts WHERE work_order_id = ? ORDER BY preempted_at DESC')
    .all(workOrderId) as PartPreempt[];
}

export function consumePart(workOrderId: string, partId: string, quantity: number, operator: string): WorkOrderPart {
  const part = getSparePartById(partId);
  if (!part) {
    throw new BusinessError('PART_NOT_FOUND', '备件不存在');
  }

  if (quantity <= 0) {
    throw new BusinessError('INVALID_QUANTITY', '领用数量必须大于0');
  }

  if (part.available_quantity < quantity) {
    throw new BusinessError('INSUFFICIENT_STOCK', `可用库存不足，当前可用: ${part.available_quantity}，需要: ${quantity}`);
  }

  const db = getDatabase();
  const id = generateId();
  const txnId = generateId();
  const createdAt = now();
  const beforeBalance = part.stock_quantity;
  const afterBalance = beforeBalance - quantity;
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable - quantity;

  const existingPart = db.prepare(`
    SELECT * FROM work_order_parts WHERE work_order_id = ? AND part_id = ? AND returned = 0
  `).get(workOrderId, partId);

  if (existingPart) {
    throw new BusinessError('DUPLICATE_PART', '该备件已在此工单中领用，不能重复领用');
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, available_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, afterAvailable, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, '工单领用', ?)
    `).run(txnId, partId, workOrderId, quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, createdAt);

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
  const beforePreempt = part.preempt_quantity;
  const afterPreempt = beforePreempt;
  const beforeAvailable = part.available_quantity;
  const afterAvailable = beforeAvailable + workOrderPart.quantity;

  const tx = db.transaction(() => {
    db.prepare('UPDATE spare_parts SET stock_quantity = ?, available_quantity = ?, updated_at = ? WHERE id = ?')
      .run(afterBalance, afterAvailable, createdAt, partId);

    db.prepare(`
      INSERT INTO part_transactions (
        id, part_id, work_order_id, type, quantity, before_balance,
        after_balance, before_preempt, after_preempt, operator, remark, created_at
      ) VALUES (?, ?, ?, 'return', ?, ?, ?, ?, ?, ?, '工单退回', ?)
    `).run(txnId, partId, workOrderId, workOrderPart.quantity, beforeBalance, afterBalance, beforePreempt, afterPreempt, operator, createdAt);

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
    WHERE available_quantity <= warning_threshold 
    ORDER BY available_quantity ASC
  `).all() as SparePart[];
}
