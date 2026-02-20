import express from 'express';
import pdfRoutes from '@/routes/pdfRoutes.js';

const app = express();

app.use(express.json());
app.use('/api/pdfs', pdfRoutes);

export default app;
