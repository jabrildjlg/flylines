// FlyLines – Linien-Editor: die Formen eines Styles auf Fotos mit dem Finger anpassen.
//
// Bis zu drei Fotos (z. B. frontal und von beiden Seiten). Alle Fotos zeigen
// dieselben Formen: Jeder Punkt wird als Anker im Gesichtsnetz gespeichert
// ({ tri, w }), nie als Bildposition. Was auf einem Foto verschoben wird,
// verschiebt sich darum auf den anderen Fotos und später im Live-Bild mit.

import { projectLine, projectPoint, drawLine } from "./lines.js?v=12";
import { delaunay, locate, sagittalFrame, signedDistance, reflect } from "./geometry.js?v=12";
import { analyzeBeard } from "./analyze.js?v=12";

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
  let lastSide = 1; // zuletzt bearbeitete Gesichtshälfte: 1 = im Bild links, -1 = rechts
  let analyzed = false; // es gab schon eine Analyse
  let edited = false; // seit der letzten Analyse wurde von Hand geändert

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
      crop: cropped.crop, // Ausschnitt im Originalfoto (für den Prüfstand)
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
    return { image, landmarks, crop: { x: x0, y: y0, width: cw, height: ch, srcWidth: img.width, srcHeight: img.height } };
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

  /** Lädt mehrere Fotos nacheinander (höchstens so viele, wie Plätze da sind). */
  async function addPhotos(files) {
    let added = 0;
    for (const file of Array.from(files).slice(0, MAX_PHOTOS)) {
      if (await addPhoto(file)) added++;
    }
    return added;
  }

  /** Zeigt das Foto mit der Nummer index. */
  function show(index) {
    if (index < 0 || index >= photos.length) return;
    current = index;
    selected = null;
    drag = null;
    canvas.width = photo().image.width;
    canvas.height = photo().image.height;
    zoom = 1;
    panX = panY = 0;
    pointers.clear();
    pinch = panDrag = null;
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
    applyView();
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
        const isSel = selected && selected.line === index && selected.point === pi;
        // Beim Ziehen nur den gezogenen Punkt zeigen, damit die anderen den Bart nicht verdecken.
        if (drag && !isSel) return;
        const p = positionOf(point);
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
    // Sichtbarer Ausschnitt der Zeichenfläche (bei Zoom ist nur ein Teil zu sehen).
    const rect = canvas.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    const left = Math.max(0, box.left - rect.left) * u;
    const right = Math.min(rect.width, box.right - rect.left) * u;
    const top = Math.max(0, box.top - rect.top) * u;
    const size = Math.min(150 * u, (right - left) * 0.42);
    const magnify = 2.5;
    const margin = 12 * u;
    const onLeft = p.x > (left + right) / 2; // Lupe auf die Seite, auf der der Finger nicht ist
    const cx = onLeft ? left + margin + size / 2 : right - margin - size / 2;
    const cy = top + margin + size / 2;
    const src = size / magnify;

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

  // Gesichtshälfte eines Punkts im gezeigten Foto: 1 = im Bild links, -1 = rechts, 0 = Mitte.
  function sideOf(point) {
    const frame = photo().frame;
    const d = signedDistance(frame, position3d(point));
    return Math.abs(d) < frame.faceWidth * 0.015 ? 0 : Math.sign(d) * frame.leftSign;
  }

  function rememberSide() {
    if (!selected) return;
    const side = sideOf(style.lines[selected.line].points[selected.point]);
    if (side) lastSide = side;
  }

  // ---- Zoom ------------------------------------------------------------------
  // Zwei Finger: zoomen und verschieben. Ein Finger auf freier Fläche: verschieben
  // (nur wenn gezoomt). Die Zeichenfläche wird dazu per CSS vergrössert und verschoben;
  // alle Umrechnungen lesen die echte Lage vom Bildschirm ab und stimmen darum weiter.
  const MAX_ZOOM = 6;
  let zoom = 1;
  let panX = 0; // Verschiebung in Bildschirm-Pixeln
  let panY = 0;

  function applyView() {
    const box = stage.getBoundingClientRect();
    const w = parseFloat(canvas.style.width) || 0;
    const h = parseFloat(canvas.style.height) || 0;
    // Nicht weiter verschieben, als das vergrösserte Foto über den Rand hinausragt.
    const maxX = Math.max(0, (w * zoom - box.width) / 2);
    const maxY = Math.max(0, (h * zoom - box.height) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function setZoom(value) {
    zoom = Math.max(1, Math.min(MAX_ZOOM, value));
    if (zoom === 1) panX = panY = 0;
    applyView();
    render();
    onChange();
  }

  // ---- Finger ----------------------------------------------------------------

  const pointers = new Map(); // aktive Finger: id → { x, y } auf dem Bildschirm
  let pinch = null; // { dist, zoom, midX, midY, panX, panY }
  let panDrag = null; // { pointerId, x, y, panX, panY }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    // Hat der erste Finger eben erst einen Punkt eingefügt, war das ein Versehen.
    if (drag && drag.inserted && selected) {
      style.lines[selected.line].points.splice(selected.point, 1);
      selected = null;
    }
    drag = null;
    panDrag = null;
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      panX,
      panY,
    };
    render();
  }

  function movePinch() {
    const [a, b] = [...pointers.values()];
    const box = stage.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const next = Math.max(1, Math.min(MAX_ZOOM, (pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist));
    // Die Stelle unter den Fingern bleibt unter den Fingern.
    const k = next / pinch.zoom;
    panX = midX - cx - (pinch.midX - cx - pinch.panX) * k;
    panY = midY - cy - (pinch.midY - cy - pinch.panY) * k;
    zoom = next;
    if (zoom === 1) panX = panY = 0;
    applyView();
    render();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!hasPhoto()) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2 || drag) return;

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
      drag = { pointerId: e.pointerId, dx: q.x - p.x, dy: q.y - p.y, inserted: false };
    } else if (seg) {
      const anchor = anchorAt(p.x, p.y);
      if (anchor) {
        style.lines[seg.line].points.splice(seg.after + 1, 0, anchor);
        hit = { line: seg.line, point: seg.after + 1 };
        drag = { pointerId: e.pointerId, dx: 0, dy: 0, inserted: true };
      }
    } else if (zoom > 1) {
      // Freie Fläche und gezoomt: Foto verschieben.
      panDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, panX, panY };
    }

    selected = hit;
    rememberSide();
    render();
    onChange();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      e.preventDefault();
      movePinch();
      return;
    }
    if (panDrag && e.pointerId === panDrag.pointerId) {
      panX = panDrag.panX + e.clientX - panDrag.x;
      panY = panDrag.panY + e.clientY - panDrag.y;
      applyView();
      e.preventDefault();
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId || !selected) return;
    const p = toCanvas(e);
    const x = Math.max(0, Math.min(canvas.width, p.x + drag.dx));
    const y = Math.max(0, Math.min(canvas.height, p.y + drag.dy));
    const anchor = anchorAt(x, y);
    if (anchor) {
      style.lines[selected.line].points[selected.point] = anchor;
      drag.inserted = false; // bewegt: der neue Punkt ist gewollt
      edited = true;
    }
    e.preventDefault();
    render();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        onChange();
      }
      return;
    }
    if (panDrag && e.pointerId === panDrag.pointerId) {
      panDrag = null;
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.inserted) edited = true;
    drag = null;
    rememberSide();
    render();
    onChange();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

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
    edited = true;
    render();
    onChange();
  }

  /** Löscht die ganze Form, zu der der gewählte Punkt gehört. */
  function deleteShape() {
    if (!selected) return;
    const [removed] = style.lines.splice(selected.line, 1);
    for (const line of style.lines) if (line.partner === removed.id) delete line.partner;
    selected = null;
    edited = true;
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
    edited = true;
    render();
    onChange();
  }

  // Spiegelt die zuletzt bearbeitete Gesichtshälfte jeder sichtbaren Form auf die andere.
  // Formen über der Gesichtsmitte (z. B. Schnauzer) werden symmetrisch.
  // Formen ganz auf der Quellseite (z. B. eine Braue) überschreiben ihre Partnerform.
  function mirror() {
    if (!hasPhoto()) return;
    const frame = photo().frame;

    const mirrorPoint = (point) => {
      const r = reflect(frame, position3d(point));
      return anchorAt(r.x, r.y);
    };
    const snapToMiddle = (point) => {
      const p = position3d(point);
      const d = signedDistance(frame, p);
      return anchorAt(p.x - d * frame.n.x, p.y - d * frame.n.y) || point;
    };

    for (const { line } of visibleLines()) {
      // 1 = Quellseite (zuletzt bearbeitet), -1 = Zielseite, 0 = auf der Mitte
      const sides = line.points.map((point) => sideOf(point) * lastSide);
      const hasSource = sides.includes(1);
      const hasTarget = sides.includes(-1);

      if (hasSource && !hasTarget && !sides.includes(0)) {
        // Ganz auf der Quellseite: Partnerform auf der anderen Seite neu setzen.
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
      if (!hasSource) continue; // ganz auf der Zielseite oder nur auf der Mitte: nichts zu spiegeln

      // Über der Mitte: Quellhälfte behalten, die andere aus ihr neu aufbauen.
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
      // Offene Linie, die auf der Zielseite beginnt: die gespiegelten Punkte gehören an den Anfang.
      const mirroredFirst = !line.closed && sides[0] < 0;
      const points = mirroredFirst ? mirrored.concat(keep) : keep.concat(mirrored);
      if (points.length >= minPoints(line)) line.points = points;
    }

    selected = null;
    edited = true;
    render();
    onChange();
  }

  // Bart-Analyse über ALLE geladenen Fotos zusammen: Jedes Foto trägt die Stellen bei,
  // die es am direktesten sieht (Frontbild: Mund und Kinn, Seitenbilder: Wange und Kiefer).
  // Das Ergebnis sind Anker im Gesichtsnetz und gilt darum für jedes Foto.
  // Erste Analyse: schlägt alle Bartformen neu vor und ersetzt die bisherigen.
  // Nach eigenen Änderungen: geht von den bestehenden Formen aus und zieht nur jeden
  // Punkt an die nächste Bartkante in seiner Nähe (Feinabgleich).
  function analyze() {
    if (!hasPhoto()) return null;
    const data = photos.map((p) => ({
      width: p.image.width,
      height: p.image.height,
      data: p.image.getContext("2d").getImageData(0, 0, p.image.width, p.image.height).data,
      pixels: p.pixels,
    }));

    const beardLines = style.lines.filter((l) => l.area === "bart" && l.closed && l.enabled !== false);
    const refine = analyzed && edited && beardLines.length > 0;
    let summary;

    if (refine) {
      const result = analyzeBeard(data, beardLines.map((line) => line.points));
      result.shapes.forEach((points, i) => {
        beardLines[i].points = points;
      });
      summary = { mode: "refine", moved: result.moved || 0, photos: photos.length, used: result.used };
    } else {
      const result = analyzeBeard(data);
      const lines = result.shapes
        .map((points, i) => ({ id: `bart-${i + 1}`, group: "bart", area: "bart", closed: true, enabled: true, points }))
        .filter((line) => line.points.length >= 3);
      if (lines.length) {
        style.lines = style.lines.filter((l) => l.area !== "bart").concat(lines);
        analyzed = true;
      }
      summary = { mode: "full", count: lines.length, photos: photos.length, used: result.used };
    }

    edited = false;
    selected = null;
    render();
    onChange();
    return summary;
  }

  /** Vergisst den Analyse-Stand (nach «Zurücksetzen»): die nächste Analyse beginnt neu. */
  function resetAnalysis() {
    analyzed = false;
    edited = false;
  }

  // ---- Freigabe --------------------------------------------------------------

  /**
   * Zeichnet alle geladenen Fotos untereinander in den Behälter, jedes mit den
   * eingeschalteten Formen als feine Linie ohne Punkte und ohne dunklen Rand.
   * Der Behälter muss sichtbar sein, weil die Grösse von ihm abgelesen wird.
   */
  function renderReview(container) {
    clearReview(container);
    const boxW = container.clientWidth;
    const boxH = container.clientHeight - 28; // Platz für die Beschriftung
    photos.forEach((p, i) => {
      const view = document.createElement("canvas");
      const w = (view.width = p.image.width);
      const h = (view.height = p.image.height);
      // Jedes Foto so gross wie möglich; ein einzelnes passt ohne Scrollen.
      const scale = Math.min(boxW / w, boxH / h);
      view.style.width = `${Math.floor(w * scale)}px`;
      view.style.height = `${Math.floor(h * scale)}px`;

      const c = view.getContext("2d");
      c.drawImage(p.image, 0, 0);
      for (const { line } of visibleLines()) {
        drawLine(c, projectLine(line, p.landmarks, w, h), { width: 1.5 / scale, closed: line.closed, halo: false });
      }

      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      caption.textContent = `Foto ${i + 1}`;
      figure.append(view, caption);
      container.append(figure);
    });
    container.scrollTop = 0;
  }

  /** Gibt den Bildspeicher der Freigabe-Ansicht wieder frei. */
  function clearReview(container) {
    for (const view of container.querySelectorAll("canvas")) view.width = view.height = 0;
    container.replaceChildren();
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
    addPhotos,
    show,
    photoCount: () => photos.length,
    photoData: () => photos.slice(), // nur für den Prüfstand
    currentPhoto: () => current,
    deleteSelected,
    deleteShape,
    resetAnalysis,
    canDelete,
    addAfterSelected,
    hasSelection: () => Boolean(selected),
    mirror,
    analyze,
    zoomLevel: () => zoom,
    setZoom,
    renderReview,
    clearReview,
    refresh,
    hasPhoto,
  };
}
