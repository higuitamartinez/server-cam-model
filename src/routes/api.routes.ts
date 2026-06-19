import { Router } from 'express';
import { onnxService, type Prediction } from '../services/onnx.service.js';

interface PredictBody {
  image?: string;
}

interface ScanBody {
  image?: string;
  prediction?: Prediction;
  metadata?: Record<string, unknown>;
}

export const apiRouter = Router();

apiRouter.post('/predict', async (req, res, next) => {
  try {
    const { image } = req.body as PredictBody;
    if (!image) {
      res.status(400).json({ ok: false, error: { message: 'El campo image es requerido.' } });
      return;
    }

    const predictions = await onnxService.predict(image);
    res.json({ ok: true, predictions });
  } catch (error) {
    next(error);
  }
});

apiRouter.post('/scan', async (req, res) => {
  const { image, prediction, metadata } = req.body as ScanBody;

  if (!image) {
    res.status(400).json({ ok: false, error: { message: 'El campo image es requerido.' } });
    return;
  }

  res.json({
    ok: true,
    image,
    result: {
      status: 'captured',
      prediction: prediction ?? null,
      metadata: metadata ?? {}
    },
    confidence: prediction?.score ?? null
  });
});
