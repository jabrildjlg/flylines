// FlyLines Prüfstand – prüft den Live-Spiegel der echten App ohne echte Kamera.
//
//   node pruefstand/kamera.mjs
//
// Der App wird ein Testfoto als Kamerabild untergeschoben (getUserMedia liefert eine
// Zeichenfläche mit dem Foto). Für jede Vorlage aus <fotos>/vorlagen.json: Vorlage auf
// dem Startbildschirm wählen, «Kamera starten», Bildschirmfoto nach
// <fotos>/ergebnis/vorlagen/kamera-<vorlage>.png.
// Zeigt, ob die Linien der gewählten Vorlage im Live-Bild erscheinen und wo sie liegen.
// Ersetzt NICHT den Test am iPhone (echte Kamera, Bildrate, Bewegung).

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Das Testfoto kommt aus dem Foto-Ordner, alles andere aus dem Repository.
  const file = url.startsWith("/__foto/") ? path.join(photoDir, url.slice(8)) : path.join(repo, url);
  if (!file.startsWith(repo) && !file.startsWith(photoDir)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const config = JSON.parse(await fs.readFile(path.join(photoDir, "vorlagen.json"), "utf8"));
const entries = Object.entries(config);

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  browser = await chromium.launch({ channel: "msedge" });
}

try {
  await fs.mkdir(outDir, { recursive: true });
  // Jede Vorlage auf jedem Frontfoto: auf dem eigenen Foto muss sie sitzen, auf dem
  // anderen zeigt sich, wie sie sich auf ein anderes Bild überträgt.
  for (const [photoId, photoEntry] of entries) {
    for (let index = 0; index < entries.length; index++) {
      const [id, entry] = entries[index];
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      page.on("pageerror", (err) => console.error("Fehler in der Seite:", err.message));
      await page.addInitScript((src) => {
        // Kamera-Ersatz: Zeichenfläche im Hochformat mit dem Foto, laufend neu gezeichnet.
        navigator.mediaDevices.getUserMedia = async () => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 720;
          canvas.height = 1280;
          const c = canvas.getContext("2d");
          const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * scale, h = img.height * scale;
          const draw = () => c.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          draw();
          setInterval(draw, 33);
          return canvas.captureStream(30);
        };
      }, `${base}/__foto/${photoEntry.foto}`);

      await page.goto(`${base}/index.html`);
      await page.click(`#templateChips .chip:nth-child(${index + 1})`);
      const chosen = await page.textContent("#templateChips .chip.on");
      await page.click("#startBtn");
      // Warten, bis das Tracking läuft (Statuszeile zeigt die Bildrate) und ein Gesicht da ist.
      await page.waitForFunction(() => /FPS/.test(document.getElementById("status").textContent) && document.getElementById("notice").hidden, null, { timeout: 90000 });
      await page.waitForTimeout(1500); // Glättung einschwingen lassen
      const status = await page.textContent("#status");
      const file = `kamera-${id}-auf-${photoId}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      console.log(`${chosen} auf Foto von ${photoId}: ${status} → ${file}`);
      await page.close();
    }
  }
  console.log("Bilder:", outDir);
} finally {
  await browser.close();
  server.close();
}
