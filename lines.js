// FlyLines – Linien-Modell und Projektion.
//
// Eine Linie ist eine Kette von Kontrollpunkten. Ein Kontrollpunkt speichert
// keine Bildposition, sondern seine Lage im Gesichtsnetz:
//   { tri: [a, b, c], w: [wa, wb, wc] }
// tri = drei Landmark-Indizes, w = baryzentrische Gewichte (Summe 1).
// Die Bildposition ergibt sich in jedem Kamerabild neu aus den drei Landmarks.
// So folgt die Linie Kopfdrehung und Mimik und passt auf jedes Gesicht.

// ---- Startformen ---------------------------------------------------------------
// Standardformen, die der Nutzer im Editor auf dem Vorzeigebild zurechtzieht.
// Alle Formen sind geschlossene Umrisse (closed: true).
//
// at(i): Punkt genau auf Landmark i.
// lift(a, b, k): Punkt auf a, um den Anteil k von b weg verschoben (a + k·(a − b)).
const at = (i) => ({ tri: [i, i, i], w: [1, 0, 0] });
const lift = (a, b, k) => ({ tri: [a, b, a], w: [1 + k, -k, 0] });

export const DEFAULT_STYLE = {
  name: "Schnauzer und Goatee",
  lines: [
    {
      // Oberkante: Landmark-Ring über der Oberlippe (57 … 287), zur Nase hin angehoben.
      // Unterkante: Oberkante der Oberlippe (291 … 61).
      id: "schnauzer",
      group: "schnauzer",
      area: "bart",
      closed: true,
      enabled: true,
      points: [
        at(57), lift(92, 40, 0.1), lift(167, 37, 0.3), lift(164, 0, 0.35),
        lift(393, 267, 0.3), lift(322, 270, 0.1), at(287),
        at(291), at(269), at(0), at(39), at(61),
      ],
    },
    {
      // Oben: Ring unter der Unterlippe (182, 83, 18, 313, 406). Unten: Kinnkante (400, 152, 176).
      id: "goatee",
      group: "goatee",
      area: "bart",
      closed: true,
      enabled: true,
      points: [at(182), at(83), at(18), at(313), at(406), at(400), at(152), at(176)],
    },
    {
      // Im Foto linke Augenbraue: Oberkante aussen → innen, Unterkante innen → aussen.
      id: "braue-a",
      group: "brauen",
      area: "augenbrauen",
      partner: "braue-b",
      closed: true,
      enabled: true,
      points: [at(70), at(63), at(105), at(66), at(107), at(55), at(65), at(52), at(53), at(46)],
    },
    {
      id: "braue-b",
      group: "brauen",
      area: "augenbrauen",
      partner: "braue-a",
      closed: true,
      enabled: true,
      points: [at(300), at(293), at(334), at(296), at(336), at(285), at(295), at(282), at(283), at(276)],
    },
  ],
};

export const GROUPS = [
  { key: "schnauzer", label: "Schnauzer" },
  { key: "goatee", label: "Goatee" },
  { key: "brauen", label: "Brauen" },
];

// ---- Projektion --------------------------------------------------------------

/** Rechnet einen Kontrollpunkt in Pixel der Zeichenfläche um. */
export function projectPoint(point, landmarks, width, height) {
  const [a, b, c] = point.tri;
  const [wa, wb, wc] = point.w;
  const A = landmarks[a];
  const B = landmarks[b];
  const C = landmarks[c];
  return {
    x: (wa * A.x + wb * B.x + wc * C.x) * width,
    y: (wa * A.y + wb * B.y + wc * C.y) * height,
  };
}

/** Rechnet alle Kontrollpunkte einer Linie in Pixel um. */
export function projectLine(line, landmarks, width, height) {
  return line.points.map((p) => projectPoint(p, landmarks, width, height));
}

