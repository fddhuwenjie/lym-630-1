import { Router, Request, Response } from 'express';
import {
  listMaintenancePlans,
  getMaintenancePlanById,
  completeMaintenancePlan,
  cancelMaintenancePlan,
  checkAndGenerateMaintenancePlans,
  getDueMaintenancePlans,
} from '../services/maintenancePlanService';
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

router.get('/', (req: Request, res: Response) => {
  try {
    const { vehicleId, status } = req.query;
    const plans = listMaintenancePlans(
      vehicleId as string | undefined,
      status as string | undefined
    );
    res.json(plans);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/due', (req: Request, res: Response) => {
  try {
    const plans = getDueMaintenancePlans();
    res.json(plans);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const plan = getMaintenancePlanById(req.params.id);
    if (!plan) {
      res.status(404).json({ code: 'NOT_FOUND', message: '保养计划不存在' });
      return;
    }
    res.json(plan);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/complete', (req: Request, res: Response) => {
  try {
    const plan = completeMaintenancePlan(req.params.id);
    res.json(plan);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const plan = cancelMaintenancePlan(req.params.id);
    res.json(plan);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/vehicle/:vehicleId/generate', (req: Request, res: Response) => {
  try {
    const plans = checkAndGenerateMaintenancePlans(req.params.vehicleId);
    res.json({ generated: plans.length, plans });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
