// FlyLines – Geometrie für den Linien-Editor:
// Dreiecksnetz über den Gesichtspunkten, Lage eines Punkts im Netz, Spiegelung.

// ---- Dreiecksnetz (Delaunay, Bowyer-Watson) ----------------------------------

function circumcircle(pts, a, b, c) {
  const A = pts[a];
  const B = pts[b];
  const C = pts[c];
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(d) < 1e-12) {
    // Drei Punkte auf einer Geraden: gilt immer als «schlecht» und wird ersetzt.
    return { a, b, c, cx: 0, cy: 0, r2: Infinity };
  }
  const a2 = A.x * A.x + A.y * A.y;
  const b2 = B.x * B.x + B.y * B.y;
  const c2 = C.x * C.x + C.y * C.y;
  const cx = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
  const cy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
  const dx = A.x - cx;
  const dy = A.y - cy;
  return { a, b, c, cx, cy, r2: dx * dx + dy * dy };
}

/**
 * Legt ein Dreiecksnetz über die Punkte.
 * @param {{x:number,y:number}[]} points
 * @returns {number[][]} Dreiecke als [a, b, c] (Indizes in points)
 */
export function delaunay(points) {
  const n = points.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const pts = points.concat([
    { x: mx - 20 * size, y: my - size },
    { x: mx, y: my + 20 * size },
    { x: mx + 20 * size, y: my - size },
  ]);

  let tris = [circumcircle(pts, n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const edges = new Map();
    const keep = [];
    const addEdge = (u, v) => {
      const key = u < v ? u * 100000 + v : v * 100000 + u;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { u, v, count: 1 });
    };
    for (const t of tris) {
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      if (dx * dx + dy * dy < t.r2) {
        addEdge(t.a, t.b);
        addEdge(t.b, t.c);
        addEdge(t.c, t.a);
      } else {
        keep.push(t);
      }
    }
    tris = keep;
    for (const e of edges.values()) {
      if (e.count === 1) tris.push(circumcircle(pts, e.u, e.v, i));
    }
  }
  return tris
    .filter((t) => t.a < n && t.b < n && t.c < n && Number.isFinite(t.r2))
    .map((t) => [t.a, t.b, t.c]);
}

// ---- Lage eines Punkts im Netz -------------------------------------------------

function barycentric(x, y, A, B, C) {
  const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
  if (Math.abs(d) < 1e-12) return null;
  const wa = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / d;
  const wb = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / d;
  return [wa, wb, 1 - wa - wb];
}

/**
 * Sucht das Dreieck, in dem (x, y) liegt, und gibt den Anker { tri, w } zurück.
 * Liegt der Punkt ausserhalb des Netzes, wird das nächstliegende Dreieck
 * genommen; die Gewichte dürfen dann leicht negativ sein.
 */
export function locate(tris, points, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const tri of tris) {
    const A = points[tri[0]];
    const B = points[tri[1]];
    const C = points[tri[2]];
    const w = barycentric(x, y, A, B, C);
    if (!w) continue;
    if (Math.min(w[0], w[1], w[2]) >= -1e-9) return { tri: tri.slice(), w };
    const dist = Math.hypot((A.x + B.x + C.x) / 3 - x, (A.y + B.y + C.y) / 3 - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { tri: tri.slice(), w };
    }
  }
  return best;
}

// ---- Spiegelung an der Gesichtsmitte -------------------------------------------

// Sicher bekannte Landmark-Paare (links/rechts) und Punkte auf der Mittellinie.
const PAIRS = [[33, 263], [133, 362], [61, 291], [234, 454]];
const MIDLINE = [10, 168, 6, 1, 2, 164, 0, 17, 152];

/**
 * Bestimmt die Spiegelebene des Gesichts (Mitte zwischen linker und rechter Hälfte)
 * aus den 3D-Gesichtspunkten. So stimmt die Spiegelung auch bei leicht gedrehtem Kopf.
 * @param {{x:number,y:number,z:number}[]} p3 Gesichtspunkte in Pixeln (z wie x skaliert)
 */
export function sagittalFrame(p3) {
  const n = { x: 0, y: 0, z: 0 };
  for (const [l, r] of PAIRS) {
    const dx = p3[r].x - p3[l].x;
    const dy = p3[r].y - p3[l].y;
    const dz = p3[r].z - p3[l].z;
    const len = Math.hypot(dx, dy, dz) || 1;
    n.x += dx / len;
    n.y += dy / len;
    n.z += dz / len;
  }
  const nl = Math.hypot(n.x, n.y, n.z) || 1;
  n.x /= nl;
  n.y /= nl;
  n.z /= nl;

  const c = { x: 0, y: 0, z: 0 };
  for (const i of MIDLINE) {
    c.x += p3[i].x;
    c.y += p3[i].y;
    c.z += p3[i].z;
  }
  c.x /= MIDLINE.length;
  c.y /= MIDLINE.length;
  c.z /= MIDLINE.length;

  const faceWidth = Math.hypot(
    p3[454].x - p3[234].x,
    p3[454].y - p3[234].y,
    p3[454].z - p3[234].z
  );
  // Vorzeichen der Seite, die im Bild links liegt.
  const leftIdx = p3[234].x < p3[454].x ? 234 : 454;
  const leftSign = Math.sign(signedDistance({ n, c }, p3[leftIdx])) || 1;

  return { n, c, faceWidth, leftSign };
}

/** Abstand eines Punkts zur Spiegelebene, mit Vorzeichen für die Seite. */
export function signedDistance(frame, p) {
  return (
    (p.x - frame.c.x) * frame.n.x +
    (p.y - frame.c.y) * frame.n.y +
    (p.z - frame.c.z) * frame.n.z
  );
}

/** Spiegelt einen Punkt an der Gesichtsmitte. */
export function reflect(frame, p) {
  const d = signedDistance(frame, p);
  return {
    x: p.x - 2 * d * frame.n.x,
    y: p.y - 2 * d * frame.n.y,
    z: p.z - 2 * d * frame.n.z,
  };
}
