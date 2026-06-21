import { getDatabase } from '../database';
import {
  Technician,
  TechnicianSchedule,
  TechnicianStatus,
  ShiftType,
  FaultLevel,
} from '../types';
import { generateId, now, BusinessError, validateRequiredFields } from '../utils';

export function createTechnician(data: {
  name: string;
  employee_no: string;
  phone?: string;
  skill_tags?: string;
}): Technician {
  validateRequiredFields(data, ['name', 'employee_no']);

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM technicians WHERE employee_no = ?').get(data.employee_no);
  if (existing) {
    throw new BusinessError('DUPLICATE_EMPLOYEE_NO', '工号已存在');
  }

  const id = generateId();
  const createdAt = now();

  const stmt = db.prepare(`
    INSERT INTO technicians (
      id, name, employee_no, phone, status, skill_tags,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  stmt.run(
    id,
    data.name,
    data.employee_no,
    data.phone || null,
    data.skill_tags || '',
    createdAt,
    createdAt
  );

  return getTechnicianById(id)!;
}

export function getTechnicianById(id: string): Technician | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM technicians WHERE id = ?').get(id) as Technician | undefined;
}

export function getTechnicianByEmployeeNo(employeeNo: string): Technician | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM technicians WHERE employee_no = ?').get(employeeNo) as Technician | undefined;
}

export function listTechnicians(status?: TechnicianStatus, keyword?: string): Technician[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: any[] = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (keyword) {
    where.push('(name LIKE ? OR employee_no LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM technicians ${whereClause} ORDER BY created_at DESC`;

  return db.prepare(sql).all(...params) as Technician[];
}

export function updateTechnician(id: string, data: Partial<Technician>): Technician {
  const tech = getTechnicianById(id);
  if (!tech) {
    throw new BusinessError('TECHNICIAN_NOT_FOUND', '技师不存在');
  }

  const db = getDatabase();
  const updatedAt = now();

  const fields = [];
  const values = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.skill_tags !== undefined) { fields.push('skill_tags = ?'); values.push(data.skill_tags); }

  if (fields.length === 0) {
    return tech;
  }

  fields.push('updated_at = ?');
  values.push(updatedAt);
  values.push(id);

  const stmt = db.prepare(`UPDATE technicians SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getTechnicianById(id)!;
}

export function createSchedule(data: {
  technician_id: string;
  shift_date: string;
  shift_type: ShiftType;
  start_time?: string;
  end_time?: string;
}): TechnicianSchedule {
  validateRequiredFields(data, ['technician_id', 'shift_date', 'shift_type']);

  const tech = getTechnicianById(data.technician_id);
  if (!tech) {
    throw new BusinessError('TECHNICIAN_NOT_FOUND', '技师不存在');
  }

  const db = getDatabase();
  const id = generateId();
  const createdAt = now();

  const existing = db.prepare(`
    SELECT id FROM technician_schedules WHERE technician_id = ? AND shift_date = ?
  `).get(data.technician_id, data.shift_date);

  if (existing) {
    throw new BusinessError('DUPLICATE_SCHEDULE', '该技师当日已有排班');
  }

  let startTime = data.start_time || null;
  let endTime = data.end_time || null;

  if (data.shift_type === 'morning' && !startTime) {
    startTime = '08:00';
    endTime = '16:00';
  } else if (data.shift_type === 'afternoon' && !startTime) {
    startTime = '14:00';
    endTime = '22:00';
  } else if (data.shift_type === 'night' && !startTime) {
    startTime = '22:00';
    endTime = '06:00';
  } else if (data.shift_type === 'day_off') {
    startTime = null;
    endTime = null;
  }

  const stmt = db.prepare(`
    INSERT INTO technician_schedules (
      id, technician_id, shift_date, shift_type, start_time, end_time,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.technician_id,
    data.shift_date,
    data.shift_type,
    startTime,
    endTime,
    createdAt,
    createdAt
  );

  return getScheduleById(id)!;
}

export function getScheduleById(id: string): TechnicianSchedule | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM technician_schedules WHERE id = ?').get(id) as TechnicianSchedule | undefined;
}

export function getTechnicianScheduleByDate(technicianId: string, date: string): TechnicianSchedule | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM technician_schedules 
    WHERE technician_id = ? AND shift_date = ?
  `).get(technicianId, date) as TechnicianSchedule | undefined;
}

export function listSchedules(
  technicianId?: string,
  startDate?: string,
  endDate?: string
): TechnicianSchedule[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: any[] = [];

  if (technicianId) {
    where.push('technician_id = ?');
    params.push(technicianId);
  }
  if (startDate) {
    where.push('shift_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('shift_date <= ?');
    params.push(endDate);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM technician_schedules ${whereClause} ORDER BY shift_date ASC`;

  return db.prepare(sql).all(...params) as TechnicianSchedule[];
}

