// FlyLines Prüfstand – Seite, die die echten Module der App lädt und von run.mjs
// ferngesteuert wird. Gehört nicht zur App und wird von ihr nie geladen.

import { createTracker } from "../tracker.js";
import { DEFAULT_STYLE, projectLine, projectLine3, headCenter, drawLine } from "../lines.js";
import { createEditor } from "../editor.js";
import { locate } from "../geometry.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const style = clone(DEFAULT_STYLE);
const input = document.getElementById("files");
const messages = [];
let trackerPromise = null;

const editor = createEditor({
  canvas: document.getElementById("canvas"),
  stage: document.getElementById("stage"),
  style,
  // Prozessor statt Grafikkarte: langsamer, aber auf jedem Rechner gleich.
  getTracker: () => (trackerPromise ||= createTracker({ forceCpu: true })),
  onMessage: (text) => text && messages.push(text),
  onChange: () => {},
});

const beardLines = () => style.lines.filter((l) => l.area === "bart" && l.enabled !== false);

function photoInfo(photo, name) {
  const w = photo.image.width;
  const h = photo.image.height;
  const px = photo.pixels;
  const center = headCenter(photo.landmarks, w, h);
  return {
    name,
    width: w,
    height: h,
    crop: photo.crop,
    // Gesichtsbreite in 3D, damit sie auch im Profil stimmt.
    faceWidth: Math.hypot(px[454].x - px[234].x, px[454].y - px[234].y, px[454].z - px[234].z),
    turned: Math.abs(photo.frame.n.z),
    // Pro Punkt zusätzlich, wie stark er zur Kamera zeigt (1 = frontal, < 0 = abgewandt).
    shapes: beardLines().map((line) =>
      projectLine3(line, photo.landmarks, w, h).map((p) => {
        const d = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
        return { x: p.x, y: p.y, toward: -d.z / (Math.hypot(d.x, d.y, d.z) || 1) };
      })
    ),
  };
}

let names = [];

