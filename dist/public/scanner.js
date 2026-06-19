(() => {
  const CONFIDENCE_THRESHOLD = 0.9;
  const STABILITY_DURATION = 4000;
  const DETECTION_INTERVAL = 100;
  const FRAME_MIME_TYPE = 'image/jpeg';
  const FRAME_QUALITY = 0.82;

  const views = Array.from(document.querySelectorAll('[data-view]'));
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('captureCanvas');
  const guideOverlay = document.getElementById('guideOverlay');
  const debugOverlay = document.getElementById('debugOverlay');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const capturedImage = document.getElementById('capturedImage');
  const processingImage = document.getElementById('processingImage');
  const errorMessage = document.getElementById('errorMessage');
  const closeButton = document.getElementById('closeButton');
  const retakeButton = document.getElementById('retakeButton');
  const confirmButton = document.getElementById('confirmButton');
  const retryCameraButton = document.getElementById('retryCameraButton');

  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === 'true';
  const side = params.get('side') || 'front';
  document.body.dataset.debug = String(debug);

  let stream = null;
  let detectionTimer = null;
  let predictionInFlight = false;
  let isProcessing = false;
  let detectionStartTime = null;
  let bestPrediction = null;
  let latestPredictions = [];
  let capturedDataUrl = null;

  function getParentOrigin() {
    const configuredOrigin = params.get('parentOrigin');
    if (configuredOrigin) return configuredOrigin;

    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return '*';
      }
    }

    return '*';
  }

  function postToParent(type, payload) {
    window.parent?.postMessage({ type, payload }, getParentOrigin());
  }

  function setStatus(status) {
    postToParent('DOCUMENT_SCANNER_STATUS', { status });
  }

  function showView(name) {
    views.forEach((view) => {
      view.hidden = view.dataset.view !== name;
    });
    document.querySelector('.scanner-shell')?.setAttribute('data-screen', name);
  }

  function showError(message) {
    stopDetection();
    errorMessage.textContent = message;
    showView('error');
    setStatus('error');
    postToParent('DOCUMENT_SCANNER_ERROR', { message });
  }

  async function startCamera() {
    showView('loading');
    setStatus('loading');
    resetDetectionState();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El navegador no soporta acceso a camara.');
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 3840, min: 1280 },
          height: { ideal: 2160, min: 720 },
          facingMode: { ideal: 'environment' },
          aspectRatio: 16 / 9
        },
        audio: false
      });

      video.srcObject = stream;
      await video.play();
      showView('camera');
      setStatus('ready');
      drawGuideOverlay(false);
      startDetection();
    } catch (error) {
      showError(getCameraErrorMessage(error));
    }
  }

  function getCameraErrorMessage(error) {
    if (error?.name === 'NotAllowedError') return 'No se pudo acceder a la camara. Revisa los permisos del navegador.';
    if (error?.name === 'NotFoundError') return 'No se encontro una camara disponible.';
    if (error instanceof Error) return error.message;
    return 'No se pudo acceder a la camara.';
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function hasActiveStream() {
    return Boolean(stream?.getTracks().some((track) => track.readyState === 'live'));
  }

  function startDetection() {
    stopDetection();
    detectionTimer = window.setInterval(runDetection, DETECTION_INTERVAL);
  }

  function stopDetection() {
    if (detectionTimer) {
      window.clearInterval(detectionTimer);
      detectionTimer = null;
    }
  }

  async function runDetection() {
    if (predictionInFlight || isProcessing || video.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) return;
    if (!video.videoWidth || !video.videoHeight) return;

    predictionInFlight = true;

    try {
      const frame = getVideoFrameDataUrl();
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame })
      });

      if (!response.ok) {
        throw new Error('No se pudo ejecutar la deteccion del documento.');
      }

      const data = await response.json();
      latestPredictions = Array.isArray(data.predictions) ? data.predictions : [];
      drawGuideOverlay(latestPredictions.length > 0);
      drawDebugOverlay(latestPredictions);
      evaluatePredictions(latestPredictions);
    } catch (error) {
      console.error(error);
      resetDetectionState();
    } finally {
      predictionInFlight = false;
    }
  }

  function getVideoFrameDataUrl(type = FRAME_MIME_TYPE, quality = FRAME_QUALITY) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, quality);
  }

  function evaluatePredictions(predictions) {
    if (!predictions.length) {
      resetDetectionState();
      return;
    }

    const best = predictions[0];
    if (best.score < CONFIDENCE_THRESHOLD) {
      resetDetectionState();
      return;
    }

    bestPrediction = best;
    if (detectionStartTime === null) detectionStartTime = Date.now();

    const elapsed = Date.now() - detectionStartTime;
    const progress = Math.min((elapsed / STABILITY_DURATION) * 100, 100);
    progressContainer.hidden = false;
    progressBar.style.width = `${progress}%`;

    if (elapsed >= STABILITY_DURATION) {
      capturePhoto(best);
    }
  }

  function resetDetectionState() {
    detectionStartTime = null;
    bestPrediction = null;
    latestPredictions = [];
    progressContainer.hidden = true;
    progressBar.style.width = '0%';
    drawGuideOverlay(false);
    drawDebugOverlay([]);
  }

  function drawGuideOverlay(isDetecting) {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const rect = getGuideRect(width, height);
    const stroke = isDetecting
      ? `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="20" fill="none" stroke="var(--green-second)" stroke-width="8" filter="drop-shadow(0 0 10px var(--green-second))"></rect>`
      : '';

    guideOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    guideOverlay.innerHTML = `
      <defs>
        <mask id="captureMask">
          <rect width="100%" height="100%" fill="white"></rect>
          <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="20" fill="black"></rect>
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.8)" mask="url(#captureMask)"></rect>
      ${stroke}
    `;
  }

  function getGuideRect(videoWidth, videoHeight) {
    const isMobile = videoWidth < videoHeight || window.innerWidth < 768;

    if (isMobile) {
      const rectWidth = videoWidth * 0.85;
      const rectHeight = rectWidth / 1.6;
      return {
        x: (videoWidth - rectWidth) / 2,
        y: (videoHeight - rectHeight) / 2,
        width: rectWidth,
        height: rectHeight
      };
    }

    return {
      x: videoWidth * 0.25,
      y: videoHeight * 0.25,
      width: videoWidth * 0.5,
      height: videoHeight * 0.5
    };
  }

  function drawDebugOverlay(predictions) {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    debugOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);

    debugOverlay.innerHTML = predictions.map((prediction) => {
      const [x, y, w, h] = prediction.box;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(97, 166, 14, 0.2)" stroke="var(--green-second)" stroke-width="12"></rect>
          <text x="${x}" y="${y > 50 ? y - 20 : y + 45}" fill="var(--green-second)" font-size="40" font-weight="bold">
            ${prediction.className} (${(prediction.score * 100).toFixed(1)}%)
          </text>
        </g>
      `;
    }).join('');
  }

  function capturePhoto(prediction) {
    if (isProcessing) return;
    isProcessing = true;
    stopDetection();
    setStatus('scanning');

    try {
      const points = getPredictionPoints(prediction);
      capturedDataUrl = cropAndAlign(video, points) || getVideoFrameDataUrl('image/png', 1);
      capturedImage.src = capturedDataUrl;
      processingImage.src = capturedDataUrl;
      showView('captured');
      setStatus('completed');
    } catch (error) {
      isProcessing = false;
      showError(error instanceof Error ? error.message : 'Error en la captura del documento.');
    }
  }

  function getPredictionPoints(prediction) {
    if (prediction?.polygon?.length >= 3) return prediction.polygon;
    if (prediction?.keypoints?.length >= 4) return prediction.keypoints;

    const [x, y, w, h] = prediction.box;
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ];
  }

  function cropAndAlign(imageSource, points) {
    if (!points?.length) return null;
    const cv = window.cv;

    if (!cv?.Mat) {
      return cropWithCanvas(imageSource, points);
    }

    let src = null;
    let dst = null;

    try {
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = imageSource.videoWidth;
      sourceCanvas.height = imageSource.videoHeight;
      sourceCanvas.getContext('2d', { willReadFrequently: true }).drawImage(imageSource, 0, 0, sourceCanvas.width, sourceCanvas.height);

      src = cv.imread(sourceCanvas);
      dst = new cv.Mat();

      if (points.length === 4) {
        const ordered = orderPoints(points);
        const maxWidth = Math.max(distance(ordered.br, ordered.bl), distance(ordered.tr, ordered.tl));
        const maxHeight = Math.max(distance(ordered.tr, ordered.br), distance(ordered.tl, ordered.bl));
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          ordered.tl.x, ordered.tl.y,
          ordered.tr.x, ordered.tr.y,
          ordered.br.x, ordered.br.y,
          ordered.bl.x, ordered.bl.y
        ]);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight]);
        const matrix = cv.getPerspectiveTransform(srcTri, dstTri);

        cv.warpPerspective(src, dst, matrix, new cv.Size(maxWidth, maxHeight), cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar());
        srcTri.delete();
        dstTri.delete();
        matrix.delete();
      } else {
        const rect = boundingRect(points, src.cols, src.rows);
        if (rect.width <= 0 || rect.height <= 0) return null;
        const roi = src.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
        roi.copyTo(dst);
        roi.delete();
      }

      const outputCanvas = document.createElement('canvas');
      cv.imshow(outputCanvas, dst);
      return outputCanvas.toDataURL('image/png');
    } catch (error) {
      console.error('OpenCV crop/align error:', error);
      return cropWithCanvas(imageSource, points);
    } finally {
      src?.delete();
      dst?.delete();
    }
  }

  function cropWithCanvas(imageSource, points) {
    const rect = boundingRect(points, imageSource.videoWidth, imageSource.videoHeight);
    if (rect.width <= 0 || rect.height <= 0) return null;

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = rect.width;
    outputCanvas.height = rect.height;
    outputCanvas.getContext('2d').drawImage(
      imageSource,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height
    );

    return outputCanvas.toDataURL('image/png');
  }

  function orderPoints(points) {
    const mapped = points.map((point) => ({ x: point.x, y: point.y }));
    const sums = mapped.map((point) => point.x + point.y);
    const diffs = mapped.map((point) => point.y - point.x);

    return {
      tl: mapped[sums.indexOf(Math.min(...sums))],
      br: mapped[sums.indexOf(Math.max(...sums))],
      tr: mapped[diffs.indexOf(Math.min(...diffs))],
      bl: mapped[diffs.indexOf(Math.max(...diffs))]
    };
  }

  function boundingRect(points, maxWidth, maxHeight) {
    const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
    const maxX = Math.min(maxWidth, Math.ceil(Math.max(...points.map((point) => point.x))));
    const maxY = Math.min(maxHeight, Math.ceil(Math.max(...points.map((point) => point.y))));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  async function confirmCapture() {
    if (!capturedDataUrl) return;

    showView('processing');
    setStatus('scanning');

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: capturedDataUrl,
          prediction: bestPrediction,
          metadata: { source: 'iframe-scanner', side }
        })
      });

      if (!response.ok) {
        throw new Error('No se pudo procesar la captura.');
      }

      const data = await response.json();
      setStatus('completed');
      postToParent('DOCUMENT_SCANNER_RESULT', {
        image: data.image,
        result: data.result,
        confidence: data.confidence
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'No se pudo procesar la captura.');
    }
  }

  function restartCapture() {
    capturedDataUrl = null;
    isProcessing = false;
    capturedImage.removeAttribute('src');
    processingImage.removeAttribute('src');
    resetDetectionState();

    if (!hasActiveStream()) {
      startCamera();
      return;
    }

    showView('camera');
    setStatus('ready');
    startDetection();
  }

  function handleParentMessage(event) {
    if (event.source !== window.parent) return;

    const parentOrigin = getParentOrigin();
    if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    if (event.data?.type !== 'DOCUMENT_SCANNER_RESTART') return;

    restartCapture();
  }

  closeButton.addEventListener('click', () => {
    postToParent('DOCUMENT_SCANNER_CLOSE', { reason: 'user' });
  });
  retakeButton.addEventListener('click', restartCapture);
  confirmButton.addEventListener('click', confirmCapture);
  retryCameraButton.addEventListener('click', startCamera);
  window.addEventListener('message', handleParentMessage);
  window.addEventListener('resize', () => drawGuideOverlay(latestPredictions.length > 0));
  window.addEventListener('beforeunload', stopCamera);

  startCamera();
})();
