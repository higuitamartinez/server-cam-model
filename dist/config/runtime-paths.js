import path from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(moduleDir, '..');
export const projectRoot = path.resolve(runtimeRoot, '..');
export function resolveProjectPath(...segments) {
    return path.resolve(projectRoot, ...segments);
}
export const publicDir = path.resolve(runtimeRoot, 'public');
export function resolveDefaultModelPath() {
    return path.resolve(runtimeRoot, 'models', 'model.onnx');
}
