// FlyLines – Linien-Modell und Projektion.
//
// Eine Linie ist eine Kette von Kontrollpunkten. Ein Kontrollpunkt speichert
// keine Bildposition, sondern seine Lage im Gesichtsnetz:
//   { tri: [a, b, c], w: [wa, wb, wc] }
// tri = drei Landmark-Indizes, w = baryzentrische Gewichte (Summe 1).
// Die Bildposition ergibt sich in jedem Kamerabild neu aus den drei Landmarks.
// So folgt die Linie Kopfdrehung und Mimik und passt auf jedes Gesicht.

// ---- Testlinie für Bauschritt 3 ---------------------------------------------
// Schnauzer-Oberkante: verläuft auf dem Landmark-Ring zwischen Nase und
// Oberlippe (92, 165, 167, 164, 393, 391, 322), in der Mitte leicht zur
// Nasenunterkante (2) hin angehoben.
export const TEST_STYLE = {
  name: "Testlinie",
  lines: [
    {
      id: "schnauzer-oben",
      area: "bart",
      points: [
        { tri: [92, 165, 186], w: [1, 0, 0] },
        { tri: [165, 167, 92], w: [1, 0, 0] },
        { tri: [167, 2, 164], w: [0.8, 0.2, 0] },
        { tri: [164, 2, 0], w: [0.7, 0.3, 0] },
        { tri: [393, 2, 164], w: [0.8, 0.2, 0] },
        { tri: [391, 393, 322], w: [1, 0, 0] },
        { tri: [322, 391, 410], w: [1, 0, 0] },
      ],
    },
  ],
};

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

/** Legt eine weiche Kurve (Catmull-Rom) durch die Punkte. */
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y
    );
  }
}

/** Zeichnet eine Linie mit dunklem Rand, damit sie auf Haut und Bart sichtbar bleibt. */
export function drawLine(ctx, pts, { color = "#35e0a1", width = 4 } = {}) {
  if (pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  tracePath(ctx, pts);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = width + 3;
  ctx.stroke();

  tracePath(ctx, pts);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
