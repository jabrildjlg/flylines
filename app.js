// FlyLines – Bauschritt 1: Grundgerüst mit gespiegeltem Kamerabild.

const app = document.getElementById("app");
const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const controls = document.getElementById("controls");
const message = document.getElementById("message");
const statusEl = document.getElementById("status");

let stream = null;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
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
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

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
    showStatus(`${video.videoWidth} × ${video.videoHeight}`);
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
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  app.classList.remove("live");
  controls.hidden = true;
  showStatus("");
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
video.addEventListener("loadedmetadata", resizeOverlay);

// iOS hält die Kamera an, wenn die Seite in den Hintergrund geht.
// Beim Zurückkommen zeigen wir wieder den Startbildschirm, statt ein eingefrorenes Bild.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) stopCamera();
});
