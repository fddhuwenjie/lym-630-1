import { Router, Request, Response } from 'express';
import {
  createSparePart,
  getSparePartById,
  getSparePartByCode,
  listSpareParts,
  updateSparePart,
  inboundPart,
  listPartTransactions,
  getLowStockParts,
} from '../services/sparePartService';
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
    const part = createSparePart(req.body);
    res.status(201).json(part);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { keyword } = req.query;
    const parts = listSpareParts(keyword as string | undefined);
    res.json(parts);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/low-stock', (req: Request, res: Response) => {
  try {
    const parts = getLowStockParts();
    res.json(parts);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const part = getSparePartById(req.params.id);
    if (!part) {
      res.status(404).json({ code: 'NOT_FOUND', message: '备件不存在' });
      return;
    }
    res.json(part);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/code/:code', (req: Request, res: Response) => {
  try {
    const part = getSparePartByCode(req.params.code);
    if (!part) {
      res.status(404).json({ code: 'NOT_FOUND', message: '备件不存在' });
      return;
    }
    res.json(part);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const part = updateSparePart(req.params.id, req.body);
    res.json(part);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/inbound', (req: Request, res: Response) => {
  try {
    const { quantity, operator, remark } = req.body;
    const transaction = inboundPart(req.params.id, Number(quantity), operator, remark);
    res.status(201).json(transaction);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/transactions', (req: Request, res: Response) => {
  try {
    const transactions = listPartTransactions(req.params.id);
    res.json(transactions);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/transactions/all', (req: Request, res: Response) => {
  try {
    const { type, work_order_id } = req.query;
    const transactions = listPartTransactions(
      undefined,
      work_order_id as string | undefined,
      type as any
    );
    res.json(transactions);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
