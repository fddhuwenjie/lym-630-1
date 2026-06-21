import { Router, Request, Response } from 'express';
import {
  exportWorkOrderDetails,
  getExportRecordById,
  listExportRecords,
  getExportFilePath,
} from '../services/exportService';
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

router.post('/work-orders', async (req: Request, res: Response) => {
  try {
    const { operator, ...params } = req.body;
    const record = await exportWorkOrderDetails(params, operator || 'system');
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { type } = req.query;
    const records = listExportRecords(type as string | undefined);
    res.json(records);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const record = getExportRecordById(req.params.id);
    if (!record) {
      res.status(404).json({ code: 'NOT_FOUND', message: '导出记录不存在' });
      return;
    }
    res.json(record);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/download', (req: Request, res: Response) => {
  try {
    const filePath = getExportFilePath(req.params.id);
    const record = getExportRecordById(req.params.id)!;
    res.download(filePath, record.file_name);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
