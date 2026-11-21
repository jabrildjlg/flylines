// FlyLines – Bart-Analyse: schlägt aus bis zu drei Fotos die Umrisse von
// Schnauzer und Goatee vor.
//
// Prinzip (ohne KI): Barthaare sind dunkler als die Haut daneben.
// 1. Suchfelder über dem Mund (Schnauzer) und unter dem Mund (Goatee) aus
//    Gesichtspunkten bilden. Lippen und Nase liegen ausserhalb.
// 2. Jede Stelle der Suchfelder in allen Fotos nachschlagen. Das geht, weil das
//    Gesichtsnetz dieselbe Hautstelle in jedem Foto wiederfindet.
// 3. Pro Foto die Hauthelligkeit an den Wangen messen und für jede Stelle
//    ausrechnen, wie viel dunkler sie ist. Fotos, die eine Stelle schräg oder gar
//    nicht sehen, zählen weniger.
// 4. Schwelle zwischen «Haut» und «Bart» automatisch bestimmen, grösste
//    zusammenhängende Fläche nehmen, Umriss vereinfachen.
//
// Das Ergebnis ist ein Vorschlag. Schatten, wenig Kontrast (Stoppeln, dunkle Haut,
// schlechtes Licht) und Haare im Gesicht führen zu Fehlern.

import { locate } from "./geometry.js?v=8";

const RING = [57, 186, 92, 165, 167, 164, 393, 391, 322, 410, 287]; // Ring über der Oberlippe
const LIP_UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]; // Oberkante Oberlippe
const LIP_LOW = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]; // Unterkante Unterlippe
const JAW = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]; // Kieferlinie

const GRID_WIDTH = 260; // Rechenraster über beide Suchfelder
const MAX_POINTS = 14; // höchstens so viele Punkte pro Umriss

const luminance = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function sample(photo, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= photo.width || yi >= photo.height) return -1;
  return luminance(photo.data, (yi * photo.width + xi) * 4);
}

// Mittlere Helligkeit (Median) in einem kleinen Kreis: Referenz für «Haut».
function skinLevel(photo, cx, cy, radius) {
  const values = [];
  const r = Math.max(2, Math.round(radius));
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      if (dx * dx + dy * dy > r * r) continue;
      const v = sample(photo, cx + dx, cy + dy);
      if (v >= 0) values.push(v);
    }
  }
  if (!values.length) return -1;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const faceWidthOf = (px) => Math.hypot(px[454].x - px[234].x, px[454].y - px[234].y);

// Wangenpunkte links und rechts (zwischen äusserem Augenwinkel und Mundwinkel).
function cheeks(px) {
  return [mix(px[33], px[61], 0.45), mix(px[263], px[291], 0.45)];
}

function insidePolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Suchfelder im Bezugsfoto.
function searchFields(px) {
  const top = RING.map((r, i) => {
    const a = px[r];
    const b = px[LIP_UP[i]];
    // In der Mitte knapp unter der Nase bleiben (Schatten der Nasenlöcher),
    // seitlich grosszügiger, damit die Enden des Schnauzers im Feld liegen.
    const k = i >= 3 && i <= 7 ? 0.8 : 1.2;
    return { x: a.x + k * (a.x - b.x), y: a.y + k * (a.y - b.y) };
  });
  const lipTop = LIP_UP.map((i) => px[i]).reverse();
  const lipBottom = LIP_LOW.map((i) => px[i]);
  const jaw = JAW.map((i) => px[i]).reverse();
  return { schnauzer: top.concat(lipTop), goatee: lipBottom.concat(jaw) };
}

// Automatische Schwelle (Otsu) zwischen heller und dunkler Gruppe.
function otsu(values) {
  const bins = 64;
  const max = 0.8;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor((v / max) * bins)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let w0 = 0, sum0 = 0, best = -1, bestT = 0, m0 = 0, m1 = 0;
  for (let t = 0; t < bins - 1; t++) {
    w0 += hist[t];
    sum0 += t * hist[t];
    const w1 = total - w0;
    if (!w0 || !w1) continue;
    const a = sum0 / w0;
    const b = (sumAll - sum0) / w1;
    const between = w0 * w1 * (a - b) * (a - b);
    if (between > best) {
      best = between;
      bestT = t;
      m0 = a;
      m1 = b;
    }
  }
  const scale = max / bins;
  return { threshold: (bestT + 1) * scale, low: (m0 + 0.5) * scale, high: (m1 + 0.5) * scale };
}

