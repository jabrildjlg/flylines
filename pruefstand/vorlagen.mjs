// FlyLines Prüfstand – von Hand gezeichnete Bartkonturen als fertige Styles («Vorlagen»).
//
//   node pruefstand/vorlagen.mjs [--raster] [--schreiben]
//
// Liest <fotos>/vorlagen.json:
//   { "vorlage1": { "name": "Vorlage 1", "foto": "front.png",
//                   "formen": { "schnauzer": [[x, y], …], "fleck": […], "kinnbart": […] } }, … }
// Punkte in Prozent des Originalfotos. Fehlen die Formen noch, werden nur Raster-Bilder
// zum Ablesen geschrieben.
//
// Schreibt nach <fotos>/ergebnis/vorlagen/ stark vergrösserte Kontrollbilder
// (Kontur magenta, mit --raster zusätzlich Prozent-Raster und nummerierte Punkte).
// Mit --schreiben werden die Konturen mit den echten MediaPipe-Landmarks in Anker
// umgerechnet und als ../vorlagen.js für die App abgelegt.

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
const outDir = path.join(photoDir, "ergebnis", "vorlagen");
if (!path.relative(repo, photoDir).startsWith("..")) {
  console.error("Der Foto-Ordner darf nicht im Repository liegen (das Repository ist öffentlich).");
  process.exit(1);
}

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

const config = JSON.parse(await fs.readFile(path.join(photoDir, "vorlagen.json"), "utf8"));
const ORDER = ["schnauzer", "fleck", "kinnbart"];
const round = (v) => Math.round(v * 1e4) / 1e4;

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  browser = await chromium.launch({ channel: "msedge" });
}

const templates = [];
try {
  await fs.mkdir(outDir, { recursive: true });
  for (const [id, entry] of Object.entries(config)) {
    // Jede Vorlage auf einer frischen Seite: Der Editor hält höchstens drei Fotos.
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    page.on("pageerror", (err) => console.error("Fehler in der Seite:", err.message));
    await page.goto(`${base}/pruefstand/bench.html`);
    await page.waitForFunction(() => window.bench);
    await page.setInputFiles("#files", [path.join(photoDir, entry.foto)]);
    const loaded = await page.evaluate(() => window.bench.load());
    if (!loaded.length) {
      console.error(`${id}: Foto ${entry.foto} konnte nicht geladen werden.`, await page.evaluate(() => window.bench.messages));
      await page.close();
      continue;
    }
    const [photo] = await page.evaluate(() => window.bench.result());
    const k = photo.width / photo.crop.width;
    const toPx = ([x, y]) => ({
      x: ((x / 100) * photo.crop.srcWidth - photo.crop.x) * k,
      y: ((y / 100) * photo.crop.srcHeight - photo.crop.y) * k,
    });
    const names = ORDER.filter((n) => entry.formen && entry.formen[n]);
    const shapes = names.map((n) => entry.formen[n].map(toPx));

    const save = async (suffix, options, soll = shapes) => {
      const url = await page.evaluate(([s, o]) => window.bench.overlay(0, s, o), [soll, options]);
      await fs.writeFile(path.join(outDir, `${id}${suffix}.png`), Buffer.from(url.split(",")[1], "base64"));
    };

    // Ausschnitte in Prozent des Originalfotos: aus den Formen, sonst aus der Vorgabe «ausschnitt».
    const views = entry.ausschnitte || {};
    for (const [view, zoom] of Object.entries(views)) {
      if (flag("raster")) await save(`-${view}-raster`, { zoom, grid: true, lines: false, marks: true });
      await save(`-${view}`, { zoom, lines: false });
    }
    await save("-ganz", { lines: false });

    if (shapes.length) {
      // Umrechnen in Anker und zur Kontrolle zurück aufs Foto projizieren (grün über magenta).
      const anchors = await page.evaluate((s) => window.bench.anchorsFor(0, s), shapes);
      await page.evaluate((a) => window.bench.setBeard(a), anchors);
      const [back] = await page.evaluate(() => window.bench.result());
      let worst = 0;
      back.shapes.forEach((shape, i) =>
        shape.forEach((p, j) => {
          worst = Math.max(worst, Math.hypot(p.x - shapes[i][j].x, p.y - shapes[i][j].y));
        })
      );
      for (const [view, zoom] of Object.entries(views)) await save(`-${view}-anker`, { zoom, lines: true });
      console.log(`${id}: ${names.map((n, i) => `${n} ${shapes[i].length} Punkte`).join(", ")}; grösste Abweichung nach der Umrechnung ${(worst / photo.faceWidth * 100).toFixed(3)} % der Gesichtsbreite`);
      templates.push({
        id,
        name: entry.name || id,
        lines: names.map((n, i) => ({
          id: `${id}-${n}`,
          group: "bart",
          area: "bart",
          closed: true,
          enabled: true,
          points: anchors[i].map((a) => ({ tri: a.tri, w: a.w.map(round) })),
        })),
      });
    } else {
      console.log(`${id}: noch keine Formen, nur Bilder geschrieben.`);
    }
    await page.close();
  }

  if (flag("schreiben") && templates.length) {
    const body = templates
      .map((t) => {
        const lines = t.lines
          .map((l) => `      {\n        id: ${JSON.stringify(l.id)}, group: "bart", area: "bart", closed: true, enabled: true,\n        points: [\n${l.points.map((p) => `          { tri: [${p.tri.join(", ")}], w: [${p.w.join(", ")}] },`).join("\n")}\n        ],\n      },`)
          .join("\n");
        return `  {\n    id: ${JSON.stringify(t.id)},\n    name: ${JSON.stringify(t.name)},\n    lines: [\n${lines}\n    ],\n  },`;
      })
      .join("\n");
    const text = `// FlyLines – fertige Styles («Vorlagen»): von Hand nachgezeichnete Bartkonturen.\n// ERZEUGT von pruefstand/vorlagen.mjs --schreiben, nicht von Hand ändern.\n// Jeder Punkt ist ein Anker im Gesichtsnetz (Dreieck plus Gewichte), wie im Editor.\n\nexport const BEARD_TEMPLATES = [\n${body}\n];\n`;
    await fs.writeFile(path.join(repo, "vorlagen.js"), text);
    console.log(`vorlagen.js geschrieben (${templates.length} Vorlagen).`);
  }
  console.log("Bilder:", outDir);
} finally {
  await browser.close();
  server.close();
}
