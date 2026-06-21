import { initDatabase, closeDatabase, getDataDir } from '../src/database';
import {
  createVehicle,
  getVehicleById,
  recordMileage,
  getVehicleHealthRecord,
  listVehicles,
} from '../src/services/vehicleService';
import {
  createMaintenancePlan,
  listMaintenancePlans,
  checkAndGenerateMaintenancePlans,
  completeMaintenancePlan,
  checkAndGeneratePlansForFault,
} from '../src/services/maintenancePlanService';
import {
  createWorkOrder,
  assignWorkOrder,
  recordDiagnosis,
  recordLaborHours,
  useSparePart,
  completeWorkOrder,
  acceptWorkOrder,
  rejectWorkOrder,
  cancelWorkOrder,
  getWorkOrderById,
  getWorkOrderDetail,
  getRecommendedTechnicians,
  preemptSparePart,
  getTimeoutConfig,
  updateTimeoutConfig,
  listTimeoutConfigs,
  getWorkOrderTimeoutInfo,
  getTimeoutWorkOrders,
  getWorkOrderStatistics,
} from '../src/services/workOrderService';
import {
  createSparePart,
  getSparePartById,
  inboundPart,
  getLowStockParts,
  listPartTransactions,
  getWorkOrderParts,
  getWorkOrderPreempts,
  preemptPart,
  releasePreempt,
  confirmPreempt,
} from '../src/services/sparePartService';
import {
  createTechnician,
  getTechnicianById,
  listTechnicians,
  updateTechnician,
  createSchedule,
  listSchedules,
  isTechnicianAvailable,
  recommendTechnicians,
  batchCreateSchedules,
} from '../src/services/technicianService';
import { exportWorkOrderDetails, listExportRecords } from '../src/services/exportService';
import { BusinessError } from '../src/utils';
import * as fs from 'fs';
import * as path from 'path';

let dbPath: string;

beforeAll(() => {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbPath = path.join(dataDir, `test_${Date.now()}.db`);
  initDatabase(dbPath);
});

afterAll(() => {
  closeDatabase();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
});

let testTechnicianId: string;

beforeAll(() => {
  const tech = createTechnician({
    name: '默认测试技师',
    employee_no: 'TEST-TECH-DEFAULT',
    phone: '13800000000',
    skill_tags: '发动机,电路,变速箱,高级',
  });
  testTechnicianId = tech.id;

  const today = new Date().toISOString().split('T')[0];
  createSchedule({
    technician_id: tech.id,
    shift_date: today,
    shift_type: 'morning',
  });
});

function createAvailableTech(employeeNo: string, name: string): string {
  const tech = createTechnician({
    name,
    employee_no: employeeNo,
    skill_tags: '发动机,高级',
  });
  const today = new Date().toISOString().split('T')[0];
  createSchedule({
    technician_id: tech.id,
    shift_date: today,
    shift_type: 'morning',
  });
  return tech.id;
}

