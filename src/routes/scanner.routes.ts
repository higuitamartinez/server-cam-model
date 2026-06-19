import { Router } from 'express';
import path from 'node:path';
import { publicDir } from '../config/runtime-paths.js';

export const scannerRouter = Router();

scannerRouter.get('/scanner', (_req, res) => {
  res.sendFile(path.join(publicDir, 'scanner.html'));
});
