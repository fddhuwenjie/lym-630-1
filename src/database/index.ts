import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

const DB_FILENAME = 'fleet_maintenance.db';
const DATA_DIR = path.join(process.cwd(), 'data');
const EXPORT_DIR = path.join(process.cwd(), 'data', 'exports');

export function getDataDir(): string {
  return DATA_DIR;
}

export function getExportDir(): string {
  return EXPORT_DIR;
}

export function initDatabase(dbPath?: string): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const finalDbPath = dbPath || path.join(DATA_DIR, DB_FILENAME);
  db = new Database(finalDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plate_number TEXT UNIQUE NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      current_mileage INTEGER NOT NULL DEFAULT 0,
      last_maintenance_date TEXT,
      last_maintenance_mileage INTEGER,
      purchase_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicle_health_records (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      mileage INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      last_fault_level TEXT,
      total_repair_count INTEGER NOT NULL DEFAULT 0,
      total_maintenance_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      due_mileage INTEGER,
      due_date TEXT,
      fault_level TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      maintenance_plan_id TEXT,
      title TEXT NOT NULL,
      fault_level TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending_assign',
      assigned_to TEXT,
      diagnosis TEXT,
      labor_hours REAL NOT NULL DEFAULT 0,
      completion_result TEXT,
      acceptance_result TEXT,
      accepted_by TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT,
      cancel_reason TEXT,
      in_repair_at TEXT,
      rejected_at TEXT,
      reject_reason TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plans(id)
    );

    CREATE TABLE IF NOT EXISTS spare_parts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      specification TEXT,
      unit TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      preempt_quantity INTEGER NOT NULL DEFAULT 0,
      available_quantity INTEGER NOT NULL DEFAULT 0,
      warning_threshold INTEGER NOT NULL DEFAULT 10,
      unit_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_parts (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      part_id TEXT NOT NULL,
      part_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      returned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
      FOREIGN KEY (part_id) REFERENCES spare_parts(id)
    );

    CREATE TABLE IF NOT EXISTS part_transactions (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      work_order_id TEXT,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      before_balance INTEGER NOT NULL,
      after_balance INTEGER NOT NULL,
      before_preempt INTEGER NOT NULL DEFAULT 0,
      after_preempt INTEGER NOT NULL DEFAULT 0,
      operator TEXT NOT NULL,
      remark TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (part_id) REFERENCES spare_parts(id),
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
    );

    CREATE TABLE IF NOT EXISTS mileage_records (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      mileage INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      operator TEXT NOT NULL,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS export_records (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      parameters TEXT,
      operator TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      employee_no TEXT UNIQUE NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      skill_tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technician_schedules (
      id TEXT PRIMARY KEY,
      technician_id TEXT NOT NULL,
      shift_date TEXT NOT NULL,
      shift_type TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (technician_id) REFERENCES technicians(id),
      UNIQUE(technician_id, shift_date)
    );

    CREATE TABLE IF NOT EXISTS part_preempts (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      part_id TEXT NOT NULL,
      part_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'preempted',
      preempted_at TEXT NOT NULL,
      released_at TEXT,
      confirmed_at TEXT,
      released_by TEXT,
      confirmed_by TEXT,
      release_reason TEXT,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
      FOREIGN KEY (part_id) REFERENCES spare_parts(id)
    );

    CREATE TABLE IF NOT EXISTS timeout_configs (
      id TEXT PRIMARY KEY,
      fault_level TEXT UNIQUE NOT NULL,
      warning_hours REAL NOT NULL,
      overdue_hours REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrateAndSeed(db);
}

function migrateAndSeed(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(work_orders)").all() as { name: string }[];
  const colNames = columns.map(c => c.name);

  if (!colNames.includes('in_repair_at')) {
    db.exec('ALTER TABLE work_orders ADD COLUMN in_repair_at TEXT');
  }
  if (!colNames.includes('rejected_at')) {
    db.exec('ALTER TABLE work_orders ADD COLUMN rejected_at TEXT');
  }
  if (!colNames.includes('reject_reason')) {
    db.exec('ALTER TABLE work_orders ADD COLUMN reject_reason TEXT');
  }

  const spColumns = db.prepare("PRAGMA table_info(spare_parts)").all() as { name: string }[];
  const spColNames = spColumns.map(c => c.name);

  if (!spColNames.includes('preempt_quantity')) {
    db.exec('ALTER TABLE spare_parts ADD COLUMN preempt_quantity INTEGER NOT NULL DEFAULT 0');
  }
  if (!spColNames.includes('available_quantity')) {
    db.exec('ALTER TABLE spare_parts ADD COLUMN available_quantity INTEGER NOT NULL DEFAULT 0');
  }

  db.prepare('UPDATE spare_parts SET available_quantity = stock_quantity - preempt_quantity').run();

  const ptColumns = db.prepare("PRAGMA table_info(part_transactions)").all() as { name: string }[];
  const ptColNames = ptColumns.map(c => c.name);

  if (!ptColNames.includes('before_preempt')) {
    db.exec('ALTER TABLE part_transactions ADD COLUMN before_preempt INTEGER NOT NULL DEFAULT 0');
  }
  if (!ptColNames.includes('after_preempt')) {
    db.exec('ALTER TABLE part_transactions ADD COLUMN after_preempt INTEGER NOT NULL DEFAULT 0');
  }

  const timeoutCount = db.prepare('SELECT COUNT(*) as count FROM timeout_configs').get() as { count: number };
  if (timeoutCount.count === 0) {
    const nowStr = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO timeout_configs (id, fault_level, warning_hours, overdue_hours, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const defaults = [
      { level: 'minor', warning: 24, overdue: 48 },
      { level: 'medium', warning: 12, overdue: 24 },
      { level: 'major', warning: 6, overdue: 12 },
      { level: 'critical', warning: 2, overdue: 4 },
    ];
    const { v4: uuidv4 } = require('uuid');
    for (const d of defaults) {
      insertStmt.run(uuidv4(), d.level, d.warning, d.overdue, nowStr, nowStr);
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
