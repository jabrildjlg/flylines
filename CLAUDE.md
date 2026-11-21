# FlyLines

Web-App fürs iPhone, die die Konturen eines gewählten Styles (Bart, Augenbrauen, später Koteletten und Haarkontur) als Linien auf das Live-Bild der Frontkamera projiziert. Ziel: Der Nutzer trifft seinen Style bei jeder Rasur gleich.

Ausgangsfall: Schnauzer und Goatee nach einem Vorzeigebild.

## Feste Rahmenbedingungen

- Kein API-Schlüssel, kein Backend, keine laufenden Kosten. Alles rechnet im Browser.
- Fotos und Kamerabild verlassen das Gerät nicht.
- Zielgerät: iPhone, Safari. Zusätzlich als Icon auf dem Homescreen nutzbar.
- Oberfläche auf Deutsch (Schweizer Schreibweise: «ss» statt «ß»).
- Reines HTML, CSS und JavaScript (ES-Module), kein Framework, kein Build-Schritt, solange es ohne geht.
- Hosting über GitHub Pages (HTTPS ist Pflicht, sonst gibt Safari die Kamera nicht frei).

## Arbeitsregeln

- Immer nur EINEN Bauschritt aus der Tabelle unten umsetzen, dann stoppen.
- Nach jedem Schritt: committen, pushen, dem Nutzer die Adresse und das Prüfkriterium nennen. Der Nutzer testet auf dem iPhone und meldet zurück. Erst danach den nächsten Schritt beginnen.
- Kamera und Tracking lassen sich nur auf dem echten Gerät beurteilen. Nichts als «funktioniert» melden, was nur am Computer geprüft wurde.
- Bei Bibliotheken (v. a. MediaPipe) aktuelle Doku und Versionen nachschlagen statt aus dem Gedächtnis zu arbeiten.
- Keine Funktionen bauen, die nicht im aktuellen Schritt stehen.
- Den Stand am Ende jedes Schritts unten unter «Stand» nachführen.

## Technik

- **Gesichtstracking:** MediaPipe Face Landmarker (Paket `@mediapipe/tasks-vision`), Video-Modus, 478 Gesichtspunkte plus Kopfhaltung (Transformationsmatrix). WASM- und Modell-Datei ins Repository legen, damit die App später auch offline läuft.
- **Kamera:** `getUserMedia` mit `facingMode: "user"`. Das `<video>` braucht `playsinline`, `muted` und `autoplay`, sonst öffnet Safari den Vollbild-Player. Bild gespiegelt anzeigen (wie ein Spiegel).
- **Zeichnen:** Canvas über dem Video, gleiche Spiegelung. Glättung der Punkte (z. B. One-Euro-Filter) gegen Zittern.
- **Kopfhaltung:** Linien nur zeigen, wenn die Drehung innerhalb einer Toleranz liegt; sonst Hinweis «Kopf gerade halten».
- **Speicher:** IndexedDB für Profil und Styles. Export und Import als JSON-Datei, weil Safari Website-Daten löschen kann.
- **Offline/Homescreen:** Web-App-Manifest und Service Worker erst in Schritt 12.

## Linien-Modell

- Ein Style enthält Linien, gruppiert nach Bereich: `bart`, `augenbrauen`, `haare`.
- Eine Linie ist eine Kette von Kontrollpunkten, gezeichnet als geglättete Kurve.
- Ein Kontrollpunkt speichert KEINE Bildposition, sondern seine Lage im Gesichtsnetz: Dreieck (drei Landmark-Indizes) plus baryzentrische Gewichte.
- Folge: Linien von einem Vorzeigebild passen sich automatisch an das Gesicht des Nutzers an und folgen Kopfdrehung und Mimik.
- Punkte ausserhalb des Netzes (Koteletten, Halslinie): Versatz zu den nächsten Landmarks im Kopf-Koordinatensystem, skaliert mit der Gesichtsgrösse (z. B. Augenabstand), nie in Pixeln.
- Feinjustierung auf dem Gesicht des Nutzers wird pro Style gespeichert («fixieren»).