// Grösste zusammenhängende Fläche einer Maske (4er-Nachbarschaft).
function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  let bestId = 0, bestSize = 0, id = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    id++;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w); }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  const out = new Uint8Array(w * h);
  if (bestId) for (let i = 0; i < w * h; i++) if (label[i] === bestId) out[i] = 1;
  return { mask: out, size: bestSize };
}

// Umriss einer Fläche (Moore-Nachbarschaft), als Folge von Rasterpunkten.
function traceContour(mask, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let sx = -1, sy = -1;
  for (let i = 0; i < w * h && sx < 0; i++) if (mask[i]) { sx = i % w; sy = (i - sx) / w; }
  if (sx < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [];
  let x = sx, y = sy, dir = 0; // Start oben links: wir laufen nach rechts los, im Uhrzeigersinn
  const limit = w * h * 4;
  for (let steps = 0; steps < limit; steps++) {
    contour.push({ x, y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 5 + k) % 8; // links von der Laufrichtung beginnen
      const nx = x + dirs[d][0];
      const ny = y + dirs[d][1];
      if (at(nx, ny)) {
        x = nx;
        y = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
  }
  return contour;
}

// Vereinfacht einen geschlossenen Umriss (Douglas-Peucker) auf wenige Punkte.
function simplifyClosed(points, maxPoints) {
  if (points.length <= 3) return points;
  let far = 0, farDist = -1;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    if (d > farDist) { farDist = d; far = i; }
  });
  const halfA = points.slice(0, far + 1);
  const halfB = points.slice(far).concat([points[0]]);

  const reduce = (pts, eps) => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = pts[a].x, ay = pts[a].y;
      const bx = pts[b].x - ax, by = pts[b].y - ay;
      const len = Math.hypot(bx, by) || 1;
      let worst = -1, worstDist = eps;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i].x - ax) * by - (pts[i].y - ay) * bx) / len;
        if (d > worstDist) { worstDist = d; worst = i; }
      }
      if (worst > 0) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };

  for (let eps = 1.2; eps < 40; eps *= 1.35) {
    const a = reduce(halfA, eps);
    const b = reduce(halfB, eps);
    const merged = a.slice(0, -1).concat(b.slice(0, -1));
    if (merged.length <= maxPoints) return merged;
  }
  return [points[0], points[far]];
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray,pixels:{x:number,y:number}[],tris:number[][]}[]} photos
 * @param {number} refIndex  Foto, in dessen Bild die Umrisse zurückgegeben werden (am besten das frontale)
 * @returns {{schnauzer: {x:number,y:number}[]|null, goatee: {x:number,y:number}[]|null}}
 */