// ---- Glättung (One-Euro-Filter) ----------------------------------------------
// Dämpft das Zittern bei ruhigem Kopf stark und bei schnellen Bewegungen kaum,
// damit die Linie nicht hinterherhinkt.

class LowPass {
  constructor() {
    this.value = null;
  }
  filter(value, alpha) {
    this.value = this.value === null ? value : alpha * value + (1 - alpha) * this.value;
    return this.value;
  }
}

function alphaFor(cutoffHz, dtSeconds) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.02, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastValue = null;
    this.lastTime = null;
  }

  /** @param {number} value Messwert  @param {number} timeMs Zeitstempel in Millisekunden */
  filter(value, timeMs) {
    if (this.lastTime === null) {
      this.lastTime = timeMs;
      this.lastValue = value;
      return this.x.filter(value, 1);
    }
    const dt = Math.max((timeMs - this.lastTime) / 1000, 1e-3);
    const speed = this.dx.filter((value - this.lastValue) / dt, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(speed);
    this.lastTime = timeMs;
    this.lastValue = value;
    return this.x.filter(value, alphaFor(cutoff, dt));
  }
}

/** Glättet die projizierten Punkte aller Linien eines Styles. */
export class StyleSmoother {
  constructor(options) {
    this.options = options;
    this.filters = new Map();
  }

  reset() {
    this.filters.clear();
  }

  smooth(lineId, points, timeMs) {
    return points.map((p, i) => {
      const key = `${lineId}:${i}`;
      let f = this.filters.get(key);
      if (!f) {
        f = { x: new OneEuro(this.options), y: new OneEuro(this.options) };
        this.filters.set(key, f);
      }
      return { x: f.x.filter(p.x, timeMs), y: f.y.filter(p.y, timeMs) };
    });
  }
}

// ---- Zeichnen ----------------------------------------------------------------

/** Legt eine weiche Kurve (Catmull-Rom) durch die Punkte, offen oder geschlossen. */
function tracePath(ctx, pts, closed, begin = true) {
  const n = pts.length;
  const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  if (begin) ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y
    );
  }
  if (closed) ctx.closePath();
}

/**
 * Zeichnet eine Linie oder Form: dünne farbige Linie mit dunklem Rand, damit sie
 * auf Haut und Bart sichtbar bleibt. Mit fill wird die Form halb durchsichtig gefüllt.
 */
export function drawLine(ctx, pts, { color = "#35e0a1", width = 2, closed = false, fill = false } = {}) {
  if (pts.length < 2) return;
  const isClosed = closed && pts.length >= 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  tracePath(ctx, pts, isClosed);
  if (fill && isClosed) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.lineWidth = width * 2.2;
  ctx.stroke();

  tracePath(ctx, pts, isClosed);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Ansicht «Zone»: Die Form selbst bleibt frei, damit der Bart darin unverdeckt
 * sichtbar ist. Direkt ausserhalb liegt ein roter Streifen: Was dort wächst, kommt weg.
 * Die Schnittkante ist die Innenkante des Streifens, markiert mit einer Haarlinie.
 *
 * @param {{x:number,y:number}[][]} shapes  geschlossene Formen in Pixeln
 * @param {object} o
 * @param {number} o.band   Breite des Streifens in Pixeln
 * @param {number} o.width  Breite der Haarlinie in Pixeln
 */
export function drawZones(ctx, shapes, { band = 20, width = 1.5, color = "#35e0a1" } = {}) {
  const closed = shapes.filter((pts) => pts.length >= 3);
  if (!closed.length) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Nur ausserhalb aller Formen zeichnen.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  for (const pts of closed) tracePath(ctx, pts, true, false);
  ctx.clip("evenodd");
  ctx.strokeStyle = "rgba(255, 64, 64, 0.34)";
  ctx.lineWidth = band * 2;
  for (const pts of closed) {
    tracePath(ctx, pts, true);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const pts of closed) {
    tracePath(ctx, pts, true);
    ctx.stroke();
  }
}
