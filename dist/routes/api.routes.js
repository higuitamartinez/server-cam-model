import { Router } from 'express';
import { onnxService } from '../services/onnx.service.js';
export const apiRouter = Router();
apiRouter.post('/predict', async (req, res, next) => {
    try {
        const { image } = req.body;
        if (!image) {
            res.status(400).json({ ok: false, error: { message: 'El campo image es requerido.' } });
            return;
        }
        const predictions = await onnxService.predict(image);
        res.json({ ok: true, predictions });
    }
    catch (error) {
        next(error);
    }
});
apiRouter.post('/scan', async (req, res) => {
    const { image, prediction, metadata } = req.body;
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
