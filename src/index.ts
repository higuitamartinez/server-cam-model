import './config/load-env.js';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import cors, { type CorsOptionsDelegate, type CorsRequest } from 'cors';
import express from 'express';
import helmet from 'helmet';
import { projectRoot, publicDir } from './config/runtime-paths.js';
import { apiRouter } from './routes/api.routes.js';
import { scannerRouter } from './routes/scanner.routes.js';
import { onnxService } from './services/onnx.service.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const publicHost = process.env.PUBLIC_HOST ?? host;
const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
const trustProxy = process.env.TRUST_PROXY === 'true';
const allowedCorsOrigins = parseOrigins(process.env.SCANNER_ALLOWED_ORIGINS);
const allowedFrameAncestors = Array.from(new Set(["'self'", ...parseOrigins(process.env.SCANNER_ALLOWED_FRAME_ANCESTORS)]));
const httpsKeyPath = resolvePathFromRoot(process.env.HTTPS_KEY_PATH ?? path.join('certs', 'scanner-key.pem'));
const httpsCertPath = resolvePathFromRoot(process.env.HTTPS_CERT_PATH ?? path.join('certs', 'scanner-cert.pem'));

app.set('trust proxy', trustProxy);

const corsOptionsDelegate: CorsOptionsDelegate = (req, callback) => {
  const origin = typeof req.headers.origin === 'string'
    ? req.headers.origin
    : req.headers.origin?.[0];

  if (!origin || isSameOriginRequest(req, origin) || allowedCorsOrigins.includes(origin)) {
    callback(null, { origin: true });
    return;
  }

  callback(new Error(`Origen no permitido por CORS: ${origin}`));
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://docs.opencv.org'],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", 'blob:'],
      frameAncestors: allowedFrameAncestors
    }
  },
  frameguard: false,
  crossOriginEmbedderPolicy: false
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  next();
});
app.use(express.json({ limit: process.env.JSON_LIMIT ?? '15mb' }));
app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

app.get('/health', async (_req, res) => {
  const modelReady = await onnxService.isReady();

  res.status(modelReady ? 200 : 503).json({
    ok: modelReady,
    status: modelReady ? 'ready' : 'error',
    model: {
      loaded: modelReady,
      path: onnxService.getModelPath()
    }
  });
});

app.use(scannerRouter);
app.use('/api', cors(corsOptionsDelegate), apiRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: { message: `Ruta no encontrada: ${req.method} ${req.path}` } });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Error inesperado.';
  console.error(error);
  res.status(500).json({ ok: false, error: { message } });
});

const server = createServer();
const protocol = server instanceof https.Server ? 'https' : 'http';

server.listen(port, host, () => {
  console.log(`Document scanner server listo en ${protocol}://${publicHost}:${port}/scanner`);
  console.log(`Escuchando en ${host}:${port}`);
});

function createServer(): http.Server | https.Server {
  if (!httpsEnabled) {
    return http.createServer(app);
  }

  try {
    return https.createServer({
      key: fs.readFileSync(httpsKeyPath),
      cert: fs.readFileSync(httpsCertPath)
    }, app);
  } catch (error) {
    console.warn('HTTPS_ENABLED=true pero no se pudo leer el certificado. Usando HTTP temporalmente.');
    console.warn(`Key: ${httpsKeyPath}`);
    console.warn(`Cert: ${httpsCertPath}`);
    console.warn(error);
    return http.createServer(app);
  }
}

function parseOrigins(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isSameOriginRequest(req: CorsRequest, origin: string): boolean {
  const requestHost = req.headers.host;
  if (!requestHost) return false;

  try {
    const requestOrigin = new URL(origin);
    const forwardedProtocol = req.headers['x-forwarded-proto'];
    const expectedProtocol = Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol;

    if (expectedProtocol) {
      return requestOrigin.host === requestHost && requestOrigin.protocol === `${expectedProtocol}:`;
    }

    return requestOrigin.host === requestHost;
  } catch {
    return false;
  }
}

function resolvePathFromRoot(targetPath: string): string {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(projectRoot, targetPath);
}
