// FlyLines – Linien-Editor: die Formen eines Styles auf Fotos mit dem Finger anpassen.
//
// Bis zu drei Fotos (z. B. frontal und von beiden Seiten). Alle Fotos zeigen
// dieselben Formen: Jeder Punkt wird als Anker im Gesichtsnetz gespeichert
// ({ tri, w }), nie als Bildposition. Was auf einem Foto verschoben wird,
// verschiebt sich darum auf den anderen Fotos und später im Live-Bild mit.

import { projectLine, projectPoint, drawLine } from "./lines.js?v=8";
import { delaunay, locate, sagittalFrame, signedDistance, reflect } from "./geometry.js?v=8";
import { analyzeBeard } from "./analyze.js?v=8";

// Nur die 468 Punkte des Gesichtsnetzes. Die Iris-Punkte (468–477) bewegen sich
// mit dem Blick und taugen nicht als Anker.
const MESH_POINTS = 468;
const MAX_SIDE = 1600; // längste Bildseite in Pixeln
export const MAX_PHOTOS = 3;

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.stage        Behälter, in den das Foto eingepasst wird
 * @param {object} o.style             Style, dessen Linien bearbeitet werden (wird direkt verändert)
 * @param {() => Promise<object>} o.getTracker
 * @param {(text: string) => void} o.onMessage
 * @param {() => void} o.onChange      Wird nach jeder Änderung aufgerufen
 */
