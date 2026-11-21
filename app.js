// FlyLines – Bauschritt 4: Live-Spiegel mit Linien und Linien-Editor auf einem Foto.

import { createTracker } from "./tracker.js?v=6";
import { TEST_STYLE, StyleSmoother, projectLine, drawLine } from "./lines.js?v=6";
import { createEditor } from "./editor.js?v=6";

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
const dotsBtn = document.getElementById("dotsBtn");

// Mit ?cpu=1 in der Adresse lässt sich die Grafikkarte zum Vergleich abschalten.
const params = new URLSearchParams(location.search);
const forceCpu = params.has("cpu");
// Mit ?glatt=0 lässt sich die Glättung zum Vergleich abschalten.
const smoothing = params.get("glatt") !== "0";
// Mit ?sync=0 wird das Kamerabild wie früher direkt gezeigt (Linien hinken dann leicht nach).
const syncFrames = params.get("sync") !== "0";

// Der Style wird von Live-Spiegel und Editor gemeinsam benutzt.
const cloneStyle = (s) => JSON.parse(JSON.stringify(s));
const style = cloneStyle(TEST_STYLE);
const smoother = new StyleSmoother({ minCutoff: 2, beta: 0.05 });
let showDots = false;

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

// Zeichnet alle Linien des Styles an ihre Stelle im Gesicht.
function drawStyle(landmarks, timeMs) {
  const w = overlay.width;
  const h = overlay.height;
  const width = Math.max(3, Math.min(w, h) / 160);
  for (const line of style.lines) {
    let pts = projectLine(line, landmarks, w, h);
    if (smoothing) pts = smoother.smooth(line.id, pts, timeMs);
    drawLine(ctx, pts, { width });
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
let workMs = 0;
let faceVisible = false;
let failures = 0;

// Verarbeitet genau ein Kamerabild.
//
// Wichtig gegen das Nachziehen: Das Kamerabild wird zuerst auf die Zeichenfläche
// kopiert, unmittelbar danach läuft die Erkennung, und die Linien kommen darüber.
// Bild und Linien stammen so vom selben Moment. Würde das <video> direkt gezeigt,
// wäre es den Linien immer ein bis zwei Bilder voraus.
//
// Die Erkennung liest direkt vom <video> und nicht von der Zeichenfläche: Der Weg
// Zeichenfläche → Grafikkarte ist in Safari langsam und halbierte die Bildrate.
function processFrame() {
  if (!tracker || video.readyState < 2) return;
  resizeOverlay();
  const w = overlay.width;
  const h = overlay.height;
  const now = performance.now();

  if (syncFrames) ctx.drawImage(video, 0, 0, w, h);

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

  if (!syncFrames) clearOverlay();
  if (face) {
    if (showDots) drawLandmarks(face.landmarks);
    drawStyle(face.landmarks, now);
  } else {
    smoother.reset(); // Nach einer Unterbrechung nicht vom alten Ort her einschwenken.
  }

  const hasFace = Boolean(face);
  if (hasFace !== faceVisible) {
    faceVisible = hasFace;
    showNotice(hasFace ? "" : "Kein Gesicht im Bild.");
  }

  // Rechenzeit pro Bild (gleitender Mittelwert), zur Diagnose in der Statuszeile.
  workMs += (performance.now() - now - workMs) * 0.1;

  if (countFrame(now)) {
    showStatus(`${fps} FPS · ${Math.round(workMs)} ms · ${tracker.delegate} · ${video.videoWidth}×${video.videoHeight}`);
  }
}

// Safari meldet jedes neue Kamerabild einzeln (requestVideoFrameCallback).
// Ältere Browser fragen stattdessen bei jedem Bildschirmaufbau nach.
const useVideoFrames = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

function loop() {
  if (!running) return;
  if (useVideoFrames) {
    loopId = video.requestVideoFrameCallback(loop);
    processFrame();
  } else {
    loopId = requestAnimationFrame(loop);
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    processFrame();
  }
}

function scheduleLoop() {
  loopId = useVideoFrames
    ? video.requestVideoFrameCallback(loop)
    : requestAnimationFrame(loop);
}

function cancelLoop() {
  if (useVideoFrames) video.cancelVideoFrameCallback(loopId);
  else cancelAnimationFrame(loopId);
}

// Lädt den Tracker einmal und gibt ihn danach immer wieder zurück.
function getTracker() {
  if (!trackerPromise) {
    trackerPromise = createTracker({ forceCpu }).catch((err) => {
      trackerPromise = null;
      throw err;
    });
  }
  return trackerPromise;
}

async function startTracking() {
  showNotice("Gesichtstracking wird geladen …");
  try {
    tracker = await getTracker();
  } catch (err) {
    console.error(err);
    showNotice("Das Gesichtstracking konnte nicht geladen werden. Prüfe die Internetverbindung und starte die Kamera neu.");
    return;
  }
  if (!stream) return; // Kamera wurde inzwischen gestoppt.

  showNotice("Kein Gesicht im Bild.");
  faceVisible = false;
  failures = 0;
  smoother.reset();
  fpsFrames = 0;
  fpsSince = 0;
  lastVideoTime = -1;
  running = true;
  scheduleLoop();
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
  cancelLoop();
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
dotsBtn.addEventListener("click", () => {
  showDots = !showDots;
  dotsBtn.textContent = showDots ? "Punkte aus" : "Punkte ein";
});
video.addEventListener("loadedmetadata", resizeOverlay);

// ---- Linien-Editor -----------------------------------------------------------

const editorScreen = document.getElementById("editor");
const editorMessage = document.getElementById("editorMessage");
const editorHint = document.getElementById("editorHint");
const addBtn = document.getElementById("addBtn");
const deleteBtn = document.getElementById("deleteBtn");
const mirrorBtn = document.getElementById("mirrorBtn");
const resetBtn = document.getElementById("resetBtn");
const photoInput = document.getElementById("photoInput");

function updateEditorButtons() {
  const ready = editor.hasPhoto();
  addBtn.disabled = !editor.hasSelection();
  deleteBtn.disabled = !editor.canDelete();
  mirrorBtn.disabled = !ready;
  resetBtn.disabled = !ready;
  editorHint.hidden = !ready;
}

const editor = createEditor({
  canvas: document.getElementById("editorCanvas"),
  stage: document.getElementById("editorStage"),
  style,
  getTracker,
  onMessage(text) {
    editorMessage.textContent = text;
    editorMessage.hidden = !text;
  },
  onChange: () => updateEditorButtons(),
});

document.getElementById("editorBtn").addEventListener("click", () => {
  if (stream) stopCamera();
  editorScreen.hidden = false;
  editor.refresh();
  updateEditorButtons();
});

document.getElementById("editorBack").addEventListener("click", () => {
  editorScreen.hidden = true;
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files && photoInput.files[0];
  photoInput.value = ""; // dasselbe Foto soll sich erneut wählen lassen
  if (!file) return;
  await editor.loadPhoto(file);
  updateEditorButtons();
});

addBtn.addEventListener("click", () => editor.addAfterSelected());
deleteBtn.addEventListener("click", () => editor.deleteSelected());
mirrorBtn.addEventListener("click", () => editor.mirror());
resetBtn.addEventListener("click", () => {
  style.lines = cloneStyle(TEST_STYLE).lines;
  editor.refresh();
  updateEditorButtons();
});

// iOS hält die Kamera an, wenn die Seite in den Hintergrund geht.
// Beim Zurückkommen zeigen wir wieder den Startbildschirm, statt ein eingefrorenes Bild.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) stopCamera();
});