## Datenobjekte

- **Profil:** Gesichtsmasse und Gesichtsform aus dem Scan; Haartyp (glatt, wellig, lockig, kraus), Dichte, Länge; Bartwuchs pro Zone (Oberlippe, Kinn, Wangen, Hals, Koteletten: dicht, lückenhaft, kein Wuchs).
- **Style:** Name, Vorschaubild, Linien nach Bereich, Anforderungen für den Check, Feinjustierung.
- **Style-Code:** Ein Style als kompakter Text (JSON, komprimiert und Base64) zum Kopieren. Dient als Import von der Style-Analyse-Seite in Claude und als Backup.

## Bildschirme

1. **Bibliothek (Start):** Styles als Kacheln mit Ampel, neuer Style, Profil, Einstellungen.
2. **Gesichtsscan:** Geführte Aufnahme frontal, links, rechts; danach Profilfragen.
3. **Neuer Style:** Vorzeigebild wählen oder Style-Code einfügen, Linien-Editor (Punkte ziehen, hinzufügen, löschen, links auf rechts spiegeln), Anforderungen, Check-Ergebnis.
4. **Live-Spiegel:** Kamerabild mit Linien, Bereiche ein/aus, Standbild, Zoom.
5. **Einstellungen:** Export/Import, Linienfarbe und -dicke, neu scannen.

## Bauschritte

| Nr. | Schritt | Fertig, wenn | Version |
| --- | --- | --- | --- |
| 1 | Grundgerüst und Hosting | App öffnet sich über die GitHub-Pages-Adresse auf dem iPhone und zeigt das gespiegelte Kamerabild | V1 |
| 2 | Gesichtstracking | Gesichtspunkte folgen dem Gesicht flüssig, Ziel mindestens 20 Bilder pro Sekunde (FPS-Anzeige einblenden) | V1 |
| 3 | Linien-Modell und Projektion | Eine Testlinie an der Schnauzer-Oberkante bleibt bei Kopfdrehung und Mimik an ihrer Stelle | V1 |
| 4 | Linien-Editor | Punkte lassen sich auf einem Foto mit dem Finger ziehen, hinzufügen, löschen und spiegeln | V1 |
| 5 | Style aus Vorzeigebild | Linien vom Vorzeigebild erscheinen live auf dem Gesicht des Nutzers | V1 |
| 6 | Gesichtsscan und Fixieren | Nach Scan und Feinjustierung sitzen die Linien bei erneutem Öffnen an derselben Stelle | V1 |
| 7 | Bibliothek und Speicher | Zwei Styles gespeichert, gewechselt, exportiert und nach dem Löschen wieder importiert | V1 |
| 8 | Bart und Augenbrauen komplett | Praxistest: echte Rasur von Schnauzer und Goatee nach den Linien | V1 |
| 9 | Machbarkeits-Check | Vorzeige-Style zeigt Grün; Slickback bei lockigem Profil zeigt Rot mit Begründung | V2 |
| 10 | Style-Code-Import | Ein Style-Code von der Analyse-Seite in Claude wird angenommen (Format hier festlegen und dokumentieren) | V2 |
| 11 | Koteletten und Haarkontur | Linien bleiben bei leichter Kopfdrehung brauchbar | V2 |
| 12 | Komfort | Standbild, Zoom, Schritt-für-Schritt-Modus, Start vom Homescreen auch ohne Netz | V3 |
| 13 | Styling-Tipps und Vorher-Nachher | Tipps pro Style, zwei Fotos lassen sich überblenden | V3 |

Schritt 3 ist der kritische Punkt. Sitzt die Testlinie dort nicht stabil genug, zuerst Glättung und Verankerung verbessern, bevor weitere Funktionen dazukommen.

Startlinien in Schritt 5: Standardformen für Schnauzer, Goatee und Augenbrauen, an Landmarks verankert, die der Nutzer auf dem Vorzeigebild zurechtzieht. Eine automatische Erkennung der Bartkanten nur ausprobieren und nur behalten, wenn sie zuverlässig bessere Startlinien liefert.