export function createEditor({ canvas, stage, style, getTracker, onMessage, onChange }) {
  const ctx = canvas.getContext("2d");

  // Jedes Foto: { image, landmarks, pixels, tris, frame }
  const photos = [];
  let current = -1;
  let selected = null; // { line, point }
  let drag = null; // { pointerId, dx, dy }

  const photo = () => photos[current] || null;
  const hasPhoto = () => current >= 0;
  const visibleLines = () => style.lines.map((line, index) => ({ line, index })).filter((e) => e.line.enabled !== false);
  const minPoints = (line) => (line.closed ? 3 : 2);

  // ---- Foto laden ------------------------------------------------------------

  async function addPhoto(file) {
    onMessage("Foto wird geladen …");
    let img;
    try {
      img = await decodeImage(file);
    } catch {
      onMessage(hasPhoto() ? "" : "Dieses Bild konnte nicht geöffnet werden.");
      return false;
    }

    // Verkleinerte Kopie für die Gesichtserkennung.
    const probe = document.createElement("canvas");
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    probe.width = Math.round(img.width * scale);
    probe.height = Math.round(img.height * scale);
    probe.getContext("2d").drawImage(img, 0, 0, probe.width, probe.height);

    onMessage("Gesicht wird gesucht …");
    let face = null;
    try {
      const tracker = await getTracker();
      face = await tracker.detectImage(probe);
    } catch (err) {
      console.error(err);
      onMessage("Das Gesichtstracking konnte nicht geladen werden. Prüfe die Internetverbindung.");
      return false;
    }
    if (!face) {
      onMessage("Auf diesem Foto wurde kein Gesicht gefunden. Wähle ein Foto, auf dem das Gesicht gross und gut beleuchtet ist.");
      return false;
    }

    // Auf das Gesicht zuschneiden, damit es den Bildschirm füllt und die Punkte
    // mit dem Finger gut zu treffen sind.
    const cropped = cropToFace(img, face.landmarks);
    const w = cropped.image.width;
    const pixels = cropped.landmarks
      .slice(0, MESH_POINTS)
      .map((p) => ({ x: p.x * w, y: p.y * cropped.image.height, z: p.z * w }));
    const entry = {
      image: cropped.image,
      landmarks: cropped.landmarks,
      pixels,
      tris: delaunay(pixels),
      frame: sagittalFrame(pixels),
    };

    // Sind schon drei Fotos da, ersetzt das neue das gerade gezeigte.
    if (photos.length < MAX_PHOTOS) {
      photos.push(entry);
      current = photos.length - 1;
    } else {
      photos[current] = entry;
    }
    onMessage("");
    show(current);
    return true;
  }

  // Schneidet das Foto auf das Gesicht zu (mit Rand für Hals, Ohren und Haaransatz)
  // und rechnet die Gesichtspunkte auf den Ausschnitt um.
  function cropToFace(img, found) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < MESH_POINTS; i++) {
      const p = found[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const fw = (maxX - minX) * img.width;
    const fh = (maxY - minY) * img.height;
    const x0 = Math.max(0, minX * img.width - fw * 0.3);
    const x1 = Math.min(img.width, maxX * img.width + fw * 0.3);
    const y0 = Math.max(0, minY * img.height - fh * 0.45);
    const y1 = Math.min(img.height, maxY * img.height + fh * 0.35);
    const cw = x1 - x0;
    const ch = y1 - y0;

    const scale = Math.min(1, MAX_SIDE / Math.max(cw, ch));
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(cw * scale));
    image.height = Math.max(1, Math.round(ch * scale));
    image.getContext("2d").drawImage(img, x0, y0, cw, ch, 0, 0, image.width, image.height);

    // z ist wie x auf die Bildbreite bezogen und wird gleich umgerechnet.
    const landmarks = found.map((p) => ({
      x: (p.x * img.width - x0) / cw,
      y: (p.y * img.height - y0) / ch,
      z: (p.z * img.width) / cw,
    }));
    return { image, landmarks };
  }

  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Bild nicht lesbar"));
      };
      img.src = url;
    });
  }

  /** Zeigt das Foto mit der Nummer index. */
  function show(index) {
    if (index < 0 || index >= photos.length) return;
    current = index;
    selected = null;
    drag = null;
    canvas.width = photo().image.width;
    canvas.height = photo().image.height;
    fit();
    render();
    onChange();
  }

  // Passt die Zeichenfläche in den verfügbaren Platz ein (Seitenverhältnis bleibt).
  function fit() {
    if (!canvas.width) return;
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
    canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
  }

  // ---- Umrechnen -------------------------------------------------------------

  // Wie viele Zeichenflächen-Pixel einem Bildschirm-Pixel entsprechen.
  function unit() {
    const rect = canvas.getBoundingClientRect();
    return rect.width ? canvas.width / rect.width : 1;
  }

  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  const positionOf = (point) => projectPoint(point, photo().landmarks, canvas.width, canvas.height);
  const anchorAt = (x, y) => locate(photo().tris, photo().pixels, x, y);

  function position3d(point) {
    const px = photo().pixels;
    const [a, b, c] = point.tri;
    const [wa, wb, wc] = point.w;
    return {
      x: wa * px[a].x + wb * px[b].x + wc * px[c].x,
      y: wa * px[a].y + wb * px[b].y + wc * px[c].y,
      z: wa * px[a].z + wb * px[b].z + wc * px[c].z,
    };
  }

  // ---- Zeichnen --------------------------------------------------------------

  function render() {
    if (!hasPhoto()) return;
    const w = canvas.width;
    const h = canvas.height;
    const u = unit();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(photo().image, 0, 0);

    for (const { line } of visibleLines()) {
      drawLine(ctx, projectLine(line, photo().landmarks, w, h), { width: 1.5 * u, closed: line.closed });
    }

    for (const { line, index } of visibleLines()) {
      line.points.forEach((point, pi) => {
        const p = positionOf(point);
        const isSel = selected && selected.line === index && selected.point === pi;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (isSel ? 9 : 5) * u, 0, Math.PI * 2);
        if (isSel) {
          // Gewählter Punkt als Ring, damit die genaue Stelle sichtbar bleibt.
          ctx.lineWidth = 2.5 * u;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2 * u, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.lineWidth = 1.5 * u;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
          ctx.stroke();
        }
      });
    }

    if (drag && selected) drawLoupe(positionOf(style.lines[selected.line].points[selected.point]), u);
  }

  // Lupe: zeigt die Stelle unter dem Finger vergrössert in einer Ecke.
  function drawLoupe(p, u) {
    const w = canvas.width;
    const size = Math.min(150 * u, w * 0.42);
    const zoom = 2.5;
    const margin = 12 * u;
    const onLeft = p.x > w / 2; // Lupe auf die Seite, auf der der Finger nicht ist
    const cx = onLeft ? margin + size / 2 : w - margin - size / 2;
    const cy = margin + size / 2;
    const src = size / zoom;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.drawImage(canvas, p.x - src / 2, p.y - src / 2, src, src, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  // ---- Treffer suchen --------------------------------------------------------

  function nearestHandle(p, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const { line, index } of visibleLines()) {
      line.points.forEach((point, pi) => {
        const q = positionOf(point);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = { line: index, point: pi, dist: d };
        }
      });
    }
    return best;
  }

  function nearestSegment(p, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const { line, index } of visibleLines()) {
      const pts = line.points.map(positionOf);
      const n = pts.length;
      const segments = line.closed ? n : n - 1;
      for (let i = 0; i < segments; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const d = Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = { line: index, after: i };
        }
      }
    }
    return best;
  }

  // ---- Finger ----------------------------------------------------------------

  canvas.addEventListener("pointerdown", (e) => {
    if (!hasPhoto() || drag) return;
    const p = toCanvas(e);
    const u = unit();

    // Nah an einem Punkt: diesen Punkt greifen. Sonst auf der Linie: neuen Punkt
    // einfügen. Sonst, wenn ein Punkt in Reichweite ist: diesen greifen.
    const handle = nearestHandle(p, 22 * u);
    const seg = nearestSegment(p, 14 * u);
    let hit = null;
    if (handle && (handle.dist <= 11 * u || !seg)) {
      const q = positionOf(style.lines[handle.line].points[handle.point]);
      hit = { line: handle.line, point: handle.point };
      drag = { pointerId: e.pointerId, dx: q.x - p.x, dy: q.y - p.y };
    } else if (seg) {
      const anchor = anchorAt(p.x, p.y);
      if (anchor) {
        style.lines[seg.line].points.splice(seg.after + 1, 0, anchor);
        hit = { line: seg.line, point: seg.after + 1 };
        drag = { pointerId: e.pointerId, dx: 0, dy: 0 };
      }
    }

    selected = hit;
    if (drag) {
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    render();
    onChange();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId || !selected) return;
    const p = toCanvas(e);
    const x = Math.max(0, Math.min(canvas.width, p.x + drag.dx));
    const y = Math.max(0, Math.min(canvas.height, p.y + drag.dy));
    const anchor = anchorAt(x, y);
    if (anchor) style.lines[selected.line].points[selected.point] = anchor;
    e.preventDefault();
    render();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    render();
    onChange();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // ---- Aktionen --------------------------------------------------------------

  function canDelete() {
    if (!selected) return false;
    const line = style.lines[selected.line];
    return line.points.length > minPoints(line);
  }

  function deleteSelected() {
    if (!canDelete()) return;
    style.lines[selected.line].points.splice(selected.point, 1);
    selected = null;
    render();
    onChange();
  }

  // Fügt nach dem gewählten Punkt einen neuen ein (in der Mitte zum Nachbarn).
  // Nötig, wo die Punkte so dicht liegen, dass man die Linie nicht mehr antippen kann.
  function addAfterSelected() {
    if (!selected) return;
    const line = style.lines[selected.line];
    const n = line.points.length;
    const i = selected.point;
    let j = i + 1;
    if (j >= n) j = line.closed ? 0 : i - 1;
    if (j < 0) return;
    const a = positionOf(line.points[i]);
    const b = positionOf(line.points[j]);
    const anchor = anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!anchor) return;
    const at = j === i - 1 ? i : i + 1;
    line.points.splice(at, 0, anchor);
    selected = { line: selected.line, point: at };
    render();
    onChange();
  }

  // Spiegelt die im Bild linke Hälfte jeder sichtbaren Form auf die rechte.
  // Formen über der Gesichtsmitte (Schnauzer, Goatee) werden symmetrisch.
  // Formen ganz auf der linken Seite (eine Braue) überschreiben ihre Partnerform.
  function mirror() {
    if (!hasPhoto()) return;
    const frame = photo().frame;
    const eps = frame.faceWidth * 0.015; // so nah an der Mitte gilt ein Punkt als «auf der Mitte»

    const mirrorPoint = (point) => {
      const r = reflect(frame, position3d(point));
      return anchorAt(r.x, r.y);
    };
    const snapToMiddle = (point) => {
      const p = position3d(point);
      const d = signedDistance(frame, p);
      return anchorAt(p.x - d * frame.n.x, p.y - d * frame.n.y) || point;
    };
    const sideOf = (point) => {
      const d = signedDistance(frame, position3d(point));
      return Math.abs(d) < eps ? 0 : Math.sign(d) * frame.leftSign; // 1 = im Bild links
    };

    for (const { line } of visibleLines()) {
      const sides = line.points.map(sideOf);
      const hasLeft = sides.includes(1);
      const hasRight = sides.includes(-1);

      if (hasLeft && !hasRight && !sides.includes(0)) {
        // Ganz links: Partnerform auf der rechten Seite neu setzen.
        const points = line.points.map(mirrorPoint).filter(Boolean);
        if (points.length < minPoints(line)) continue;
        let partner = style.lines.find((l) => l.id === line.partner);
        if (!partner) {
          partner = { ...line, id: `${line.id}~gespiegelt`, partner: line.id, points: [] };
          line.partner = partner.id;
          style.lines.push(partner);
        }
        partner.points = points;
        continue;
      }
      if (!hasLeft) continue; // ganz rechts oder nur auf der Mitte: nichts zu spiegeln

      // Über der Mitte: linke Hälfte behalten, rechte aus ihr neu aufbauen.
      const n = sides.length;
      let start = 0;
      if (line.closed) {
        for (let i = 0; i < n; i++) {
          if (sides[i] >= 0 && sides[(i - 1 + n) % n] < 0) {
            start = i;
            break;
          }
        }
      }
      const keep = [];
      const mirrored = [];
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (sides[i] < 0) {
          if (line.closed) break;
          continue;
        }
        keep.push(sides[i] === 0 ? snapToMiddle(line.points[i]) : line.points[i]);
        if (sides[i] === 1) {
          const m = mirrorPoint(line.points[i]);
          if (m) mirrored.push(m);
        }
      }
      mirrored.reverse();
      // Offene Linie, die rechts beginnt: die gespiegelten Punkte gehören an den Anfang.
      const mirroredFirst = !line.closed && sides[0] < 0;
      const points = mirroredFirst ? mirrored.concat(keep) : keep.concat(mirrored);
      if (points.length >= minPoints(line)) line.points = points;
    }

    selected = null;
    render();
    onChange();
  }

  // Bart-Analyse über alle geladenen Fotos. Setzt die gefundenen Umrisse als neue
  // Formen für Schnauzer und Goatee. Bezug ist das Foto, das am ehesten von vorn zeigt.
  function analyze() {
    if (!hasPhoto()) return null;
    const data = photos.map((p) => ({
      width: p.image.width,
      height: p.image.height,
      data: p.image.getContext("2d").getImageData(0, 0, p.image.width, p.image.height).data,
      pixels: p.pixels,
      tris: p.tris,
    }));
    let ref = 0;
    let best = Infinity;
    photos.forEach((p, i) => {
      const turned = Math.abs(p.frame.n.z); // 0 = genau von vorn
      if (turned < best) {
        best = turned;
        ref = i;
      }
    });

    const result = analyzeBeard(data, ref);
    show(ref);
    const found = [];
    for (const key of ["schnauzer", "goatee"]) {
      const outline = result[key];
      const line = style.lines.find((l) => l.id === key);
      if (!outline || !line) continue;
      const points = outline.map((p) => anchorAt(p.x, p.y)).filter(Boolean);
      if (points.length < 3) continue;
      line.points = points;
      line.enabled = true;
      found.push(key);
    }
    render();
    onChange();
    return { found, ref };
  }

  function refresh() {
    selected = null;
    fit();
    render();
  }

  window.addEventListener("resize", () => {
    fit();
    render();
  });

  return {
    addPhoto,
    show,
    photoCount: () => photos.length,
    currentPhoto: () => current,
    deleteSelected,
    canDelete,
    addAfterSelected,
    hasSelection: () => Boolean(selected),
    mirror,
    analyze,
    refresh,
    hasPhoto,
  };
}
