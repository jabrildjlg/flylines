// FlyLines – Bart-Analyse: schlägt aus bis zu drei Fotos die Umrisse des Barts vor.
// Funktioniert für jede Bartform, weil sie nicht nach bestimmten Formen sucht,
// sondern nach Barthaar auf der ganzen unteren Gesichtshälfte.
//
// Prinzip (ohne KI), an echten Fotos entwickelt:
// Barthaar ist FARBLOSER als Haut (wenig Farbsättigung) und dabei nicht heller.
// Das trennt Bart von Schatten: Ein Schatten auf der Haut ist zwar dunkel, behält
// aber die Hautfarbe. Reine Helligkeit verwechselt beides, darum zählt hier die Farbe.
//
// Ablauf:
// 1. Erlaubte Fläche: untere Gesichtshälfte innerhalb des Gesichtsnetzes,
//    ohne Lippen und ohne Nase (Nasenlöcher sind auch dunkel und farblos).
// 2. Jede Stelle über das Gesichtsnetz in allen Fotos nachschlagen. Pro Foto die
//    Hautfarbe an den Wangen messen und ausrechnen, wie viel Farbe an der Stelle fehlt.
//    Fotos, die eine Stelle schräg oder gar nicht sehen, zählen weniger.
// 3. Schwelle zwischen «Haut» und «Bart» automatisch bestimmen (Otsu).
// 4. Kleine Flecken entfernen, jede zusammenhängende Fläche und jedes Loch darin
//    (z. B. der Mund in einem Vollbart) als Umriss zurückgeben.
//
// Das Ergebnis ist ein Vorschlag, den der Nutzer prüft und nachzieht.

const RING = [57, 186, 92, 165, 167, 164, 393, 391, 322, 410, 287]; // Ring über der Oberlippe
const LIP_UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]; // Oberkante Oberlippe
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
// Gesichtsrand von der einen Wange über das Kinn zur anderen.
const OVAL_LOW = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];

const GRID_WIDTH = 360; // Rechenraster über die untere Gesichtshälfte

// ---- Farbe ---------------------------------------------------------------------

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = toLinear(i);
const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB → Helligkeit L (0–100) und Farbstärke C (Chroma) im Lab-Farbraum. */
function lightnessChroma(r, g, b) {
  const R = LINEAR[r], G = LINEAR[g], B = LINEAR[b];
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  return [116 * fy - 16, Math.hypot(a, bb)];
}

function sampleLC(photo, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= photo.width || yi >= photo.height) return null;
  const i = (yi * photo.width + xi) * 4;
  return lightnessChroma(photo.data[i], photo.data[i + 1], photo.data[i + 2]);
}

const median = (values) => {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
};

// Hautfarbe in einem kleinen Kreis: Referenz für «Haut» in diesem Foto.
function skinLevel(photo, cx, cy, radius) {
  const ls = [];
  const cs = [];
  const r = Math.max(2, Math.round(radius));
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      if (dx * dx + dy * dy > r * r) continue;
      const v = sampleLC(photo, cx + dx, cy + dy);
      if (v) {
        ls.push(v[0]);
        cs.push(v[1]);
      }
    }
  }
  return ls.length ? { l: median(ls), c: median(cs) } : null;
}

// ---- Geometrie -----------------------------------------------------------------

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const faceWidthOf = (px) => Math.hypot(px[454].x - px[234].x, px[454].y - px[234].y);