export function updateSchedule(id: string, data: Partial<TechnicianSchedule>): TechnicianSchedule {
  const schedule = getScheduleById(id);
  if (!schedule) {
    throw new BusinessError('SCHEDULE_NOT_FOUND', '排班记录不存在');
  }

  const db = getDatabase();
  const updatedAt = now();

  const fields = [];
  const values = [];

  if (data.shift_type !== undefined) { fields.push('shift_type = ?'); values.push(data.shift_type); }
  if (data.start_time !== undefined) { fields.push('start_time = ?'); values.push(data.start_time); }
  if (data.end_time !== undefined) { fields.push('end_time = ?'); values.push(data.end_time); }

  if (fields.length === 0) {
    return schedule;
  }

  fields.push('updated_at = ?');
  values.push(updatedAt);
  values.push(id);

  const stmt = db.prepare(`UPDATE technician_schedules SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getScheduleById(id)!;
}

export function deleteSchedule(id: string): void {
  const schedule = getScheduleById(id);
  if (!schedule) {
    throw new BusinessError('SCHEDULE_NOT_FOUND', '排班记录不存在');
  }

  const db = getDatabase();
  db.prepare('DELETE FROM technician_schedules WHERE id = ?').run(id);
}

export function isTechnicianAvailable(technicianId: string, dateTime: string): boolean {
  const tech = getTechnicianById(technicianId);
  if (!tech || tech.status !== 'active') {
    return false;
  }

  const dt = new Date(dateTime);
  const dateStr = dt.toISOString().split('T')[0];
  const timeStr = dt.toTimeString().slice(0, 5);

  const schedule = getTechnicianScheduleByDate(technicianId, dateStr);

  if (!schedule) {
    return false;
  }

  if (schedule.shift_type === 'day_off') {
    return false;
  }

  if (!schedule.start_time || !schedule.end_time) {
    return true;
  }

  if (schedule.end_time > schedule.start_time) {
    return timeStr >= schedule.start_time && timeStr <= schedule.end_time;
  } else {
    return timeStr >= schedule.start_time || timeStr <= schedule.end_time;
  }
}

export function recommendTechnicians(
  faultLevel: FaultLevel,
  skillKeyword?: string,
  dateTime?: string
): Technician[] {
  const db = getDatabase();
  const checkTime = dateTime || now();

  const allTechs = listTechnicians('active');
  if (allTechs.length === 0) {
    return [];
  }

  const dateStr = new Date(checkTime).toISOString().split('T')[0];
  const schedules = db.prepare(`
    SELECT * FROM technician_schedules WHERE shift_date = ?
  `).all(dateStr) as TechnicianSchedule[];

  const scheduleMap = new Map<string, TechnicianSchedule>();
  for (const s of schedules) {
    scheduleMap.set(s.technician_id, s);
  }

  const levelPriority: Record<FaultLevel, number> = {
    minor: 1,
    medium: 2,
    major: 3,
    critical: 4,
  };
  const requiredLevel = levelPriority[faultLevel];

  const scored = allTechs.map(tech => {
    let score = 0;
    let available = true;

    const schedule = scheduleMap.get(tech.id);
    if (!schedule || schedule.shift_type === 'day_off') {
      available = false;
    }

    if (skillKeyword && tech.skill_tags) {
      const tags = tech.skill_tags.toLowerCase().split(/[,，;；\s]+/).filter(Boolean);
      const keyword = skillKeyword.toLowerCase();
      if (tags.some(tag => tag.includes(keyword) || keyword.includes(tag))) {
        score += 50;
      }
    }

    const tagLevelMatch = matchFaultLevel(tech.skill_tags, faultLevel);
    if (tagLevelMatch) {
      score += 30 + (4 - Math.abs(requiredLevel - tagLevelMatch)) * 5;
    }

    return { tech, score, available };
  });

  return scored
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return b.score - a.score;
    })
    .map(item => item.tech);
}

function matchFaultLevel(skillTags: string, faultLevel: FaultLevel): number | null {
  if (!skillTags) return null;

  const tags = skillTags.toLowerCase();
  const levelMap: Record<string, number> = {
    '初级': 1, '入门': 1, 'junior': 1,
    '中级': 2, '普通': 2, 'intermediate': 2,
    '高级': 3, '资深': 3, 'senior': 3,
    '专家': 4, '技术总监': 4, 'expert': 4, 'master': 4,
    'minor': 1, 'medium': 2, 'major': 3, 'critical': 4,
  };

  for (const [key, level] of Object.entries(levelMap)) {
    if (tags.includes(key)) {
      return level;
    }
  }

  return null;
}

export function batchCreateSchedules(data: {
  technician_id: string;
  start_date: string;
  end_date: string;
  shift_type: ShiftType;
  work_days?: number[];
}): TechnicianSchedule[] {
  validateRequiredFields(data, ['technician_id', 'start_date', 'end_date', 'shift_type']);

  const tech = getTechnicianById(data.technician_id);
  if (!tech) {
    throw new BusinessError('TECHNICIAN_NOT_FOUND', '技师不存在');
  }

  const start = new Date(data.start_date);
  const end = new Date(data.end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new BusinessError('INVALID_DATE', '日期格式不正确');
  }

  if (start > end) {
    throw new BusinessError('INVALID_DATE_RANGE', '开始日期不能晚于结束日期');
  }

  const workDays = data.work_days || [0, 1, 2, 3, 4, 5, 6];
  const results: TechnicianSchedule[] = [];
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (workDays.includes(dayOfWeek)) {
      const dateStr = current.toISOString().split('T')[0];
      try {
        const schedule = createSchedule({
          technician_id: data.technician_id,
          shift_date: dateStr,
          shift_type: data.shift_type,
        });
        results.push(schedule);
      } catch (e) {
        if (!(e instanceof BusinessError && e.code === 'DUPLICATE_SCHEDULE')) {
          throw e;
        }
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return results;
}
