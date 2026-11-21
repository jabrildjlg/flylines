// FlyLines – Gesichtstracking mit MediaPipe Face Landmarker.
// Liefert pro Kamerabild 478 Gesichtspunkte und die Kopfhaltung.
//
// Bibliothek und Modell werden vorerst aus dem Netz geladen. Liegt das Modell
// später unter models/face_landmarker.task im Repository, wird es von dort
// genommen (Voraussetzung für den Offline-Betrieb in Schritt 12).

const VERSION = "1.2.3";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;

const LOCAL_MODEL = "models/face_landmarker.task";
const REMOTE_MODELS = [
  "https://huggingface.co/litert-community/MediaPipe-FaceLandmarker/resolve/main/face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
];

async function localModelExists() {
  try {
    const res = await fetch(LOCAL_MODEL, { method: "HEAD" });
    const type = res.headers.get("content-type") || "";
    return res.ok && !type.includes("text/html");
  } catch {
    return false;
  }
}

/**
 * Lädt den Tracker. Versucht zuerst die Grafikkarte (schnell), dann den Prozessor.
 * @param {{forceCpu?: boolean}} options
 * @returns {Promise<{detect: Function, delegate: string, close: Function}>}
 */
export async function createTracker({ forceCpu = false } = {}) {
  const { FilesetResolver, FaceLandmarker } = await import(`${CDN}/+esm`);
  const vision = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);

  const models = (await localModelExists())
    ? [LOCAL_MODEL, ...REMOTE_MODELS]
    : REMOTE_MODELS;
  const delegates = forceCpu ? ["CPU"] : ["GPU", "CPU"];

  let lastError = null;
  for (const delegate of delegates) {
    for (const modelAssetPath of models) {
      try {
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true,
        });
        return {
          delegate,
          // Gibt { landmarks, matrix } zurück oder null, wenn kein Gesicht im Bild ist.
          detect(video, timestampMs) {
            const result = landmarker.detectForVideo(video, timestampMs);
            const landmarks = result.faceLandmarks && result.faceLandmarks[0];
            if (!landmarks) return null;
            const matrixes = result.facialTransformationMatrixes;
            return {
              landmarks,
              matrix: matrixes && matrixes[0] ? matrixes[0].data : null,
            };
          },
          close() {
            landmarker.close();
          },
        };
      } catch (err) {
        console.warn(`Tracker-Start fehlgeschlagen (${delegate}, ${modelAssetPath})`, err);
        lastError = err;
      }
    }
  }
  throw lastError || new Error("Tracker konnte nicht gestartet werden.");
}
