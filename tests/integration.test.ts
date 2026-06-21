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
  cancelWorkOrder,
  getWorkOrderById,
  getWorkOrderDetail,
} from '../src/services/workOrderService';
import {
  createSparePart,
  getSparePartById,
  inboundPart,
  getLowStockParts,
  listPartTransactions,
  getWorkOrderParts,
} from '../src/services/sparePartService';
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

    const assigned = assignWorkOrder(order.id, '张师傅');
    expect(assigned.status).toBe('in_repair');
    expect(assigned.assigned_to).toBe('张师傅');

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

    assignWorkOrder(order.id, '李师傅');

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

    assignWorkOrder(order.id, '王师傅');
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

    assignWorkOrder(order.id, '赵师傅');
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

    assignWorkOrder(order.id, '孙师傅');
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

    assignWorkOrder(order.id, '周师傅');

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

    assignWorkOrder(order.id, '吴师傅');
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

    assignWorkOrder(order.id, '郑师傅');
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

    assignWorkOrder(order.id, '冯师傅');

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

    assignWorkOrder(order.id, '陈师傅');
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

    assignWorkOrder(order.id, '维修师傅');
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

    assignWorkOrder(order.id, '测试师傅');
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

    assignWorkOrder(order.id, '测试员');
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

    assignWorkOrder(order.id, '维修工');
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

    assignWorkOrder(order.id, '首保专员');
    completeWorkOrder(order.id, '首保完成');
    acceptWorkOrder(order.id, '验收通过', '首保主管');

    const updated = getVehicleById(vehicle.id);
    expect(updated!.last_maintenance_date).toBeTruthy();
    expect(updated!.last_maintenance_mileage).toBe(8000);
  });
});
