import sharp from 'sharp';
const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/;
export function decodeBase64Image(image) {
    const match = image.match(DATA_URL_PATTERN);
    const contentType = match?.[1] ?? 'image/png';
    const base64 = image.replace(DATA_URL_PATTERN, '');
    if (!base64 || base64.length < 32) {
        throw new Error('La imagen base64 es invalida o esta vacia.');
    }
    return {
        buffer: Buffer.from(base64, 'base64'),
        contentType
    };
}
export async function prepareImageForModel(image, modelWidth, modelHeight) {
    const { buffer } = decodeBase64Image(image);
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error('No se pudo leer el tamano de la imagen.');
    }
    const raw = await sharp(buffer)
        .rotate()
        .resize(modelWidth, modelHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();
    const input = new Float32Array(modelWidth * modelHeight * 3);
    const planeSize = modelWidth * modelHeight;
    for (let i = 0; i < planeSize; i += 1) {
        input[i] = raw[i * 3] / 255;
        input[i + planeSize] = raw[i * 3 + 1] / 255;
        input[i + planeSize * 2] = raw[i * 3 + 2] / 255;
    }
    return {
        input,
        width: metadata.width,
        height: metadata.height
    };
}
