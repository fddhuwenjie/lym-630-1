import { Router, Request, Response } from 'express';
import {
  createTechnician,
  getTechnicianById,
  listTechnicians,
  updateTechnician,
  createSchedule,
  getScheduleById,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  recommendTechnicians,
  isTechnicianAvailable,
  batchCreateSchedules,
  getTechnicianScheduleByDate,
} from '../services/technicianService';
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
    const tech = createTechnician(req.body);
    res.status(201).json(tech);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { status, keyword } = req.query;
    const techs = listTechnicians(
      status as any,
      keyword as string | undefined
    );
    res.json(techs);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/recommend', (req: Request, res: Response) => {
  try {
    const { fault_level, skill_keyword, date_time } = req.query;
    if (!fault_level) {
      res.status(400).json({ code: 'MISSING_FIELDS', message: '缺少故障等级参数' });
      return;
    }
    const techs = recommendTechnicians(
      fault_level as any,
      skill_keyword as string | undefined,
      date_time as string | undefined
    );
    res.json(techs);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const tech = getTechnicianById(req.params.id);
    if (!tech) {
      res.status(404).json({ code: 'NOT_FOUND', message: '技师不存在' });
      return;
    }
    res.json(tech);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const tech = updateTechnician(req.params.id, req.body);
    res.json(tech);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/availability', (req: Request, res: Response) => {
  try {
    const { date_time } = req.query;
    const checkTime = (date_time as string) || new Date().toISOString();
    const available = isTechnicianAvailable(req.params.id, checkTime);
    res.json({ technician_id: req.params.id, available, check_time: checkTime });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/schedules', (req: Request, res: Response) => {
  try {
    const schedule = createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/schedules/batch', (req: Request, res: Response) => {
  try {
    const schedules = batchCreateSchedules(req.body);
    res.status(201).json({ count: schedules.length, schedules });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/schedules/list', (req: Request, res: Response) => {
  try {
    const { technician_id, start_date, end_date } = req.query;
    const schedules = listSchedules(
      technician_id as string | undefined,
      start_date as string | undefined,
      end_date as string | undefined
    );
    res.json(schedules);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/schedules/:id', (req: Request, res: Response) => {
  try {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      res.status(404).json({ code: 'NOT_FOUND', message: '排班记录不存在' });
      return;
    }
    res.json(schedule);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/schedules/:id', (req: Request, res: Response) => {
  try {
    const schedule = updateSchedule(req.params.id, req.body);
    res.json(schedule);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/schedules/:id', (req: Request, res: Response) => {
  try {
    deleteSchedule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:technicianId/schedules/:date', (req: Request, res: Response) => {
  try {
    const schedule = getTechnicianScheduleByDate(req.params.technicianId, req.params.date);
    if (!schedule) {
      res.status(404).json({ code: 'NOT_FOUND', message: '当日无排班记录' });
      return;
    }
    res.json(schedule);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