describe('Vehicle Management', () => {
  test('should create a vehicle successfully', () => {
    const vehicle = createVehicle({
      plate_number: '京A12345',
      model: '大众帕萨特',
      purchase_date: '2023-01-01',
      current_mileage: 10000,
    });

    expect(vehicle).toBeDefined();
    expect(vehicle.id).toBeTruthy();
    expect(vehicle.plate_number).toBe('京A12345');
    expect(vehicle.current_mileage).toBe(10000);
    expect(vehicle.status).toBe('idle');
  });

  test('should not create vehicle with duplicate plate number', () => {
    expect(() => {
      createVehicle({
        plate_number: '京A12345',
        model: '丰田凯美瑞',
        purchase_date: '2023-06-01',
      });
    }).toThrow(BusinessError);
  });

  test('should get vehicle by id', () => {
    const vehicle = createVehicle({
      plate_number: '京B67890',
      model: '本田雅阁',
      purchase_date: '2022-01-01',
    });

    const found = getVehicleById(vehicle.id);
    expect(found).toBeDefined();
    expect(found!.plate_number).toBe('京B67890');
  });

  test('should have health record after vehicle creation', () => {
    const vehicle = createVehicle({
      plate_number: '京C11111',
      model: '奔驰C级',
      purchase_date: '2024-01-01',
      current_mileage: 5000,
    });

    const health = getVehicleHealthRecord(vehicle.id);
    expect(health).toBeDefined();
    expect(health!.health_score).toBe(100);
    expect(health!.mileage).toBe(5000);
  });

  test('should record mileage successfully', () => {
    const vehicle = createVehicle({
      plate_number: '京D22222',
      model: '宝马3系',
      purchase_date: '2024-01-01',
      current_mileage: 10000,
    });

    const record = recordMileage(vehicle.id, 12000, 'admin');
    expect(record.mileage).toBe(12000);

    const updated = getVehicleById(vehicle.id);
    expect(updated!.current_mileage).toBe(12000);
  });

  test('should reject mileage rollback', () => {
    const vehicle = createVehicle({
      plate_number: '京E33333',
      model: '奥迪A4L',
      purchase_date: '2024-01-01',
      current_mileage: 20000,
    });

    let error: BusinessError | undefined;
    try {
      recordMileage(vehicle.id, 15000, 'admin');
    } catch (e) {
      error = e as BusinessError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe('MILEAGE_ROLLBACK');
  });

  test('should list vehicles with status filter', () => {
    createVehicle({
      plate_number: '京F44444',
      model: '别克君威',
      purchase_date: '2024-01-01',
      status: 'running',
    });

    const runningVehicles = listVehicles('running');
    expect(runningVehicles.length).toBeGreaterThan(0);
    expect(runningVehicles.every(v => v.status === 'running')).toBe(true);
  });
});

describe('Maintenance Plan Management', () => {
  test('should create maintenance plan', () => {
    const vehicle = createVehicle({
      plate_number: '京G55555',
      model: '日产天籁',
      purchase_date: '2023-01-01',
      current_mileage: 8000,
    });

    const plan = createMaintenancePlan({
      vehicle_id: vehicle.id,
      type: 'routine',
      name: '常规保养',
      description: '每5000公里保养一次',
      due_mileage: 10000,
    });

    expect(plan).toBeDefined();
    expect(plan.status).toBe('pending');
    expect(plan.due_mileage).toBe(10000);
  });

  test('should generate maintenance plans based on mileage', () => {
    const vehicle = createVehicle({
      plate_number: '京H66666',
      model: '雪佛兰迈锐宝',
      purchase_date: '2023-01-01',
      current_mileage: 4000,
    });

    const plansBefore = listMaintenancePlans(vehicle.id, 'pending');
    expect(plansBefore.filter(p => p.type === 'mileage_based').length).toBe(0);

    recordMileage(vehicle.id, 9500, 'admin');

    const plansAfter = listMaintenancePlans(vehicle.id, 'pending');
    const mileagePlans = plansAfter.filter(p => p.type === 'mileage_based');
    expect(mileagePlans.length).toBeGreaterThan(0);
  });

  test('should generate maintenance plans based on time', () => {
    const vehicle = createVehicle({
      plate_number: '京J77777',
      model: '起亚K5',
      purchase_date: '2020-01-01',
      current_mileage: 1000,
    });

    const plans = checkAndGenerateMaintenancePlans(vehicle.id);
    const timePlans = plans.filter(p => p.type === 'time_based');
    expect(timePlans.length).toBeGreaterThan(0);
  });

  test('should generate fault-based maintenance plan for major faults', () => {
    const vehicle = createVehicle({
      plate_number: '京K88888',
      model: '现代索纳塔',
      purchase_date: '2024-01-01',
    });

    const plan = checkAndGeneratePlansForFault(vehicle.id, 'major');
    expect(plan).not.toBeNull();
    expect(plan!.type).toBe('fault_based');
    expect(plan!.fault_level).toBe('major');
  });

  test('should not generate plan for minor faults', () => {
    const vehicle = createVehicle({
      plate_number: '京L99999',
      model: '马自达6',
      purchase_date: '2024-01-01',
    });

    const plan = checkAndGeneratePlansForFault(vehicle.id, 'minor');
    expect(plan).toBeNull();
  });

  test('should complete maintenance plan', () => {
    const vehicle = createVehicle({
      plate_number: '京M00001',
      model: '标致508',
      purchase_date: '2024-01-01',
    });

    const plan = createMaintenancePlan({
      vehicle_id: vehicle.id,
      type: 'routine',
      name: '测试保养',
      due_mileage: 5000,
    });

    const completed = completeMaintenancePlan(plan.id);
    expect(completed.status).toBe('completed');
    expect(completed.completed_at).toBeTruthy();
  });
});

describe('Work Order Management', () => {
  test('should create work order for idle vehicle', () => {
    const vehicle = createVehicle({
      plate_number: '京N00002',
      model: '雪铁龙C5',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '发动机异响维修',
      fault_level: 'medium',
      description: '发动机启动时有异响',
    });

    expect(order).toBeDefined();
    expect(order.status).toBe('pending_assign');
    expect(order.fault_level).toBe('medium');
  });

  test('should reject work order for running vehicle', () => {
    const vehicle = createVehicle({
      plate_number: '京P00003',
      model: '雷诺纬度',
      purchase_date: '2024-01-01',
      status: 'running',
    });

    expect(() => {
      createWorkOrder({
        vehicle_id: vehicle.id,
        title: '常规检查',
        fault_level: 'minor',
      });
    }).toThrow(BusinessError);
  });

  test('should assign work order', () => {
    const vehicle = createVehicle({
      plate_number: '京Q00004',
      model: '菲亚特菲翔',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '刹车系统检查',
      fault_level: 'minor',
    });

    const assigned = assignWorkOrder(order.id, testTechnicianId);
    expect(assigned.status).toBe('in_repair');
    expect(assigned.assigned_to).toBe(testTechnicianId);

    const updatedVehicle = getVehicleById(vehicle.id);
    expect(updatedVehicle!.status).toBe('in_repair');
  });

  test('should record diagnosis', () => {
    const vehicle = createVehicle({
      plate_number: '京R00005',
      model: '长安CS75',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '空调不制冷',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);

    const updated = recordDiagnosis(order.id, '空调压缩机故障，需要更换压缩机');
    expect(updated.diagnosis).toBe('空调压缩机故障，需要更换压缩机');
  });

  test('should record labor hours', () => {
    const vehicle = createVehicle({
      plate_number: '京S00006',
      model: '哈弗H6',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '变速箱保养',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    const updated = recordLaborHours(order.id, 4.5);
    expect(updated.labor_hours).toBe(4.5);
  });

  test('should complete work order', () => {
    const vehicle = createVehicle({
      plate_number: '京T00007',
      model: '吉利帝豪',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '更换机油',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    recordLaborHours(order.id, 1);

    const completed = completeWorkOrder(order.id, '机油更换完成，运行正常');
    expect(completed.status).toBe('pending_acceptance');
    expect(completed.completion_result).toBe('机油更换完成，运行正常');
  });

  test('should accept work order and update vehicle status', () => {
    const vehicle = createVehicle({
      plate_number: '京U00008',
      model: '比亚迪宋',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '电瓶更换',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    completeWorkOrder(order.id, '电瓶更换完成');

    const accepted = acceptWorkOrder(order.id, '验收通过，车辆恢复正常', '质检李工');
    expect(accepted.status).toBe('completed');
    expect(accepted.acceptance_result).toBe('验收通过，车辆恢复正常');
    expect(accepted.accepted_by).toBe('质检李工');

    const updatedVehicle = getVehicleById(vehicle.id);
    expect(updatedVehicle!.status).toBe('idle');
  });

  test('should reject direct completion without acceptance flow', () => {
    const vehicle = createVehicle({
      plate_number: '京V00009',
      model: '奇瑞瑞虎',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '轮胎更换',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);

    expect(() => {
      acceptWorkOrder(order.id, '直接完成', '测试员');
    }).toThrow(BusinessError);
  });

  test('should cancel work order and return parts', () => {
    const vehicle = createVehicle({
      plate_number: '京W00010',
      model: '传祺GS4',
      purchase_date: '2024-01-01',
    });

    const part = createSparePart({
      name: '机油滤清器',
      code: 'OIL-FILTER-001',
      unit: '个',
      stock_quantity: 10,
      unit_price: 50,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '取消测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    useSparePart(order.id, part.id, 2, '仓库管理员');

    const partAfterUse = getSparePartById(part.id);
    expect(partAfterUse!.stock_quantity).toBe(8);

    cancelWorkOrder(order.id, '客户取消维修', '管理员');

    const cancelled = getWorkOrderById(order.id);
    expect(cancelled!.status).toBe('cancelled');

    const partAfterReturn = getSparePartById(part.id);
    expect(partAfterReturn!.stock_quantity).toBe(10);

    const parts = getWorkOrderParts(order.id);
    expect(parts.every(p => p.returned)).toBe(true);
  });

  test('should update health record after repair completion', () => {
    const vehicle = createVehicle({
      plate_number: '京X00011',
      model: '荣威RX5',
      purchase_date: '2024-01-01',
    });

    const healthBefore = getVehicleHealthRecord(vehicle.id);
    expect(healthBefore!.total_repair_count).toBe(0);

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '雨刷更换',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    completeWorkOrder(order.id, '雨刷更换完成');
    acceptWorkOrder(order.id, '验收通过', '质检');

    const healthAfter = getVehicleHealthRecord(vehicle.id);
    expect(healthAfter!.total_repair_count).toBe(1);
    expect(healthAfter!.last_fault_level).toBe('minor');
  });
});

describe('Spare Part Management', () => {
  test('should create spare part', () => {
    const part = createSparePart({
      name: '空气滤清器',
      code: 'AIR-FILTER-001',
      specification: '通用型',
      unit: '个',
      stock_quantity: 50,
      warning_threshold: 10,
      unit_price: 80,
    });

    expect(part).toBeDefined();
    expect(part.name).toBe('空气滤清器');
    expect(part.stock_quantity).toBe(50);
  });

  test('should not create part with duplicate code', () => {
    createSparePart({
      name: '机滤',
      code: 'OIL-FILTER-TEST',
      unit: '个',
    });

    expect(() => {
      createSparePart({
        name: '机油滤清器',
        code: 'OIL-FILTER-TEST',
        unit: '个',
      });
    }).toThrow(BusinessError);
  });

  test('should inbound spare part', () => {
    const part = createSparePart({
      name: '刹车片',
      code: 'BRAKE-PAD-001',
      unit: '套',
      stock_quantity: 5,
      unit_price: 300,
    });

    const txn = inboundPart(part.id, 10, '仓库管理员', '采购入库');
    expect(txn.type).toBe('inbound');
    expect(txn.quantity).toBe(10);

    const updated = getSparePartById(part.id);
    expect(updated!.stock_quantity).toBe(15);
  });

  test('should reject insufficient stock', () => {
    const vehicle = createVehicle({
      plate_number: '京Y00012',
      model: '名爵6',
      purchase_date: '2024-01-01',
    });

    const part = createSparePart({
      name: '火花塞',
      code: 'SPARK-PLUG-001',
      unit: '个',
      stock_quantity: 2,
      unit_price: 100,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '火花塞更换',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);

    expect(() => {
      useSparePart(order.id, part.id, 4, '仓库管理员');
    }).toThrow(BusinessError);
  });

  test('should reject duplicate part usage in same work order', () => {
    const vehicle = createVehicle({
      plate_number: '京Z00013',
      model: '奔腾B70',
      purchase_date: '2024-01-01',
    });

    const part = createSparePart({
      name: '空调滤芯',
      code: 'AC-FILTER-001',
      unit: '个',
      stock_quantity: 20,
      unit_price: 60,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '空调系统保养',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    useSparePart(order.id, part.id, 1, '仓库管理员');

    expect(() => {
      useSparePart(order.id, part.id, 1, '仓库管理员');
    }).toThrow(BusinessError);
  });

  test('should get low stock warning', () => {
    createSparePart({
      name: '雨刷片',
      code: 'WIPER-001',
      unit: '副',
      stock_quantity: 5,
      warning_threshold: 10,
      unit_price: 120,
    });

    createSparePart({
      name: '电瓶',
      code: 'BATTERY-001',
      unit: '个',
      stock_quantity: 100,
      warning_threshold: 10,
      unit_price: 500,
    });

    const lowStock = getLowStockParts();
    expect(lowStock.length).toBeGreaterThan(0);
    expect(lowStock.every(p => p.stock_quantity <= p.warning_threshold)).toBe(true);
  });

  test('should record part transactions', () => {
    const part = createSparePart({
      name: '轮胎',
      code: 'TIRE-001',
      unit: '条',
      stock_quantity: 10,
      unit_price: 800,
    });

    inboundPart(part.id, 5, '管理员', '补货入库');

    const transactions = listPartTransactions(part.id);
    expect(transactions.length).toBeGreaterThanOrEqual(1);
    expect(transactions[0].type).toBe('inbound');
  });
});

describe('Work Order with Maintenance Plan', () => {
  test('should associate work order with maintenance plan', () => {
    const vehicle = createVehicle({
      plate_number: '京A20001',
      model: '斯柯达明锐',
      purchase_date: '2023-01-01',
      current_mileage: 6000,
    });

    const plan = createMaintenancePlan({
      vehicle_id: vehicle.id,
      type: 'mileage_based',
      name: '5000公里保养',
      due_mileage: 10000,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      maintenance_plan_id: plan.id,
      title: '执行5000公里保养',
      fault_level: 'minor',
    });

    expect(order.maintenance_plan_id).toBe(plan.id);
  });

  test('should complete maintenance plan after work order acceptance', () => {
    const vehicle = createVehicle({
      plate_number: '京B20002',
      model: '铃木雨燕',
      purchase_date: '2023-01-01',
    });

    const plan = createMaintenancePlan({
      vehicle_id: vehicle.id,
      type: 'routine',
      name: '常规保养',
      due_mileage: 5000,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      maintenance_plan_id: plan.id,
      title: '常规保养工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    completeWorkOrder(order.id, '保养完成');
    acceptWorkOrder(order.id, '验收通过', '质检员');

    const updatedPlan = listMaintenancePlans(vehicle.id).find(p => p.id === plan.id);
    expect(updatedPlan!.status).toBe('completed');
  });
});

describe('Export Functionality', () => {
  test('should export work order details', async () => {
    const vehicle = createVehicle({
      plate_number: '京C20003',
      model: '五菱宏光',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '导出测试工单',
      fault_level: 'minor',
      description: '用于测试导出功能',
    });

    assignWorkOrder(order.id, testTechnicianId);
    recordDiagnosis(order.id, '测试诊断结果');
    recordLaborHours(order.id, 2);
    completeWorkOrder(order.id, '测试完工结果');
    acceptWorkOrder(order.id, '测试验收结果', '测试验收员');

    const exportRecord = await exportWorkOrderDetails(
      { vehicleId: vehicle.id },
      'admin'
    );

    expect(exportRecord).toBeDefined();
    expect(exportRecord.type).toBe('work_order_details');
    expect(exportRecord.file_name).toBeTruthy();

    const fs = require('fs');
    expect(fs.existsSync(exportRecord.file_path)).toBe(true);
  });

  test('should list export records', async () => {
    const beforeRecords = listExportRecords();

    await exportWorkOrderDetails({}, 'admin');

    const afterRecords = listExportRecords();
    expect(afterRecords.length).toBe(beforeRecords.length + 1);
  });
});

describe('Edge Cases and Data Consistency', () => {
  test('should maintain data consistency after restart (same db)', () => {
    const vehicle = createVehicle({
      plate_number: '京D20004',
      model: '一汽奔腾',
      purchase_date: '2024-01-01',
      current_mileage: 5000,
    });

    const part = createSparePart({
      name: '汽油滤清器',
      code: 'FUEL-FILTER-001',
      unit: '个',
      stock_quantity: 20,
      unit_price: 45,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '一致性测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    useSparePart(order.id, part.id, 3, '仓库管理员');

    closeDatabase();

    initDatabase(dbPath);

    const vehicleAfter = getVehicleById(vehicle.id);
    expect(vehicleAfter).toBeDefined();
    expect(vehicleAfter!.status).toBe('in_repair');

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.stock_quantity).toBe(17);

    const orderAfter = getWorkOrderById(order.id);
    expect(orderAfter).toBeDefined();
    expect(orderAfter!.status).toBe('in_repair');

    const transactions = listPartTransactions(undefined, order.id);
    expect(transactions.length).toBeGreaterThan(0);
  });

  test('should get work order detail with parts', () => {
    const vehicle = createVehicle({
      plate_number: '京E20005',
      model: '东风风神',
      purchase_date: '2024-01-01',
    });

    const part = createSparePart({
      name: '防冻液',
      code: 'COOLANT-001',
      unit: '瓶',
      stock_quantity: 30,
      unit_price: 80,
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '防冻液更换',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    useSparePart(order.id, part.id, 2, '仓管');

    const detail = getWorkOrderDetail(order.id);
    expect(detail.workOrder).toBeDefined();
    expect(detail.parts.length).toBe(1);
    expect(detail.parts[0].part_name).toBe('防冻液');
    expect(detail.parts[0].quantity).toBe(2);
  });

  test('should update vehicle last maintenance info after acceptance', () => {
    const vehicle = createVehicle({
      plate_number: '京F20006',
      model: '东南菱悦',
      purchase_date: '2024-01-01',
      current_mileage: 8000,
    });

    expect(vehicle.last_maintenance_date).toBeNull();
    expect(vehicle.last_maintenance_mileage).toBeNull();

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '首保',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    completeWorkOrder(order.id, '首保完成');
    acceptWorkOrder(order.id, '验收通过', '首保主管');

    const updated = getVehicleById(vehicle.id);
    expect(updated!.last_maintenance_date).toBeTruthy();
    expect(updated!.last_maintenance_mileage).toBe(8000);
  });
});

describe('Technician Management', () => {
  test('should create a technician successfully', () => {
    const tech = createTechnician({
      name: '张师傅',
      employee_no: 'TECH001',
      phone: '13800138001',
      skill_tags: '发动机,变速箱,高级',
    });

    expect(tech).toBeDefined();
    expect(tech.id).toBeTruthy();
    expect(tech.name).toBe('张师傅');
    expect(tech.employee_no).toBe('TECH001');
    expect(tech.status).toBe('active');
    expect(tech.skill_tags).toContain('发动机');
  });

  test('should not create technician with duplicate employee no', () => {
    expect(() => {
      createTechnician({
        name: '李师傅',
        employee_no: 'TECH001',
      });
    }).toThrow(BusinessError);
  });

  test('should list technicians with status filter', () => {
    const activeTechs = listTechnicians('active');
    expect(activeTechs.length).toBeGreaterThan(0);
    expect(activeTechs.every(t => t.status === 'active')).toBe(true);
  });

  test('should update technician status', () => {
    const tech = createTechnician({
      name: '王师傅',
      employee_no: 'TECH-INACTIVE-001',
    });

    const updated = updateTechnician(tech.id, { status: 'inactive' } as any);
    expect(updated.status).toBe('inactive');
  });
});

describe('Technician Scheduling', () => {
  test('should create a schedule for technician', () => {
    const tech = createTechnician({
      name: '李师傅',
      employee_no: 'TECH-SCHED-001',
    });

    const today = new Date().toISOString().split('T')[0];
    const schedule = createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'morning',
    });

    expect(schedule).toBeDefined();
    expect(schedule.shift_type).toBe('morning');
    expect(schedule.start_time).toBe('08:00');
    expect(schedule.end_time).toBe('16:00');
  });

  test('should check technician availability', () => {
    const tech = createTechnician({
      name: '赵师傅',
      employee_no: 'TECH-AVAIL-001',
    });

    const today = new Date().toISOString().split('T')[0];
    createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'morning',
    });

    const now = new Date();
    const morningTime = new Date(now);
    morningTime.setHours(10, 0, 0, 0);
    const available = isTechnicianAvailable(tech.id, morningTime.toISOString());
    expect(available).toBe(true);

    const nightTime = new Date(now);
    nightTime.setHours(23, 0, 0, 0);
    const notAvailable = isTechnicianAvailable(tech.id, nightTime.toISOString());
    expect(notAvailable).toBe(false);
  });

  test('should not assign work order to unavailable technician', () => {
    const tech = createTechnician({
      name: '钱师傅',
      employee_no: 'TECH-UNAVAIL-001',
    });

    const vehicle = createVehicle({
      plate_number: '京G-TEST-001',
      model: '测试车辆',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '测试派工工单',
      fault_level: 'minor',
    });

    const today = new Date().toISOString().split('T')[0];
    createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'day_off',
    });

    let error: BusinessError | undefined;
    try {
      assignWorkOrder(order.id, tech.id);
    } catch (e) {
      error = e as BusinessError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe('TECHNICIAN_UNAVAILABLE');
  });

  test('should not assign work order to inactive technician', () => {
    const tech = createTechnician({
      name: '孙师傅',
      employee_no: 'TECH-INACT-002',
    });
    updateTechnician(tech.id, { status: 'inactive' } as any);

    const vehicle = createVehicle({
      plate_number: '京H-TEST-002',
      model: '测试车辆2',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '测试派工工单2',
      fault_level: 'minor',
    });

    let error: BusinessError | undefined;
    try {
      assignWorkOrder(order.id, tech.id);
    } catch (e) {
      error = e as BusinessError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe('TECHNICIAN_INACTIVE');
  });

  test('should not assign work order to non-existent technician', () => {
    const vehicle = createVehicle({
      plate_number: '京H-TEST-003',
      model: '测试车辆3',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '测试派工工单3',
      fault_level: 'minor',
    });

    let error: BusinessError | undefined;
    try {
      assignWorkOrder(order.id, 'non-existent-technician-id');
    } catch (e) {
      error = e as BusinessError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe('TECHNICIAN_NOT_FOUND');
    expect(order.status).toBe('pending_assign');

    const checkOrder = getWorkOrderById(order.id);
    expect(checkOrder!.status).toBe('pending_assign');
    expect(checkOrder!.assigned_to).toBeNull();
  });

  test('should not assign work order with empty technician id', () => {
    const vehicle = createVehicle({
      plate_number: '京H-TEST-004',
      model: '测试车辆4',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '测试派工工单4',
      fault_level: 'minor',
    });

    let error: BusinessError | undefined;
    try {
      assignWorkOrder(order.id, '');
    } catch (e) {
      error = e as BusinessError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe('TECHNICIAN_NOT_FOUND');

    const checkOrder = getWorkOrderById(order.id);
    expect(checkOrder!.status).toBe('pending_assign');
  });

  test('should verify full assignment validation flow', () => {
    const tech = createTechnician({
      name: '完整校验技师',
      employee_no: 'TECH-FULL-CHECK-001',
      skill_tags: '发动机,高级',
    });
    updateTechnician(tech.id, { status: 'inactive' } as any);

    const vehicle = createVehicle({
      plate_number: '京H-TEST-005',
      model: '测试车辆5',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '测试派工工单5',
      fault_level: 'minor',
    });

    expect(() => assignWorkOrder(order.id, tech.id)).toThrow(BusinessError);
    expect(() => assignWorkOrder(order.id, tech.id)).toThrow('非激活');

    updateTechnician(tech.id, { status: 'active' } as any);
    expect(() => assignWorkOrder(order.id, tech.id)).toThrow(BusinessError);
    expect(() => assignWorkOrder(order.id, tech.id)).toThrow('不在值班时间');

    const today = new Date().toISOString().split('T')[0];
    createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'morning',
    });

    const assigned = assignWorkOrder(order.id, tech.id);
    expect(assigned.status).toBe('in_repair');
    expect(assigned.assigned_to).toBe(tech.id);
  });

  test('should recommend technicians based on fault level and skills', () => {
    createTechnician({
      name: '周高级',
      employee_no: 'TECH-REC-001',
      skill_tags: '发动机,高级',
    });
    createTechnician({
      name: '吴初级',
      employee_no: 'TECH-REC-002',
      skill_tags: '电路,初级',
    });

    const techs = recommendTechnicians('major', '发动机');
    expect(techs.length).toBeGreaterThan(0);
  });

  test('should batch create schedules', () => {
    const tech = createTechnician({
      name: '郑批量',
      employee_no: 'TECH-BATCH-001',
    });

    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + 6);

    const schedules = batchCreateSchedules({
      technician_id: tech.id,
      start_date: start.toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
      shift_type: 'morning',
      work_days: [1, 2, 3, 4, 5],
    });

    expect(schedules.length).toBeGreaterThanOrEqual(5);
    expect(schedules.length).toBeLessThanOrEqual(7);
  });
});

describe('Spare Part Preemption', () => {
  test('should preempt spare part successfully', () => {
    const part = createSparePart({
      name: '预占测试滤芯',
      code: 'PREEMPT-TEST-001',
      unit: '个',
      stock_quantity: 20,
      unit_price: 100,
    });

    const vehicle = createVehicle({
      plate_number: '京J-PREEMPT-001',
      model: '测试预占车辆',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '预占测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);

    const preempt = preemptSparePart(order.id, part.id, 5, '仓库管理员');
    expect(preempt).toBeDefined();
    expect(preempt.status).toBe('preempted');
    expect(preempt.quantity).toBe(5);

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.stock_quantity).toBe(20);
    expect(partAfter!.preempt_quantity).toBe(5);
    expect(partAfter!.available_quantity).toBe(15);
  });

  test('should not allow duplicate preemption for same part in same order', () => {
    const part = createSparePart({
      name: '重复预占测试件',
      code: 'PREEMPT-DUP-001',
      unit: '个',
      stock_quantity: 10,
    });

    const vehicle = createVehicle({
      plate_number: '京K-PREEMPT-002',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '重复预占测试',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 3, '管理员');

    expect(() => {
      preemptSparePart(order.id, part.id, 2, '管理员');
    }).toThrow(BusinessError);
  });

  test('should release preempted part', () => {
    const part = createSparePart({
      name: '释放测试件',
      code: 'PREEMPT-RELEASE-001',
      unit: '个',
      stock_quantity: 15,
    });

    const vehicle = createVehicle({
      plate_number: '京L-PREEMPT-003',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '释放测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 4, '管理员');

    const released = releasePreempt(order.id, part.id, '管理员', '测试释放');
    expect(released.status).toBe('released');

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.preempt_quantity).toBe(0);
    expect(partAfter!.available_quantity).toBe(15);
  });

  test('should confirm preempted part (acceptance)', () => {
    const part = createSparePart({
      name: '确认测试件',
      code: 'PREEMPT-CONFIRM-001',
      unit: '个',
      stock_quantity: 25,
      unit_price: 80,
    });

    const vehicle = createVehicle({
      plate_number: '京M-PREEMPT-004',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '确认测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 5, '管理员');
    completeWorkOrder(order.id, '维修完成');

    const confirmed = confirmPreempt(order.id, part.id, '质检员');
    expect(confirmed.status).toBe('confirmed');

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.stock_quantity).toBe(20);
    expect(partAfter!.preempt_quantity).toBe(0);
    expect(partAfter!.available_quantity).toBe(20);
  });

  test('should release all preempts when order is cancelled', () => {
    const part1 = createSparePart({
      name: '取消测试件1',
      code: 'CANCEL-TEST-001',
      unit: '个',
      stock_quantity: 30,
    });
    const part2 = createSparePart({
      name: '取消测试件2',
      code: 'CANCEL-TEST-002',
      unit: '个',
      stock_quantity: 40,
    });

    const vehicle = createVehicle({
      plate_number: '京N-CANCEL-001',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '取消测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part1.id, 5, '管理员');
    preemptSparePart(order.id, part2.id, 10, '管理员');

    cancelWorkOrder(order.id, '客户取消', '管理员');

    const part1After = getSparePartById(part1.id);
    const part2After = getSparePartById(part2.id);
    expect(part1After!.preempt_quantity).toBe(0);
    expect(part1After!.available_quantity).toBe(30);
    expect(part2After!.preempt_quantity).toBe(0);
    expect(part2After!.available_quantity).toBe(40);

    const preempts = getWorkOrderPreempts(order.id, 'preempted');
    expect(preempts.length).toBe(0);
  });

  test('should release all preempts when order is rejected', () => {
    const part = createSparePart({
      name: '驳回测试件',
      code: 'REJECT-TEST-001',
      unit: '个',
      stock_quantity: 50,
    });

    const vehicle = createVehicle({
      plate_number: '京O-REJECT-001',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '驳回测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 8, '管理员');
    completeWorkOrder(order.id, '维修完成');

    rejectWorkOrder(order.id, '质量不达标', '质检员');

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.preempt_quantity).toBe(0);
    expect(partAfter!.available_quantity).toBe(50);

    const rejectedOrder = getWorkOrderById(order.id);
    expect(rejectedOrder!.status).toBe('rejected');
  });

  test('preempted quantity cannot be consumed twice', () => {
    const part = createSparePart({
      name: '防重复扣减测试',
      code: 'NO-DOUBLE-001',
      unit: '个',
      stock_quantity: 20,
      unit_price: 50,
    });

    const vehicle = createVehicle({
      plate_number: '京P-DOUBLE-001',
      model: '测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '防重复扣减工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 5, '管理员');
    completeWorkOrder(order.id, '完成');

    confirmPreempt(order.id, part.id, '质检员');

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.stock_quantity).toBe(15);

    expect(() => {
      confirmPreempt(order.id, part.id, '质检员');
    }).toThrow(BusinessError);
  });
});

describe('Timeout Warning System', () => {
  test('should have default timeout configs', () => {
    const configs = listTimeoutConfigs();
    expect(configs.length).toBe(4);
    expect(configs.find(c => c.fault_level === 'minor')).toBeDefined();
    expect(configs.find(c => c.fault_level === 'medium')).toBeDefined();
    expect(configs.find(c => c.fault_level === 'major')).toBeDefined();
    expect(configs.find(c => c.fault_level === 'critical')).toBeDefined();
  });

  test('should update timeout config', () => {
    const updated = updateTimeoutConfig('minor', 10, 20);
    expect(updated.warning_hours).toBe(10);
    expect(updated.overdue_hours).toBe(20);
  });

  test('should calculate timeout status correctly', () => {
    const vehicle = createVehicle({
      plate_number: '京Q-TIMEOUT-001',
      model: '测试超时车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '超时测试工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);

    const info = getWorkOrderTimeoutInfo(order.id);
    expect(info).toBeDefined();
    expect(info!.timeout_status).toBe('normal');
    expect(info!.elapsed_hours).toBeGreaterThanOrEqual(0);
  });

  test('should get timeout work orders by status', () => {
    const normalOrders = getTimeoutWorkOrders('normal');
    expect(Array.isArray(normalOrders)).toBe(true);
  });
});

describe('Work Order Statistics', () => {
  test('should get statistics filtered by technician', () => {
    const tech = createTechnician({
      name: '统计测试师',
      employee_no: 'TECH-STAT-001',
    });

    const today = new Date().toISOString().split('T')[0];
    createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'morning',
    });

    const vehicle = createVehicle({
      plate_number: '京R-STAT-001',
      model: '统计测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '统计测试工单',
      fault_level: 'medium',
    });

    assignWorkOrder(order.id, tech.id);

    const stats = getWorkOrderStatistics({ technician_id: tech.id });
    expect(stats.length).toBeGreaterThan(0);
    expect(stats.every(s => s.assigned_to === tech.id)).toBe(true);
  });

  test('should get statistics filtered by vehicle', () => {
    const vehicle = createVehicle({
      plate_number: '京S-STAT-002',
      model: '统计测试车2',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '统计测试工单2',
      fault_level: 'minor',
    });

    const stats = getWorkOrderStatistics({ vehicle_id: vehicle.id });
    expect(stats.length).toBeGreaterThan(0);
    expect(stats.every(s => s.vehicle_id === vehicle.id)).toBe(true);
  });

  test('should get statistics with part filter', () => {
    const part = createSparePart({
      name: '统计备件',
      code: 'STAT-PART-001',
      unit: '个',
      stock_quantity: 100,
      unit_price: 10,
    });

    const vehicle = createVehicle({
      plate_number: '京T-STAT-003',
      model: '统计测试车3',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '备件统计工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    useSparePart(order.id, part.id, 2, '管理员');

    const stats = getWorkOrderStatistics({ part_id: part.id });
    expect(stats.length).toBeGreaterThan(0);
  });

  test('should get statistics filtered by status and fault level', () => {
    const stats = getWorkOrderStatistics({
      status: 'in_repair',
      fault_level: 'minor',
    });
    expect(Array.isArray(stats)).toBe(true);
    expect(stats.every(s => s.status === 'in_repair')).toBe(true);
    expect(stats.every(s => s.fault_level === 'minor')).toBe(true);
  });

  test('should include timeout status in statistics', () => {
    const stats = getWorkOrderStatistics({});
    expect(stats.length).toBeGreaterThan(0);
    expect(stats[0].timeout_status).toBeDefined();
    expect(['normal', 'warning', 'overdue']).toContain(stats[0].timeout_status);
  });
});

describe('Data Consistency After Restart', () => {
  test('should maintain technician schedules after restart', () => {
    const tech = createTechnician({
      name: '重启测试师',
      employee_no: 'TECH-RESTART-001',
    });

    const today = new Date().toISOString().split('T')[0];
    createSchedule({
      technician_id: tech.id,
      shift_date: today,
      shift_type: 'morning',
    });

    closeDatabase();
    initDatabase(dbPath);

    const techAfter = getTechnicianById(tech.id);
    expect(techAfter).toBeDefined();
    expect(techAfter!.status).toBe('active');

    const schedules = listSchedules(tech.id);
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules[0].shift_type).toBe('morning');
  });

  test('should maintain part preemptions after restart', () => {
    const part = createSparePart({
      name: '重启预占测试件',
      code: 'RESTART-PREEMPT-001',
      unit: '个',
      stock_quantity: 50,
      unit_price: 25,
    });

    const vehicle = createVehicle({
      plate_number: '京U-RESTART-001',
      model: '重启测试车',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '重启预占工单',
      fault_level: 'minor',
    });

    assignWorkOrder(order.id, testTechnicianId);
    preemptSparePart(order.id, part.id, 10, '管理员');

    closeDatabase();
    initDatabase(dbPath);

    const partAfter = getSparePartById(part.id);
    expect(partAfter!.stock_quantity).toBe(50);
    expect(partAfter!.preempt_quantity).toBe(10);
    expect(partAfter!.available_quantity).toBe(40);

    const preempts = getWorkOrderPreempts(order.id, 'preempted');
    expect(preempts.length).toBe(1);
    expect(preempts[0].quantity).toBe(10);
  });

  test('should maintain timeout configs and status after restart', () => {
    const vehicle = createVehicle({
      plate_number: '京V-RESTART-002',
      model: '重启超时测试',
      purchase_date: '2024-01-01',
    });

    const order = createWorkOrder({
      vehicle_id: vehicle.id,
      title: '重启超时工单',
      fault_level: 'medium',
    });

    assignWorkOrder(order.id, testTechnicianId);
    const infoBefore = getWorkOrderTimeoutInfo(order.id);

    closeDatabase();
    initDatabase(dbPath);

    const configs = listTimeoutConfigs();
    expect(configs.length).toBe(4);

    const infoAfter = getWorkOrderTimeoutInfo(order.id);
    expect(infoAfter).toBeDefined();
    expect(infoAfter!.overdue_hours).toBe(infoBefore!.overdue_hours);

    const orderAfter = getWorkOrderById(order.id);
    expect(orderAfter).toBeDefined();
    expect(orderAfter!.in_repair_at).toBeTruthy();
  });
});