export function analyzeBeard(photos, refIndex) {
  const ref = photos[refIndex];
  const fields = searchFields(ref.pixels);
  const all = fields.schnauzer.concat(fields.goatee);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const g = Math.min(1, GRID_WIDTH / (maxX - minX));
  const gw = Math.max(4, Math.ceil((maxX - minX) * g));
  const gh = Math.max(4, Math.ceil((maxY - minY) * g));
  const toRef = (gx, gy) => ({ x: minX + (gx + 0.5) / g, y: minY + (gy + 0.5) / g });

  // Nur Dreiecke, die das Rechenraster berühren.
  const tris = ref.tris.filter((t) => {
    const xs = t.map((i) => ref.pixels[i].x);
    const ys = t.map((i) => ref.pixels[i].y);
    return Math.max(...xs) >= minX && Math.min(...xs) <= maxX && Math.max(...ys) >= minY && Math.min(...ys) <= maxY;
  });

  // Pro Foto: Hauthelligkeit links/rechts und Grössenverhältnis zum Bezugsfoto.
  const refCheeks = cheeks(ref.pixels);
  const refWidth = faceWidthOf(ref.pixels);
  const info = photos.map((photo) => {
    const [l, r] = cheeks(photo.pixels);
    const radius = faceWidthOf(photo.pixels) * 0.035;
    let left = skinLevel(photo, l.x, l.y, radius);
    let right = skinLevel(photo, r.x, r.y, radius);
    if (left < 0) left = right;
    if (right < 0) right = left;
    const scale = faceWidthOf(photo.pixels) / refWidth;
    return { left, right, scale2: scale * scale };
  });

  const area = (px, t) =>
    (px[t[1]].x - px[t[0]].x) * (px[t[2]].y - px[t[0]].y) - (px[t[2]].x - px[t[0]].x) * (px[t[1]].y - px[t[0]].y);

  // Wie viel dunkler als Haut ist jede Stelle? 0 = Haut, gegen 1 = sehr dunkel.
  const score = new Float32Array(gw * gh);
  const cx = refCheeks[1].x - refCheeks[0].x;
  const cy = refCheeks[1].y - refCheeks[0].y;
  const cl = cx * cx + cy * cy || 1;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const p = toRef(gx, gy);
      if (!insidePolygon(fields.schnauzer, p.x, p.y) && !insidePolygon(fields.goatee, p.x, p.y)) continue;
      const hit = locate(tris, ref.pixels, p.x, p.y);
      if (!hit || Math.min(hit.w[0], hit.w[1], hit.w[2]) < -0.05) continue;
      const side = Math.max(0, Math.min(1, ((p.x - refCheeks[0].x) * cx + (p.y - refCheeks[0].y) * cy) / cl));
      const refArea = area(ref.pixels, hit.tri);

      let sum = 0, weight = 0;
      photos.forEach((photo, k) => {
        const skin = info[k].left + (info[k].right - info[k].left) * side;
        if (skin <= 0) return;
        const px = photo.pixels;
        const [a, b, c] = hit.tri;
        const x = hit.w[0] * px[a].x + hit.w[1] * px[b].x + hit.w[2] * px[c].x;
        const y = hit.w[0] * px[a].y + hit.w[1] * px[b].y + hit.w[2] * px[c].y;
        const v = sample(photo, x, y);
        if (v < 0) return;
        // Sichtbarkeit: Fläche des Dreiecks in diesem Foto im Vergleich zum Bezugsfoto.
        let vis = 1;
        if (k !== refIndex && refArea) {
          const ratio = area(px, hit.tri) / (refArea * info[k].scale2);
          vis = ratio <= 0 ? 0 : Math.min(1, ratio) ** 2;
        }
        if (vis <= 0.05) return;
        sum += vis * Math.max(0, 1 - v / skin);
        weight += vis;
      });
      if (weight > 0) score[gy * gw + gx] = sum / weight;
    }
  }

  // Leicht weichzeichnen, damit einzelne Stoppeln und Poren keine Löcher reissen.
  const blurred = new Float32Array(gw * gh);
  const R = 1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          s += score[yy * gw + xx];
          n++;
        }
      }
      blurred[y * gw + x] = s / n;
    }
  }

  const outline = (field) => {
    const inField = new Uint8Array(gw * gh);
    const values = [];
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const p = toRef(gx, gy);
        if (insidePolygon(field, p.x, p.y)) {
          inField[gy * gw + gx] = 1;
          values.push(blurred[gy * gw + gx]);
        }
      }
    }
    if (values.length < 50) return null;
    const o = otsu(values);
    // Ohne klaren Unterschied zwischen heller und dunkler Gruppe gibt es keinen Vorschlag.
    if (o.high - o.low < 0.1) return null;
    // Etwas unter der Mitte zwischen beiden Gruppen, damit dünne Enden nicht abgeschnitten werden.
    const threshold = Math.max(0.08, o.low + 0.4 * (o.high - o.low));
    const mask = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) if (inField[i] && blurred[i] >= threshold) mask[i] = 1;
    const comp = largestComponent(mask, gw, gh);
    if (comp.size < values.length * 0.03) return null;
    const contour = traceContour(comp.mask, gw, gh);
    if (contour.length < 8) return null;
    return simplifyClosed(contour, MAX_POINTS).map((p) => toRef(p.x, p.y));
  };

  return { schnauzer: outline(fields.schnauzer), goatee: outline(fields.goatee) };
}
