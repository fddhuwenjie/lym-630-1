import { Router, Request, Response } from 'express';
import {
  createVehicle,
  getVehicleById,
  getVehicleByPlateNumber,
  listVehicles,
  updateVehicle,
  recordMileage,
  getVehicleHealthRecord,
  listAllHealthRecords,
  getMileageHistory,
} from '../services/vehicleService';
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
    const vehicle = createVehicle(req.body);
    res.status(201).json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const vehicles = listVehicles(status as string | undefined);
    res.json(vehicles);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const vehicle = getVehicleById(req.params.id);
    if (!vehicle) {
      res.status(404).json({ code: 'NOT_FOUND', message: '车辆不存在' });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/plate/:plateNumber', (req: Request, res: Response) => {
  try {
    const vehicle = getVehicleByPlateNumber(req.params.plateNumber);
    if (!vehicle) {
      res.status(404).json({ code: 'NOT_FOUND', message: '车辆不存在' });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const vehicle = updateVehicle(req.params.id, req.body);
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/mileage', (req: Request, res: Response) => {
  try {
    const { mileage, operator } = req.body;
    const record = recordMileage(req.params.id, Number(mileage), operator);
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/mileage-history', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const records = getMileageHistory(req.params.id, limit);
    res.json(records);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/health/all', (req: Request, res: Response) => {
  try {
    const records = listAllHealthRecords();
    res.json(records);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/health', (req: Request, res: Response) => {
  try {
    const record = getVehicleHealthRecord(req.params.id);
    if (!record) {
      res.status(404).json({ code: 'NOT_FOUND', message: '健康档案不存在' });
      return;
    }
    res.json(record);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