window.bench = {
  messages,

  /** Lädt die im Datei-Feld gewählten Fotos. */
  async load() {
    const files = Array.from(input.files);
    names = [];
    for (const file of files) {
      if (await editor.addPhoto(file)) names.push(file.name);
    }
    return names;
  },

  /** Analyse wie der Knopf «Analysieren», ausgehend von den Startformen. */
  analyze(showIndex = 0) {
    style.lines = clone(DEFAULT_STYLE).lines;
    editor.resetAnalysis();
    editor.show(showIndex);
    const t0 = performance.now();
    const summary = editor.analyze();
    return { ...summary, ms: Math.round(performance.now() - t0) };
  },

  /**
   * Feinabgleich prüfen: zieht wie ein Finger den ersten Punkt der ersten Bartform
   * ein Stück weg und analysiert erneut. Erwartet wird mode "refine".
   */
  refine(shift = 12) {
    const canvas = document.getElementById("canvas");
    const photo = editor.photoData()[editor.currentPhoto()];
    const rect = canvas.getBoundingClientRect();
    const [p] = projectLine(beardLines()[0], photo.landmarks, canvas.width, canvas.height);
    const x = rect.left + (p.x / canvas.width) * rect.width;
    const y = rect.top + (p.y / canvas.height) * rect.height;
    const fire = (type, dx) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x + dx, clientY: y + dx, bubbles: true, cancelable: true }));
    // setPointerCapture verlangt einen echten Finger; für den Test genügt es ohne.
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    fire("pointerdown", 0);
    fire("pointermove", shift / 2);
    fire("pointermove", shift);
    fire("pointerup", shift);
    canvas.setPointerCapture = capture;
    const before = JSON.stringify(beardLines().map((l) => l.points));
    const summary = editor.analyze();
    return { ...summary, changed: before !== JSON.stringify(beardLines().map((l) => l.points)) };
  },

  /** Rechnet Formen (Pixel des Ausschnitts von Foto index) in Anker im Gesichtsnetz um, wie der Editor. */
  anchorsFor(index, shapes) {
    const photo = editor.photoData()[index];
    return shapes.map((shape) => shape.map((p) => locate(photo.tris, photo.pixels, p.x, p.y)));
  },

  /** Setzt die Bartformen des Styles auf die gegebenen Anker (Brauen bleiben). */
  setBeard(shapes) {
    style.lines = clone(DEFAULT_STYLE)
      .lines.filter((l) => l.area !== "bart")
      .concat(shapes.map((points, i) => ({ id: `bart-${i + 1}`, group: "bart", area: "bart", closed: true, enabled: true, points })));
    return style.lines.length;
  },

  /** Startformen ohne Analyse (Vergleichswert). */
  defaults() {
    style.lines = clone(DEFAULT_STYLE).lines;
    return { mode: "defaults" };
  },

  /** Ergebnis pro Foto: Kontrollpunkte der Bartformen in Pixeln des Ausschnitts. */
  result() {
    return editor.photoData().map((photo, i) => photoInfo(photo, names[i]));
  },

  /**
   * Überlagerungsbild als PNG (data-URL): Foto, Ergebnis grün, Soll-Kontur magenta.
   * @param {number} index
   * @param {{x:number,y:number}[][]} soll  Soll-Formen in Pixeln des Ausschnitts
   * @param {{dots?: boolean, grid?: boolean, lines?: boolean}} options
   */
  overlay(index, soll = [], { dots = false, grid = false, lines = true, zoom = false, marks = false } = {}) {
    const photo = editor.photoData()[index];
    const w = photo.image.width;
    const h = photo.image.height;
    const px = photo.pixels;

    // Ausschnitt: ganzes Foto oder nur die untere Gesichtshälfte (vergrössert).
    let rect = { x: 0, y: 0, w, h };
    let fine = false;
    if (zoom && typeof zoom === "object") {
      // Frei gewählter Ausschnitt in Prozent des Originalfotos (stark vergrössert).
      const { crop } = photo;
      const k = w / crop.width;
      const X = (p) => ((p / 100) * crop.srcWidth - crop.x) * k;
      const Y = (p) => ((p / 100) * crop.srcHeight - crop.y) * k;
      rect = { x: X(zoom.x0), y: Y(zoom.y0), w: X(zoom.x1) - X(zoom.x0), h: Y(zoom.y1) - Y(zoom.y0) };
      fine = zoom.x1 - zoom.x0 < 30;
    } else if (zoom) {
      const xs = px.map((p) => p.x);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const faceH = Math.hypot(px[10].x - px[152].x, px[10].y - px[152].y);
      const top = Math.max(0, px[1].y - faceH * 0.08);
      const bottom = Math.min(h, px[152].y + faceH * 0.22);
      const left = Math.max(0, x0 - (x1 - x0) * 0.12);
      const right = Math.min(w, x1 + (x1 - x0) * 0.12);
      rect = { x: left, y: top, w: right - left, h: bottom - top };
    }
    const s = zoom ? 1600 / rect.w : 1;
    const view = document.createElement("canvas");
    view.width = Math.round(rect.w * s);
    view.height = Math.round(rect.h * s);
    const c = view.getContext("2d");
    c.setTransform(s, 0, 0, s, -rect.x * s, -rect.y * s);
    c.drawImage(photo.image, 0, 0);
    const width = Math.max(1.5, view.width / (fine ? 900 : 500)) / s;

    if (grid) {
      // Raster in Prozent des ORIGINALFOTOS, zum Ablesen von Soll-Punkten.
      const { crop } = photo;
      const k = w / crop.width;
      const font = view.width / 70 / s;
      c.font = `bold ${font}px sans-serif`;
      const step = fine ? 0.5 : zoom ? 1 : 2;
      for (let p = 0; p <= 100; p += step) {
        const major = p % (fine ? 5 : 10) === 0;
        const mid = p % (fine ? 1 : 2) === 0;
        c.strokeStyle = major ? "rgba(255,255,0,0.85)" : mid ? "rgba(255,255,0,0.4)" : "rgba(255,255,0,0.18)";
        c.lineWidth = (major ? 2 : 1) / s;
        const x = ((p / 100) * crop.srcWidth - crop.x) * k;
        const y = ((p / 100) * crop.srcHeight - crop.y) * k;
        c.beginPath(); c.moveTo(x, rect.y); c.lineTo(x, rect.y + rect.h); c.stroke();
        c.beginPath(); c.moveTo(rect.x, y); c.lineTo(rect.x + rect.w, y); c.stroke();
        if (!mid) continue;
        c.fillStyle = "#ff0";
        for (const at of [0.01, 0.5]) {
          c.fillText(String(p), x + 2 / s, rect.y + rect.h * at + font);
          c.fillText(String(p), rect.x + rect.w * at + 2 / s, y - 2 / s);
        }
      }
    }
    if (dots) {
      c.fillStyle = "#35e0a1";
      const d = 3 / s;
      for (const p of px) c.fillRect(p.x - d / 2, p.y - d / 2, d, d);
    }
    for (const shape of soll) drawLine(c, shape, { color: "#ff3df2", width, closed: true, halo: false });
    if (marks) {
      // Kontrollpunkte der Soll-Formen mit Nummer, zum gezielten Korrigieren.
      const font = view.width / 90 / s;
      c.font = `bold ${font}px sans-serif`;
      for (const shape of soll) {
        shape.forEach((p, i) => {
          c.fillStyle = "#00e5ff";
          c.beginPath();
          c.arc(p.x, p.y, 2.2 * width, 0, Math.PI * 2);
          c.fill();
          c.fillText(String(i), p.x + 3 * width, p.y - 3 * width);
        });
      }
    }
    if (lines) {
      for (const line of beardLines()) {
        drawLine(c, projectLine(line, photo.landmarks, w, h), { width, closed: line.closed, halo: false });
      }
    }
    return view.toDataURL("image/png");
  },
};
