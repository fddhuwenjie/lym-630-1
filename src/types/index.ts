export type VehicleStatus = 'running' | 'idle' | 'in_repair' | 'scrapped';

export type FaultLevel = 'minor' | 'medium' | 'major' | 'critical';

export type WorkOrderStatus = 'pending_assign' | 'in_repair' | 'pending_acceptance' | 'completed' | 'cancelled' | 'rejected';

export type MaintenanceType = 'routine' | 'mileage_based' | 'time_based' | 'fault_based';

export type PartTransactionType = 'inbound' | 'outbound' | 'return' | 'preempt' | 'preempt_release' | 'preempt_confirm';

export type TechnicianStatus = 'active' | 'inactive';

export type ShiftType = 'morning' | 'afternoon' | 'night' | 'day_off';

export type PreemptStatus = 'preempted' | 'released' | 'confirmed';

export type TimeoutStatus = 'normal' | 'warning' | 'overdue';

export interface Vehicle {
  id: string;
  plate_number: string;
  model: string;
  status: VehicleStatus;
  current_mileage: number;
  last_maintenance_date: string | null;
  last_maintenance_mileage: number | null;
  purchase_date: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleHealthRecord {
  id: string;
  vehicle_id: string;
  mileage: number;
  health_score: number;
  last_fault_level: FaultLevel | null;
  total_repair_count: number;
  total_maintenance_count: number;
  updated_at: string;
}

export interface MaintenancePlan {
  id: string;
  vehicle_id: string;
  type: MaintenanceType;
  name: string;
  description: string;
  due_mileage: number | null;
  due_date: string | null;
  fault_level: FaultLevel | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  completed_at: string | null;
}

export interface WorkOrder {
  id: string;
  vehicle_id: string;
  maintenance_plan_id: string | null;
  title: string;
  fault_level: FaultLevel;
  description: string;
  status: WorkOrderStatus;
  assigned_to: string | null;
  diagnosis: string | null;
  labor_hours: number;
  completion_result: string | null;
  acceptance_result: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  in_repair_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
}

export interface SparePart {
  id: string;
  name: string;
  code: string;
  specification: string;
  unit: string;
  stock_quantity: number;
  preempt_quantity: number;
  available_quantity: number;
  warning_threshold: number;
  unit_price: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderPart {
  id: string;
  work_order_id: string;
  part_id: string;
  part_name: string;
  quantity: number;
  unit_price: number;
  returned: boolean;
  created_at: string;
}

export interface PartTransaction {
  id: string;
  part_id: string;
  work_order_id: string | null;
  type: PartTransactionType;
  quantity: number;
  before_balance: number;
  after_balance: number;
  operator: string;
  remark: string;
  created_at: string;
}

export interface MileageRecord {
  id: string;
  vehicle_id: string;
  mileage: number;
  recorded_at: string;
  operator: string;
}

export interface ExportRecord {
  id: string;
  type: string;
  file_name: string;
  file_path: string;
  parameters: string;
  operator: string;
  created_at: string;
}

export interface Technician {
  id: string;
  name: string;
  employee_no: string;
  phone: string;
  status: TechnicianStatus;
  skill_tags: string;
  created_at: string;
  updated_at: string;
}

export interface TechnicianSchedule {
  id: string;
  technician_id: string;
  shift_date: string;
  shift_type: ShiftType;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartPreempt {
  id: string;
  work_order_id: string;
  part_id: string;
  part_name: string;
  quantity: number;
  unit_price: number;
  status: PreemptStatus;
  preempted_at: string;
  released_at: string | null;
  confirmed_at: string | null;
  released_by: string | null;
  confirmed_by: string | null;
  release_reason: string | null;
}

export interface TimeoutConfig {
  id: string;
  fault_level: FaultLevel;
  warning_hours: number;
  overdue_hours: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderTimeoutInfo {
  work_order_id: string;
  timeout_status: TimeoutStatus;
  remaining_hours: number;
  elapsed_hours: number;
  warning_hours: number;
  overdue_hours: number;
}

export interface WorkOrderStatisticsFilter {
  technician_id?: string;
  vehicle_id?: string;
  part_id?: string;
  timeout_status?: TimeoutStatus;
  status?: WorkOrderStatus;
  fault_level?: FaultLevel;
  start_date?: string;
  end_date?: string;
}

export interface WorkOrderStatisticsItem {
  id: string;
  title: string;
  fault_level: FaultLevel;
  status: WorkOrderStatus;
  vehicle_id: string;
  plate_number: string;
  assigned_to: string | null;
  technician_name: string | null;
  created_at: string;
  in_repair_at: string | null;
  completed_at: string | null;
  timeout_status: TimeoutStatus;
  parts_count: number;
  total_cost: number;
}