## Machbarkeits-Check (Schritt 9)

Regelbasiert, ohne KI. Vergleicht Profil mit den Anforderungen des Styles.

Anforderungen eines Styles: passende Haartypen, Mindestlänge, nötige Bartzonen, günstige Gesichtsformen, Aufwand.

- **Grün:** alle Anforderungen erfüllt.
- **Gelb:** etwas fehlt, ist aber änderbar (z. B. Länge wachsen lassen). Sagen, was es braucht.
- **Rot:** Haartyp passt nicht oder eine nötige Bartzone hat keinen Wuchs. Grund nennen, ähnliche Styles aus der Bibliothek vorschlagen.
- Die Gesichtsform führt höchstens zu Gelb, nie zu Rot.
- Der Check rät nur ab, er sperrt keinen Style.

## Bekannte Grenzen (nicht wegprogrammieren, sondern ehrlich anzeigen)

- Genauigkeit etwa 2 bis 3 mm; Orientierung, kein Messwerkzeug.
- Hand oder Rasierer vor dem Gesicht stören das Tracking kurz.
- Nacken, Hinterkopf und Haar-Styling gehen nicht als Linien.
- Die App erkennt nicht, ob richtig geschnitten wurde.

## Stand

- Schritt 1 bestanden (iPhone-Test am 21.11.2026): Grundgerüst, gespiegeltes Kamerabild, GitHub Pages unter https://jabrildjlg.github.io/flylines/.
- Schritt 2 bestanden (iPhone-Test am 21.11.2026): 30 bis 60 FPS mit GPU bei 720×1280, Punkte sitzen richtig. Das Netz endet an der oberen Stirn, etwa 2 cm unter dem Haaransatz des Nutzers (wichtig für Schritt 11).
- Schritt 3 gebaut, erste Runde am iPhone: Testlinie sitzt richtig (frontal und gedreht), zog aber sichtbar nach. Korrektur gebaut: Kamerabild wird pro Bild auf die Zeichenfläche kopiert, Erkennung läuft auf dieser Kopie, Linien darüber (Bild und Linien immer vom selben Moment); Schleife über `requestVideoFrameCallback`; Glättung leichter (minCutoff 2, beta 0.05). Wartet auf den zweiten Test.
- MediaPipe: `@mediapipe/tasks-vision` Version 1.2.3, in `tracker.js` fest eingetragen. Bibliothek, WASM und Modell werden vorerst aus dem Netz geladen (jsDelivr, Modell von Hugging Face bzw. Google Storage). Liegt das Modell unter `models/face_landmarker.task`, wird es automatisch von dort genommen. Für Schritt 12 (offline) müssen Bibliothek, WASM und Modell ins Repository.
- Linien: `lines.js` enthält Modell (`{ tri, w }`), Projektion, One-Euro-Glättung (minCutoff 2, beta 0.05, auf den projizierten Pixelpunkten) und das Zeichnen als Catmull-Rom-Kurve. `TEST_STYLE` ist nur die Testlinie und wird in Schritt 5 durch echte Styles ersetzt.
- Entscheid für Schritt 4/5: Das Dreieck eines neuen Kontrollpunkts wird im Editor aus einer Delaunay-Triangulation der 2D-Landmarks des Fotos bestimmt. Die offizielle Tesselations-Tabelle von MediaPipe wird nicht gebraucht, weil jedes Dreieck aus drei Landmarks als Anker taugt.
- Diagnose: `?cpu=1` schaltet die Grafikkarte ab, `?glatt=0` die Glättung, `?sync=0` das Kopieren des Kamerabilds (alter Zustand zum Vergleich). Knopf «Punkte ein/aus» zeigt die Gesichtspunkte.
- Dateien: `index.html`, `style.css`, `app.js` (Kamera, Schleife, Zeichnen), `tracker.js` (MediaPipe), `lines.js` (Linien).
- Nächster Schritt nach bestandenem Test: 4 (Linien-Editor).
