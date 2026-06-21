import { Router, Request, Response } from 'express';
import {
  createWorkOrder,
  getWorkOrderById,
  listWorkOrders,
  assignWorkOrder,
  recordDiagnosis,
  recordLaborHours,
  useSparePart,
  completeWorkOrder,
  acceptWorkOrder,
  rejectWorkOrder,
  cancelWorkOrder,
  getWorkOrderDetail,
  getRecommendedTechnicians,
  preemptSparePart,
  getTimeoutConfig,
  updateTimeoutConfig,
  listTimeoutConfigs,
  getWorkOrderTimeoutInfo,
  getTimeoutWorkOrders,
  getWorkOrderStatistics,
} from '../services/workOrderService';
import { BusinessError } from '../utils';

const router = Router();

function handleError(res: Response, err: unknown) {
  if (err instanceof BusinessError) {
    res.status(400).json({ code: err.code, message: err.message });
  } else {
    console.error(err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
}

router.post('/', (req: Request, res: Response) => {
  try {
    const order = createWorkOrder(req.body);
    res.status(201).json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { vehicleId, status } = req.query;
    const orders = listWorkOrders(
      vehicleId as string | undefined,
      status as any
    );
    res.json(orders);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/statistics', (req: Request, res: Response) => {
  try {
    const filter: any = {};
    if (req.query.technician_id) filter.technician_id = req.query.technician_id;
    if (req.query.vehicle_id) filter.vehicle_id = req.query.vehicle_id;
    if (req.query.part_id) filter.part_id = req.query.part_id;
    if (req.query.timeout_status) filter.timeout_status = req.query.timeout_status;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fault_level) filter.fault_level = req.query.fault_level;
    if (req.query.start_date) filter.start_date = req.query.start_date;
    if (req.query.end_date) filter.end_date = req.query.end_date;

    const stats = getWorkOrderStatistics(filter);
    res.json(stats);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/timeout', (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const orders = getTimeoutWorkOrders(status as any);
    res.json(orders);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/timeout-configs', (req: Request, res: Response) => {
  try {
    const configs = listTimeoutConfigs();
    res.json(configs);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/timeout-configs/:faultLevel', (req: Request, res: Response) => {
  try {
    const { warning_hours, overdue_hours } = req.body;
    const config = updateTimeoutConfig(
      req.params.faultLevel as any,
      Number(warning_hours),
      Number(overdue_hours)
    );
    res.json(config);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const order = getWorkOrderById(req.params.id);
    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: '工单不存在' });
      return;
    }
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/detail', (req: Request, res: Response) => {
  try {
    const detail = getWorkOrderDetail(req.params.id);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/recommended-technicians', (req: Request, res: Response) => {
  try {
    const techs = getRecommendedTechnicians(req.params.id);
    res.json(techs);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/timeout-info', (req: Request, res: Response) => {
  try {
    const info = getWorkOrderTimeoutInfo(req.params.id);
    if (!info) {
      res.status(404).json({ code: 'NOT_FOUND', message: '无超时信息' });
      return;
    }
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/assign', (req: Request, res: Response) => {
  try {
    const { assigned_to } = req.body;
    const order = assignWorkOrder(req.params.id, assigned_to);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/diagnosis', (req: Request, res: Response) => {
  try {
    const { diagnosis } = req.body;
    const order = recordDiagnosis(req.params.id, diagnosis);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/labor-hours', (req: Request, res: Response) => {
  try {
    const { labor_hours } = req.body;
    const order = recordLaborHours(req.params.id, Number(labor_hours));
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/parts', (req: Request, res: Response) => {
  try {
    const { part_id, quantity, operator } = req.body;
    const part = useSparePart(req.params.id, part_id, Number(quantity), operator);
    res.status(201).json(part);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/preempt-parts', (req: Request, res: Response) => {
  try {
    const { part_id, quantity, operator } = req.body;
    const preempt = preemptSparePart(req.params.id, part_id, Number(quantity), operator);
    res.status(201).json(preempt);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/complete', (req: Request, res: Response) => {
  try {
    const { completion_result } = req.body;
    const order = completeWorkOrder(req.params.id, completion_result);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/accept', (req: Request, res: Response) => {
  try {
    const { acceptance_result, accepted_by } = req.body;
    const order = acceptWorkOrder(req.params.id, acceptance_result, accepted_by);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/reject', (req: Request, res: Response) => {
  try {
    const { reject_reason, operator } = req.body;
    const order = rejectWorkOrder(req.params.id, reject_reason, operator);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const { cancel_reason, operator } = req.body;
    const order = cancelWorkOrder(req.params.id, cancel_reason, operator);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
