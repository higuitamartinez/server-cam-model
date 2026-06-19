import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { resolveDefaultModelPath } from '../config/runtime-paths.js';
import { prepareImageForModel } from './image.service.js';
const MODEL_WIDTH = 320;
const MODEL_HEIGHT = 320;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
const IOU_THRESHOLD = 0.45;
const LABELS = ['id-card'];
export class OnnxService {
    session = null;
    loadingPromise = null;
    modelPath;
    constructor(modelPath = process.env.ONNX_MODEL_PATH) {
        this.modelPath = modelPath
            ? path.resolve(modelPath)
            : resolveDefaultModelPath();
    }
    async load() {
        if (this.session)
            return this.session;
        if (this.loadingPromise)
            return this.loadingPromise;
        this.loadingPromise = ort.InferenceSession.create(this.modelPath, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
            executionMode: 'sequential'
        }).then((session) => {
            this.session = session;
            return session;
        }).finally(() => {
            this.loadingPromise = null;
        });
        return this.loadingPromise;
    }
    async isReady() {
        try {
            await this.load();
            return true;
        }
        catch {
            return false;
        }
    }
    getModelPath() {
        return this.modelPath;
    }
    async predict(image) {
        const session = await this.load();
        const prepared = await prepareImageForModel(image, MODEL_WIDTH, MODEL_HEIGHT);
        const tensor = new ort.Tensor('float32', prepared.input, [1, 3, MODEL_WIDTH, MODEL_HEIGHT]);
        const inputName = session.inputNames.includes('images') ? 'images' : session.inputNames[0];
        const outputs = await session.run({ [inputName]: tensor });
        const output = outputs[session.outputNames[0]];
        const maskProto = session.outputNames.length > 1 ? outputs[session.outputNames[1]] : undefined;
        return this.postprocess(output, prepared.width, prepared.height, MODEL_WIDTH, MODEL_HEIGHT, DEFAULT_CONFIDENCE_THRESHOLD, maskProto);
    }
    postprocess(output, imageWidth, imageHeight, modelWidth, modelHeight, confidenceThreshold, maskProto) {
        const predictions = [];
        const data = output.data;
        const rows = output.dims[2];
        const cols = output.dims[1];
        const numMaskCoeffs = maskProto ? maskProto.dims[1] : 0;
        const numClasses = cols - 4 - numMaskCoeffs;
        for (let i = 0; i < rows; i += 1) {
            let maxScore = -1;
            let classId = -1;
            for (let c = 0; c < numClasses; c += 1) {
                const score = data[(4 + c) * rows + i];
                if (score > maxScore) {
                    maxScore = score;
                    classId = c;
                }
            }
            if (maxScore > confidenceThreshold) {
                const xCenter = data[i];
                const yCenter = data[rows + i];
                const width = data[rows * 2 + i];
                const height = data[rows * 3 + i];
                const x = (xCenter - width / 2) * (imageWidth / modelWidth);
                const y = (yCenter - height / 2) * (imageHeight / modelHeight);
                const w = width * (imageWidth / modelWidth);
                const h = height * (imageHeight / modelHeight);
                predictions.push({
                    box: [
                        clamp(x, 0, imageWidth),
                        clamp(y, 0, imageHeight),
                        clamp(w, 0, imageWidth),
                        clamp(h, 0, imageHeight)
                    ],
                    score: maxScore,
                    classId,
                    className: LABELS[classId] ?? `class ${classId}`
                });
            }
        }
        return nms(predictions, IOU_THRESHOLD);
    }
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function nms(predictions, iouThreshold) {
    const sorted = [...predictions].sort((a, b) => b.score - a.score);
    const result = [];
    const selected = new Array(sorted.length).fill(true);
    for (let i = 0; i < sorted.length; i += 1) {
        if (!selected[i])
            continue;
        result.push(sorted[i]);
        for (let j = i + 1; j < sorted.length; j += 1) {
            if (!selected[j])
                continue;
            if (iou(sorted[i].box, sorted[j].box) > iouThreshold) {
                selected[j] = false;
            }
        }
    }
    return result;
}
function iou(boxA, boxB) {
    const xA = Math.max(boxA[0], boxB[0]);
    const yA = Math.max(boxA[1], boxB[1]);
    const xB = Math.min(boxA[0] + boxA[2], boxB[0] + boxB[2]);
    const yB = Math.min(boxA[1] + boxA[3], boxB[1] + boxB[3]);
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA[2] * boxA[3];
    const boxBArea = boxB[2] * boxB[3];
    return interArea / (boxAArea + boxBArea - interArea);
}
export const onnxService = new OnnxService();
