// FlyLines Prüfstand – rechnet die Bart-Analyse der App auf echten Fotos durch.
//
//   node pruefstand/run.mjs [--name <ordner>] [--fotos <pfad>] [--start] [--raster] [--punkte]
//
// --name    Name des Ergebnisordners (Standard: «lauf»)
// --fotos   Ordner mit den Testfotos (Standard: ../flylines-testbilder neben dem Repository)
// --nur     Nur diese Dateien laden, mit Komma getrennt (z. B. --nur front.png)
// --fein    Danach einen Punkt verschieben und den Feinabgleich laufen lassen
// --start   Startformen ohne Analyse messen (Vergleichswert)
// --raster  Zusätzlich Bilder mit Prozent-Raster schreiben (zum Ablesen von Soll-Punkten)
// --soll    Zusätzlich Bilder nur mit der Soll-Kontur schreiben (zur Kontrolle)
// --punkte  Gesichtspunkte in die Bilder zeichnen
//
// Die Fotos und alle Ergebnisse bleiben im Foto-Ordner AUSSERHALB des Repositorys.
// Soll-Konturen: <fotos>/soll.json, pro Dateiname geschlossene Formen als Punkte
// in Prozent des Originalfotos: { "front.png": [ [[x, y], [x, y], …], … ] }

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const photoDir = path.resolve(option("fotos", path.join(repo, "..", "flylines-testbilder")));
const runName = option("name", "lauf");
const outDir = path.join(photoDir, "ergebnis", runName);

if (path.relative(repo, photoDir) === "" || !path.relative(repo, photoDir).startsWith("..")) {
  console.error("Der Foto-Ordner darf nicht im Repository liegen (das Repository ist öffentlich).");
  process.exit(1);
}

// ---- Kleiner Webserver für das Repository ----------------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const file = path.join(repo, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(repo)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- Messung ---------------------------------------------------------------------

// Tastet eine geschlossene Form als Catmull-Rom-Kurve ab (wie drawLine in lines.js).
function sampleClosed(points, perSegment = 16) {
  const n = points.length;
  if (n < 3) return points.slice();
  const out = [];
  const get = (k) => points[((k % n) + n) % n];
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
        toward: (p1.toward ?? 1) * u + (p2.toward ?? 1) * t,
      });
    }
  }
  return out;
}

function distances(from, to) {
  return from.map((p) => {
    let best = Infinity;
    for (const q of to) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  });
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const percentile = (v, q) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))];

/** Abstand zwischen Ergebnis und Soll in Prozent der Gesichtsbreite. */
function measure(photo, soll) {
  // Vom Ergebnis zählt nur, was der Kamera zugewandt ist; die Rückseite sieht man nicht.
  const got = photo.shapes.flatMap((s) => sampleClosed(s)).filter((p) => p.toward > -0.1);
  const want = soll.flatMap((s) => sampleClosed(s));
  if (!want.length) return null;
  if (!got.length) return { shapes: photo.shapes.length, empty: true };
  const toSoll = distances(got, want); // Ergebnis liegt daneben (zu viel gefunden)
  const fromSoll = distances(want, got); // Soll nicht getroffen (zu wenig gefunden)
  const pct = (d) => Math.round((d / photo.faceWidth) * 1000) / 10;
  return {
    shapes: photo.shapes.length,
    mittel: pct((mean(toSoll) + mean(fromSoll)) / 2),
    zuViel: pct(mean(toSoll)),
    zuWenig: pct(mean(fromSoll)),
    p95: pct(Math.max(percentile(toSoll, 0.95), percentile(fromSoll, 0.95))),
  };
}

// ---- Ablauf ----------------------------------------------------------------------

const only = option("nur", "");
const files = (await fs.readdir(photoDir))
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && (!only || only.split(",").includes(f)))
  .sort()
  .slice(0, 3);
if (!files.length) {
  console.error(`Keine Fotos in ${photoDir}`);
  process.exit(1);
}
let sollFile = {};
try {
  sollFile = JSON.parse(await fs.readFile(path.join(photoDir, "soll.json"), "utf8"));
} catch {
  console.log("Keine soll.json gefunden: Es werden nur Bilder geschrieben, keine Zahlen.");
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  browser = await chromium.launch({ channel: "msedge" });
}
const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
page.on("pageerror", (err) => console.error("Fehler in der Seite:", err.message));

try {
  await page.goto(`${base}/pruefstand/bench.html`);
  await page.waitForFunction(() => window.bench);
  await page.setInputFiles("#files", files.map((f) => path.join(photoDir, f)));
  const loaded = await page.evaluate(() => window.bench.load());
  if (loaded.length !== files.length) {
    console.log("Nicht alle Fotos geladen:", await page.evaluate(() => window.bench.messages));
  }

  const summary = await page.evaluate((start) => (start ? window.bench.defaults() : window.bench.analyze()), flag("start"));
  if (flag("fein")) console.log("Feinabgleich:", JSON.stringify(await page.evaluate(() => window.bench.refine())));
  const photos = await page.evaluate(() => window.bench.result());

  await fs.mkdir(outDir, { recursive: true });
  const rows = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const k = photo.width / photo.crop.width;
    const soll = (sollFile[photo.name] || []).map((shape) =>
      shape.map(([x, y]) => ({
        x: ((x / 100) * photo.crop.srcWidth - photo.crop.x) * k,
        y: ((y / 100) * photo.crop.srcHeight - photo.crop.y) * k,
      }))
    );
    const save = async (suffix, options) => {
      const url = await page.evaluate(([index, s, o]) => window.bench.overlay(index, s, o), [i, soll, options]);
      const file = path.join(outDir, `${path.parse(photo.name).name}${suffix}.png`);
      await fs.writeFile(file, Buffer.from(url.split(",")[1], "base64"));
    };
    await save("", { dots: flag("punkte") });
    await save("-nah", { zoom: true });
    if (flag("raster")) await save("-raster", { grid: true, lines: false, zoom: true });
    if (flag("soll")) await save("-soll", { lines: false, zoom: true });
    rows.push({ foto: photo.name, gedreht: Math.round(photo.turned * 100) / 100, ...(measure(photo, soll) || { shapes: photo.shapes.length }) });
  }

  await fs.writeFile(path.join(outDir, "messung.json"), JSON.stringify({ name: runName, summary, rows }, null, 2));
  console.log(`Lauf «${runName}»:`, JSON.stringify(summary));
  console.table(rows);
  console.log("Abstände in Prozent der Gesichtsbreite. Bilder:", outDir);
} finally {
  await browser.close();
  server.close();
}
