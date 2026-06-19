# Document Scanner Server

Servidor Node.js para publicar un scanner de documentos embebible en `iframe` y consumible desde `webview` móvil.

## Arquitectura

- `GET /scanner` sirve la interfaz embebible.
- `POST /api/predict` recibe un frame base64, ejecuta el modelo ONNX y retorna predicciones.
- `POST /api/scan` devuelve un payload normalizado para el contenedor padre.
- `GET /health` valida que el servidor y el modelo estén disponibles.

La cámara, overlay, captura y `postMessage` viven en el `iframe`. La inferencia ONNX vive en el servidor.

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run start:prod
```

`npm run build` ahora compila TypeScript y copia `public/` y `models/` a `dist/` para que el runtime de producción no dependa de `src/`.

## Variables de entorno

### Desarrollo local

```env
HTTPS_ENABLED=true
HTTPS_KEY_PATH=certs/scanner-key.pem
HTTPS_CERT_PATH=certs/scanner-cert.pem
HOST=0.0.0.0
PUBLIC_HOST=192.168.1.30
PORT=3001
JSON_LIMIT=15mb
SCANNER_ALLOWED_FRAME_ANCESTORS=https://192.168.1.30:5173,https://localhost:3000,http://localhost:3000
SCANNER_ALLOWED_ORIGINS=https://192.168.1.30:5173,https://localhost:3000,http://localhost:3000
TRUST_PROXY=false
ONNX_MODEL_PATH=
```

### Producción en EC2

Usar `.env.production.example` como base:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
PUBLIC_HOST=scanner.tudominio.com
HTTPS_ENABLED=false
TRUST_PROXY=true
JSON_LIMIT=15mb
SCANNER_ALLOWED_FRAME_ANCESTORS=https://app.tudominio.com,https://checkout.tudominio.com
SCANNER_ALLOWED_ORIGINS=
```

Notas:

- `SCANNER_ALLOWED_FRAME_ANCESTORS` controla quién puede embeber `/scanner`.
- `SCANNER_ALLOWED_ORIGINS` solo aplica a llamadas cross-origin hacia `/api`.
- Con `nginx` al frente, Node debe correr con `HTTPS_ENABLED=false`.
- Si no defines `ONNX_MODEL_PATH`, el servidor usará `dist/models/model.onnx` en producción y `src/models/model.onnx` en desarrollo.

## Integración con iframe

```tsx
<iframe
  src="https://scanner.tudominio.com/scanner?parentOrigin=https%3A%2F%2Fapp.tudominio.com"
  title="Document Scanner"
  allow="camera; microphone"
  style={{ width: "100%", height: "100%", border: "none" }}
/>
```

Listener:

```tsx
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === "DOCUMENT_SCANNER_RESULT") {
      console.log(event.data.payload);
    }

    if (event.data?.type === "DOCUMENT_SCANNER_ERROR") {
      console.error(event.data.payload);
    }
  };

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}, []);
```

Eventos emitidos:

- `DOCUMENT_SCANNER_RESULT`
- `DOCUMENT_SCANNER_ERROR`
- `DOCUMENT_SCANNER_STATUS`
- `DOCUMENT_SCANNER_CLOSE`

## Despliegue en EC2 con nginx y pm2

### 1. Preparar la instancia

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Publicar la app

```bash
mkdir -p /var/www/document-scanner
cd /var/www/document-scanner
npm ci
npm run build
cp .env.production.example .env.production
```

La carpeta debe quedar con:

- `dist/`
- `ecosystem.config.cjs`
- `.env.production`
- `package.json`

### 3. Arrancar con pm2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

El archivo `ecosystem.config.cjs` asume Node en `127.0.0.1:3001` y TLS terminado por `nginx`.

### 4. Configurar nginx

Copiar `deploy/nginx/scanner.tudominio.com.conf` a `/etc/nginx/sites-available/scanner.tudominio.com`, habilitarlo y probar:

```bash
sudo ln -s /etc/nginx/sites-available/scanner.tudominio.com /etc/nginx/sites-enabled/scanner.tudominio.com
sudo nginx -t
sudo systemctl reload nginx
```

Luego emitir TLS:

```bash
sudo certbot --nginx -d scanner.tudominio.com
```

### 5. Seguridad de red en AWS

- Abrir solo `80` y `443` en el Security Group.
- No exponer `3001` públicamente.
- Apuntar el DNS del subdominio al EC2.

## Webview móvil

Para móvil usar siempre `https://scanner.tudominio.com/scanner`.

### Android

- Declarar permiso de cámara en la app nativa.
- Implementar `WebChromeClient.onPermissionRequest(...)`.
- Verificar que el `WebView` permita media capture y contenido mixto no sea necesario.

### iOS

- Declarar `NSCameraUsageDescription`.
- Usar `WKWebView` con configuración que permita captura de medios.
- Validar permisos del sistema antes de cargar el scanner.

No usar IP pública ni certificados autofirmados para `webview`.

## Endpoints

### `GET /health`

Retorna `200` si el modelo está cargado.

### `POST /api/predict`

```json
{
  "image": "data:image/jpeg;base64,..."
}
```

### `POST /api/scan`

```json
{
  "image": "data:image/png;base64,...",
  "prediction": {
    "box": [10, 20, 300, 180],
    "score": 0.95,
    "classId": 0,
    "className": "id-card"
  },
  "metadata": {
    "source": "iframe-scanner",
    "side": "front"
  }
}
```
