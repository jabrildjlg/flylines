// FlyLines – Linien-Editor: Linien auf einem Foto mit dem Finger bearbeiten.
//
// Punkte ziehen, auf die Linie tippen (neuer Punkt), Punkt löschen, spiegeln.
// Jeder Punkt wird sofort als Anker im Gesichtsnetz gespeichert ({ tri, w }),
// nie als Bildposition. Darum passt dieselbe Linie später auf das Live-Gesicht.

import { projectLine, projectPoint, drawLine } from "./lines.js?v=6";
import { delaunay, locate, sagittalFrame, signedDistance, reflect } from "./geometry.js?v=6";

// Nur die 468 Punkte des Gesichtsnetzes. Die Iris-Punkte (468–477) bewegen sich
// mit dem Blick und taugen nicht als Anker.
const MESH_POINTS = 468;
const MAX_SIDE = 1600; // längste Bildseite in Pixeln

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
  const photo = document.createElement("canvas"); // unverändertes Foto

  let landmarks = null; // normalisierte Gesichtspunkte des Fotos
  let pixels = null; // dieselben Punkte in Pixeln (nur Netzpunkte)
  let tris = null; // Dreiecksnetz über pixels
  let frame = null; // Spiegelebene
  let selected = null; // { line, point }
  let drag = null; // { pointerId, dx, dy }

  const hasPhoto = () => Boolean(landmarks);

  // ---- Foto laden ------------------------------------------------------------

  async function loadPhoto(file) {
    onMessage("Foto wird geladen …");
    let img;
    try {
      img = await decodeImage(file);
    } catch {
      onMessage("Dieses Bild konnte nicht geöffnet werden.");
      return false;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    photo.width = Math.round(img.width * scale);
    photo.height = Math.round(img.height * scale);
    photo.getContext("2d").drawImage(img, 0, 0, photo.width, photo.height);

    onMessage("Gesicht wird gesucht …");
    let face = null;
    try {
      const tracker = await getTracker();
      face = await tracker.detectImage(photo);
    } catch (err) {
      console.error(err);
      onMessage("Das Gesichtstracking konnte nicht geladen werden. Prüfe die Internetverbindung.");
      return false;
    }
    if (!face) {
      landmarks = null;
      onMessage("Auf diesem Foto wurde kein Gesicht gefunden. Wähle ein Foto, auf dem das Gesicht gross und gut beleuchtet ist.");
      return false;
    }

    // Auf das Gesicht zuschneiden, damit es den Bildschirm füllt und die Punkte
    // mit dem Finger gut zu treffen sind.
    landmarks = cropToFace(img, face.landmarks);
    const w = photo.width;
    const h = photo.height;
    pixels = landmarks.slice(0, MESH_POINTS).map((p) => ({ x: p.x * w, y: p.y * h, z: p.z * w }));
    tris = delaunay(pixels);
    frame = sagittalFrame(pixels);
    selected = null;

    canvas.width = w;
    canvas.height = h;
    fit();
    render();
    onMessage("");
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
    photo.width = Math.max(1, Math.round(cw * scale));
    photo.height = Math.max(1, Math.round(ch * scale));
    photo.getContext("2d").drawImage(img, x0, y0, cw, ch, 0, 0, photo.width, photo.height);

    // z ist wie x auf die Bildbreite bezogen und wird gleich umgerechnet.
    return found.map((p) => ({
      x: (p.x * img.width - x0) / cw,
      y: (p.y * img.height - y0) / ch,
      z: (p.z * img.width) / cw,
    }));
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

  // Passt die Zeichenfläche in den verfügbaren Platz ein (Seitenverhältnis bleibt).
  function fit() {
    if (!canvas.width) return;
    const box = stage.getBoundingClientRect();
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
    canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
  }

  // ---- Umrechnen -------------------------------------------------------------

  // Bildschirm-Pixel pro Zeichenflächen-Pixel umgekehrt: wie viele Zeichenflächen-Pixel ist 1 CSS-Pixel.
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

  const positionOf = (point) => projectPoint(point, landmarks, canvas.width, canvas.height);
  const anchorAt = (x, y) => locate(tris, pixels, x, y);

  function position3d(point) {
    const [a, b, c] = point.tri;
    const [wa, wb, wc] = point.w;
    return {
      x: wa * pixels[a].x + wb * pixels[b].x + wc * pixels[c].x,
      y: wa * pixels[a].y + wb * pixels[b].y + wc * pixels[c].y,
      z: wa * pixels[a].z + wb * pixels[b].z + wc * pixels[c].z,
    };
  }

  // ---- Zeichnen --------------------------------------------------------------

  function render() {
    if (!hasPhoto()) return;
    const w = canvas.width;
    const h = canvas.height;
    const u = unit();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(photo, 0, 0);

    for (const line of style.lines) {
      drawLine(ctx, projectLine(line, landmarks, w, h), { width: 3 * u });
    }

    style.lines.forEach((line, li) => {
      line.points.forEach((point, pi) => {
        const p = positionOf(point);
        const isSel = selected && selected.line === li && selected.point === pi;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (isSel ? 9 : 6) * u, 0, Math.PI * 2);
        if (isSel) {
          // Gewählter Punkt als Ring, damit die genaue Stelle sichtbar bleibt.
          ctx.lineWidth = 3 * u;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5 * u, 0, Math.PI * 2);
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
    });

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
    style.lines.forEach((line, li) => {
      line.points.forEach((point, pi) => {
        const q = positionOf(point);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = { line: li, point: pi };
        }
      });
    });
    return best;
  }

  function nearestSegment(p, maxDist) {
    let best = null;
    let bestDist = maxDist;
    style.lines.forEach((line, li) => {
      const pts = line.points.map(positionOf);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const d = Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = { line: li, after: i };
        }
      }
    });
    return best;
  }

  // ---- Finger ----------------------------------------------------------------

  canvas.addEventListener("pointerdown", (e) => {
    if (!hasPhoto() || drag) return;
    const p = toCanvas(e);
    const u = unit();

    let hit = nearestHandle(p, 20 * u);
    if (hit) {
      const q = positionOf(style.lines[hit.line].points[hit.point]);
      drag = { pointerId: e.pointerId, dx: q.x - p.x, dy: q.y - p.y };
    } else {
      const seg = nearestSegment(p, 18 * u);
      if (seg) {
        const anchor = anchorAt(p.x, p.y);
        if (anchor) {
          style.lines[seg.line].points.splice(seg.after + 1, 0, anchor);
          hit = { line: seg.line, point: seg.after + 1 };
          drag = { pointerId: e.pointerId, dx: 0, dy: 0 };
        }
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
    return Boolean(selected) && style.lines[selected.line].points.length > 2;
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
    const i = selected.point;
    const j = i < line.points.length - 1 ? i + 1 : i - 1;
    if (j < 0) return;
    const a = positionOf(line.points[i]);
    const b = positionOf(line.points[j]);
    const anchor = anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!anchor) return;
    const at = Math.max(i, j);
    line.points.splice(at, 0, anchor);
    selected = { line: selected.line, point: at };
    render();
    onChange();
  }

  // Spiegelt die im Bild linke Hälfte jeder Linie auf die rechte.
  // Liegt eine Linie ganz auf einer Seite, entsteht auf der anderen eine Partnerlinie.
  function mirror() {
    if (!hasPhoto()) return;
    const eps = frame.faceWidth * 0.015; // so nah an der Mitte gilt ein Punkt als «auf der Mitte»
    const snapToMiddle = (point) => {
      const p = position3d(point);
      const d = signedDistance(frame, p);
      return anchorAt(p.x - d * frame.n.x, p.y - d * frame.n.y) || point;
    };
    const mirrorPoint = (point) => {
      const r = reflect(frame, position3d(point));
      return anchorAt(r.x, r.y);
    };

    const result = [];
    for (const line of style.lines) {
      if (line.mirrorOf) continue; // Partnerlinien werden neu erzeugt
      const sides = line.points.map((point) => {
        const d = signedDistance(frame, position3d(point));
        return Math.abs(d) < eps ? 0 : Math.sign(d) * frame.leftSign; // 1 = im Bild links
      });
      const crossing = sides.includes(0) || (sides.includes(1) && sides.includes(-1));

      if (!crossing) {
        result.push(line);
        result.push({
          id: `${line.id}~gespiegelt`,
          area: line.area,
          mirrorOf: line.id,
          points: line.points.map(mirrorPoint).filter(Boolean),
        });
        continue;
      }

      const keep = [];
      const mirrored = [];
      line.points.forEach((point, i) => {
        if (sides[i] < 0) return;
        keep.push(sides[i] === 0 ? snapToMiddle(point) : point);
        if (sides[i] === 1) {
          const m = mirrorPoint(point);
          if (m) mirrored.push(m);
        }
      });
      mirrored.reverse();
      const startsOnSource = sides[0] >= 0;
      result.push({ ...line, points: startsOnSource ? keep.concat(mirrored) : mirrored.concat(keep) });
    }

    style.lines = result.filter((line) => line.points.length >= 2);
    selected = null;
    render();
    onChange();
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
    loadPhoto,
    deleteSelected,
    canDelete,
    addAfterSelected,
    hasSelection: () => Boolean(selected),
    mirror,
    refresh,
    hasPhoto,
  };
}
