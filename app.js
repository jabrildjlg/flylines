// FlyLines – Bauschritt 2: Kamerabild mit Gesichtstracking.

import { createTracker } from "./tracker.js";

const app = document.getElementById("app");
const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const controls = document.getElementById("controls");
const message = document.getElementById("message");
const statusEl = document.getElementById("status");
const notice = document.getElementById("notice");

// Mit ?cpu=1 in der Adresse lässt sich die Grafikkarte zum Vergleich abschalten.
const forceCpu = new URLSearchParams(location.search).has("cpu");

let stream = null;
let tracker = null;
let trackerPromise = null;
let loopId = 0;
let running = false;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function showNotice(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

// Übersetzt Kamerafehler in eine verständliche Meldung.
function explainError(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Die Kamera wurde nicht freigegeben. Erlaube den Zugriff in Safari über «aA» → Website-Einstellungen → Kamera und lade die Seite neu.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Es wurde keine Frontkamera gefunden.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Die Kamera wird gerade von einer anderen App benutzt. Schliesse diese und versuche es erneut.";
  }
  return "Die Kamera konnte nicht gestartet werden. Lade die Seite neu und versuche es nochmals.";
}

// Die Zeichenfläche bekommt dieselbe Auflösung wie das Kamerabild.
function resizeOverlay() {
  if (!video.videoWidth) return;
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
}

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

// Zeichnet die Gesichtspunkte als kleine Quadrate (schneller als Kreise).
function drawLandmarks(landmarks) {
  const w = overlay.width;
  const h = overlay.height;
  const size = Math.max(2, Math.round(Math.min(w, h) / 240));
  const half = size / 2;
  ctx.fillStyle = "#35e0a1";
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    ctx.fillRect(p.x * w - half, p.y * h - half, size, size);
  }
}

// ---- Bildrate messen -------------------------------------------------------

let fpsFrames = 0;
let fpsSince = 0;
let fps = 0;

function countFrame(now) {
  fpsFrames++;
  if (!fpsSince) fpsSince = now;
  const elapsed = now - fpsSince;
  if (elapsed >= 500) {
    fps = Math.round((fpsFrames * 1000) / elapsed);
    fpsFrames = 0;
    fpsSince = now;
    return true;
  }
  return false;
}

// ---- Tracking-Schleife -----------------------------------------------------

let lastVideoTime = -1;
let faceVisible = false;
let failures = 0;

function loop() {
  if (!running) return;
  loopId = requestAnimationFrame(loop);

  if (!tracker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  resizeOverlay();

  const now = performance.now();
  let face = null;
  try {
    face = tracker.detect(video, now);
    failures = 0;
  } catch (err) {
    console.error(err);
    if (++failures >= 5) {
      running = false;
      clearOverlay();
      showStatus("");
      showNotice("Das Gesichtstracking ist abgestürzt. Lade die Seite neu.");
    }
    return;
  }

  clearOverlay();
  if (face) drawLandmarks(face.landmarks);

  const hasFace = Boolean(face);
  if (hasFace !== faceVisible) {
    faceVisible = hasFace;
    showNotice(hasFace ? "" : "Kein Gesicht im Bild.");
  }

  if (countFrame(now)) {
    showStatus(`${fps} FPS · ${tracker.delegate} · ${video.videoWidth}×${video.videoHeight}`);
  }
}

async function startTracking() {
  showNotice("Gesichtstracking wird geladen …");
  try {
    if (!trackerPromise) trackerPromise = createTracker({ forceCpu });
    tracker = await trackerPromise;
  } catch (err) {
    console.error(err);
    trackerPromise = null;
    showNotice("Das Gesichtstracking konnte nicht geladen werden. Prüfe die Internetverbindung und starte die Kamera neu.");
    return;
  }
  if (!stream) return; // Kamera wurde inzwischen gestoppt.

  showNotice("Kein Gesicht im Bild.");
  faceVisible = false;
  failures = 0;
  fpsFrames = 0;
  fpsSince = 0;
  lastVideoTime = -1;
  running = true;
  loopId = requestAnimationFrame(loop);
}

// ---- Kamera ----------------------------------------------------------------

async function startCamera() {
  showMessage("");

  if (!window.isSecureContext) {
    showMessage("Die Kamera funktioniert nur über eine sichere Adresse (https).");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMessage("Dieser Browser unterstützt keinen Kamerazugriff. Öffne die Seite in Safari.");
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Kamera startet …";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
    await video.play();
    resizeOverlay();

    app.classList.add("live");
    controls.hidden = false;
    showStatus(`${video.videoWidth}×${video.videoHeight}`);
    startTracking();
  } catch (err) {
    console.error(err);
    stopCamera();
    showMessage(explainError(err));
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Kamera starten";
  }
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(loopId);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  clearOverlay();
  app.classList.remove("live");
  controls.hidden = true;
  showStatus("");
  showNotice("");
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
video.addEventListener("loadedmetadata", resizeOverlay);

// iOS hält die Kamera an, wenn die Seite in den Hintergrund geht.
// Beim Zurückkommen zeigen wir wieder den Startbildschirm, statt ein eingefrorenes Bild.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) stopCamera();
});
