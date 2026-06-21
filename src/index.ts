import express from 'express';
import { initDatabase } from './database';
import vehiclesRouter from './routes/vehicles';
import maintenancePlansRouter from './routes/maintenancePlans';
import workOrdersRouter from './routes/workOrders';
import sparePartsRouter from './routes/spareParts';
import exportsRouter from './routes/exports';
import techniciansRouter from './routes/technicians';

initDatabase();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/maintenance-plans', maintenancePlansRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/spare-parts', sparePartsRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/technicians', techniciansRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Fleet Maintenance Service running on port ${PORT}`);
  });
}

export default app;