// Wangenpunkte links und rechts (zwischen äusserem Augenwinkel und Mundwinkel).
const cheeks = (px) => [mix(px[33], px[61], 0.45), mix(px[263], px[291], 0.45)];

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// Vergrössert (factor > 1) oder verkleinert ein Vieleck um seinen Mittelpunkt.
function scalePolygon(poly, factor) {
  const c = centroid(poly);
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
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

// Erlaubte Fläche im Bezugsfoto: untere Gesichtshälfte ohne Lippen und Nase.
export function regions(px) {
  // Etwas vom Gesichtsrand weg, wo Hintergrund und Kieferschatten stören.
  const face = scalePolygon(OVAL_LOW.map((i) => px[i]), 0.96);
  const lips = scalePolygon(LIPS.map((i) => px[i]), 1.08);

  // Nase: alles oberhalb einer Linie knapp unter der Nase, zwischen den Nasenflügeln.
  const under = [];
  for (let i = 1; i <= 9; i++) {
    const a = px[RING[i]];
    const b = px[LIP_UP[i]];
    const k = i >= 3 && i <= 7 ? 0.8 : 1.2;
    under.push({ x: a.x + k * (a.x - b.x), y: a.y + k * (a.y - b.y) });
  }
  const height = Math.hypot(px[10].x - px[152].x, px[10].y - px[152].y) || 1;
  const up = { x: (px[10].x - px[152].x) / height, y: (px[10].y - px[152].y) / height };
  const first = under[0];
  const last = under[under.length - 1];
  const nose = under.concat([
    { x: last.x + up.x * height, y: last.y + up.y * height },
    { x: first.x + up.x * height, y: first.y + up.y * height },
  ]);
  return { face, lips, nose };
}

// ---- Bildverarbeitung auf dem Rechenraster ---------------------------------------

// Automatische Schwelle (Otsu) zwischen heller und dunkler Gruppe, Werte in 0–1.
function otsu(values) {
  const bins = 64;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
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
  return { threshold: (bestT + 1) / bins, low: (m0 + 0.5) / bins, high: (m1 + 0.5) / bins };
}

// Zusammenhängende Flächen einer Maske (4er-Nachbarschaft).
function components(mask, w, h) {
  const label = new Int32Array(w * h);
  const list = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = list.length + 1;
    let size = 0;
    let border = false;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w); }
    }
    list.push({ id, size, border });
  }
  return { label, list };
}

// Entfernt Sprenkel und dünne Fäden: erst schrumpfen, dann wieder wachsen (3×3).
function open3(mask, w, h) {
  const step = (src, grow) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let all = 1, any = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : 0;
            if (v) any = 1;
            else all = 0;
          }
        }
        out[y * w + x] = grow ? any : all;
      }
    }
    return out;
  };
  return step(step(mask, false), true);
}

// Schliesst kleine Lücken zwischen nahen Flächen: erst wachsen, dann schrumpfen (je 3 Schritte).
function close5(mask, w, h) {
  const step = (src, grow) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let all = 1, any = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : grow ? 0 : 1;
            if (v) any = 1;
            else all = 0;
          }
        }
        out[y * w + x] = grow ? any : all;
      }
    }
    return out;
  };
  const grown = step(step(step(mask, true), true), true);
  return step(step(step(grown, false), false), false);
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

  for (let eps = 1.0; eps < 40; eps *= 1.3) {
    const a = reduce(halfA, eps);
    const b = reduce(halfB, eps);
    const merged = a.slice(0, -1).concat(b.slice(0, -1));
    if (merged.length <= maxPoints) return merged;
  }
  return [points[0], points[far]];
}

// ---- Analyse ---------------------------------------------------------------------

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray,pixels:{x:number,y:number}[],tris:number[][]}[]} photos
 * @param {number} refIndex  Foto, in dessen Bild die Umrisse zurückgegeben werden (am besten das frontale)
 * @param {{x:number,y:number}[][]} [current]  Bestehende Umrisse im Bezugsfoto. Sind sie angegeben,
 *        wird nichts neu erfunden: Jeder Punkt wird nur an die nächste Bartkante in seiner Nähe gezogen.
 * @returns {{shapes: {x:number,y:number}[][], moved?: number}}  geschlossene Umrisse in Pixeln des Bezugsfotos
 */
