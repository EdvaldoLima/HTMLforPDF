import { enqueuePdf, generatePdf } from '@/controllers/pdfController.js';
import { Router } from 'express';

const router = Router();

router.post('/', generatePdf);
router.post('/jobs', enqueuePdf);


export default router;