export function analyzeBeard(photos, refIndex, current = null) {
  const ref = photos[refIndex];
  const px0 = ref.pixels;
  const { face, lips, nose } = regions(px0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of face) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const g = Math.min(1, GRID_WIDTH / (maxX - minX));
  const gw = Math.max(8, Math.ceil((maxX - minX) * g) + 2);
  const gh = Math.max(8, Math.ceil((maxY - minY) * g) + 2);
  // Ein Rasterpunkt Rand rundherum, damit Flächen nie den Rasterrand berühren.
  const refX = (gx) => minX + (gx - 1 + 0.5) / g;
  const refY = (gy) => minY + (gy - 1 + 0.5) / g;

  const allowed = new Uint8Array(gw * gh);
  let allowedCount = 0;
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      const x = refX(gx);
      const y = refY(gy);
      if (insidePolygon(face, x, y) && !insidePolygon(lips, x, y) && !insidePolygon(nose, x, y)) {
        allowed[gy * gw + gx] = 1;
        allowedCount++;
      }
    }
  }
  if (allowedCount < 200) return { shapes: [] };

  // Pro Foto: Hautfarbe links/rechts und Grössenverhältnis zum Bezugsfoto.
  const refCheeks = cheeks(px0);
  const refWidth = faceWidthOf(px0);
  const info = photos.map((photo) => {
    const [l, r] = cheeks(photo.pixels);
    const radius = faceWidthOf(photo.pixels) * 0.035;
    let left = skinLevel(photo, l.x, l.y, radius);
    let right = skinLevel(photo, r.x, r.y, radius);
    left = left || right;
    right = right || left;
    const scale = faceWidthOf(photo.pixels) / refWidth;
    return { left, right, scale2: scale * scale };
  });

  const area = (px, t) =>
    (px[t[1]].x - px[t[0]].x) * (px[t[2]].y - px[t[0]].y) - (px[t[2]].x - px[t[0]].x) * (px[t[1]].y - px[t[0]].y);

  // Wie viel Farbe fehlt an jeder Stelle gegenüber der Haut? 0 = Haut, gegen 1 = farblos.
  // Dreieck für Dreieck über das Raster gehen: so ist für jeden Rasterpunkt sofort
  // bekannt, welche Stelle des Gesichtsnetzes er ist.
  const score = new Float32Array(gw * gh);
  const done = new Uint8Array(gw * gh);
  const cdx = refCheeks[1].x - refCheeks[0].x;
  const cdy = refCheeks[1].y - refCheeks[0].y;
  const cl = cdx * cdx + cdy * cdy || 1;

  for (const tri of ref.tris) {
    const A = px0[tri[0]], B = px0[tri[1]], C = px0[tri[2]];
    const refArea = area(px0, tri);
    if (Math.abs(refArea) < 1e-6) continue;
    const gx0 = Math.max(1, Math.floor((Math.min(A.x, B.x, C.x) - minX) * g + 1));
    const gx1 = Math.min(gw - 2, Math.ceil((Math.max(A.x, B.x, C.x) - minX) * g + 1));
    const gy0 = Math.max(1, Math.floor((Math.min(A.y, B.y, C.y) - minY) * g + 1));
    const gy1 = Math.min(gh - 2, Math.ceil((Math.max(A.y, B.y, C.y) - minY) * g + 1));
    if (gx0 > gx1 || gy0 > gy1) continue;
    const denom = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);

    // Sichtbarkeit dieses Dreiecks pro Foto: seine Fläche im Vergleich zum Bezugsfoto.
    const vis = photos.map((photo, k) => {
      if (k === refIndex) return 1;
      const ratio = area(photo.pixels, tri) / (refArea * info[k].scale2);
      return ratio <= 0 ? 0 : Math.min(1, ratio) ** 2;
    });

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const idx = gy * gw + gx;
        if (!allowed[idx] || done[idx]) continue;
        const x = refX(gx);
        const y = refY(gy);
        const wa = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / denom;
        const wb = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / denom;
        const wc = 1 - wa - wb;
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
        done[idx] = 1;

        const side = Math.max(0, Math.min(1, ((x - refCheeks[0].x) * cdx + (y - refCheeks[0].y) * cdy) / cl));
        let sum = 0, weight = 0;
        for (let k = 0; k < photos.length; k++) {
          if (vis[k] <= 0.05 || !info[k].left) continue;
          const p = photos[k].pixels;
          const sx = wa * p[tri[0]].x + wb * p[tri[1]].x + wc * p[tri[2]].x;
          const sy = wa * p[tri[0]].y + wb * p[tri[1]].y + wc * p[tri[2]].y;
          const v = sampleLC(photos[k], sx, sy);
          if (!v) continue;
          const skinL = info[k].left.l + (info[k].right.l - info[k].left.l) * side;
          const skinC = info[k].left.c + (info[k].right.c - info[k].left.c) * side;
          // Farblos UND nicht heller als die Haut (sonst wäre es ein Glanzlicht).
          const s = v[0] < skinL * 1.02 && skinC > 1 ? Math.max(0, Math.min(1, 1 - v[1] / skinC)) : 0;
          sum += vis[k] * s;
          weight += vis[k];
        }
        if (weight > 0) score[idx] = sum / weight;
      }
    }
  }

  // Leicht weichzeichnen, damit einzelne Haare und Poren keine Löcher reissen.
  const blurred = new Float32Array(gw * gh);
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      if (!allowed[y * gw + x]) continue;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (y + dy) * gw + x + dx;
          if (allowed[i]) {
            s += score[i];
            n++;
          }
        }
      }
      blurred[y * gw + x] = s / n;
    }
  }

  const values = [];
  for (let i = 0; i < gw * gh; i++) if (allowed[i]) values.push(blurred[i]);
  const o = otsu(values);
  // Ohne klaren Unterschied zwischen Haut und Bart gibt es keinen Vorschlag.
  if (o.high - o.low < 0.12) return { shapes: [] };
  // Etwas unter der Mitte zwischen beiden Gruppen: so bleiben helle, dünne Enden
  // (z. B. die Spitzen eines Schnauzers) dabei, ohne dass Schatten mitkommen.
  const threshold = Math.max(0.15, o.low + 0.42 * (o.high - o.low));

  let mask = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) if (allowed[i] && blurred[i] >= threshold) mask[i] = 1;
  mask = close5(open3(mask, gw, gh), gw, gh);
  for (let i = 0; i < gw * gh; i++) if (!allowed[i]) mask[i] = 0;

  // Feinabgleich bestehender Umrisse: jeden Punkt an die nächste Bartkante ziehen,
  // wenn eine in der Nähe liegt (rund 3,5 % der Gesichtsbreite). Sonst bleibt er.
  if (current) {
    const reach = Math.max(3, Math.round(refWidth * 0.035 * g));
    const isEdge = (x, y) => {
      if (x < 1 || y < 1 || x >= gw - 1 || y >= gh - 1 || !mask[y * gw + x]) return false;
      return !mask[y * gw + x - 1] || !mask[y * gw + x + 1] || !mask[(y - 1) * gw + x] || !mask[(y + 1) * gw + x];
    };
    let moved = 0;
    const shapes = current.map((points) =>
      points.map((p) => {
        const cx = Math.round((p.x - minX) * g + 0.5);
        const cy = Math.round((p.y - minY) * g + 0.5);
        let best = null;
        let bestDist = reach + 0.5;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const d = Math.hypot(dx, dy);
            if (d < bestDist && isEdge(cx + dx, cy + dy)) {
              bestDist = d;
              best = { x: refX(cx + dx), y: refY(cy + dy) };
            }
          }
        }
        if (best && bestDist > 0.5) moved++;
        return best || p;
      })
    );
    return { shapes, moved };
  }

  // Bartflächen: alles, was gross genug ist.
  const minArea = Math.max(40, allowedCount * 0.005);
  const beard = components(mask, gw, gh);
  const keep = new Uint8Array(gw * gh);
  const shapes = [];
  const outline = (label, id) => {
    const single = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) if (label[i] === id) single[i] = 1;
    const contour = traceContour(single, gw, gh);
    if (contour.length < 8) return;
    const maxPoints = Math.max(6, Math.min(22, Math.round(contour.length / 12)));
    const pts = simplifyClosed(contour, maxPoints);
    if (pts.length >= 3) shapes.push(pts.map((p) => ({ x: refX(p.x), y: refY(p.y) })));
  };
  for (const c of beard.list) {
    if (c.size < minArea) continue;
    for (let i = 0; i < gw * gh; i++) if (beard.label[i] === c.id) keep[i] = 1;
    outline(beard.label, c.id);
  }

  // Löcher im Bart (z. B. der Mund in einem Vollbart): Flächen ohne Bart, die
  // ganz von Bart umschlossen sind.
  const inverse = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) inverse[i] = keep[i] ? 0 : 1;
  const holes = components(inverse, gw, gh);
  for (const c of holes.list) {
    if (c.border || c.size < minArea * 2) continue;
    outline(holes.label, c.id);
  }

  return { shapes };
}
