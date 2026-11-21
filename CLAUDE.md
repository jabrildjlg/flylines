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

Wünsche des Nutzers vom 21.11.2026 (gelten für alle weiteren Schritte):

- Gebraucht werden Formen für Bart, Augenbrauen und Haaransätze (Koteletten, Stirn, Schläfen). Die Haaransätze kommen in Schritt 11 und sind dem Nutzer wichtig.
- Bis zu drei Fotos pro Style aus verschiedenen Winkeln, damit auch Ecken und Abschlüsse des Barts sichtbar sind.
- Die Anzeige muss sich zum Nachschneiden eignen: Die Schnittkante darf nicht von einer dicken Linie verdeckt sein.

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
- Schritt 3 bestanden (iPhone-Test am 21.11.2026): Testlinie klebt frontal und gedreht an der Haut, 25 FPS bei 33 ms Rechenzeit pro Bild. Erkenntnisse aus drei Runden:
  - Das `<video>` nie direkt zeigen, sonst ziehen die Linien nach. Pro Bild: Kamerabild auf die Zeichenfläche kopieren, unmittelbar danach erkennen, Linien darüber.
  - Die Erkennung muss direkt vom `<video>` lesen. Von der 2D-Zeichenfläche gelesen fiel die Bildrate in Safari auf etwa 15 FPS.
  - 33 ms pro Bild sind knapp am Takt der Kamera (30 Bilder pro Sekunde). Falls spätere Schritte die Bildrate unter 20 drücken: zuerst die Kopie des Kamerabilds verkleinern.
- Schritt 4 bestanden (iPhone-Test am 21.11.2026): Punkte ziehen, Lupe, Hinzufügen, Löschen und Spiegeln funktionieren. Rückmeldung: Antippen der Linie fügte bei dicht liegenden Punkten keinen Punkt ein; aus dem Kameramodus fehlte ein klarer Weg zurück.
- Schritt 5, bisherige Runden am iPhone (21.11.2026). Startformen, drei Fotos und Live-Anzeige funktionieren. Umgesetzte Rückmeldungen, wartend auf den nächsten Test:
  - Der rote Streifen störte. Es gibt nur noch die feine Linie ohne dunklen Rand (`drawLine` mit `halo: false`).
  - Linien der abgewandten Kopfseite schienen durch den Kopf durch. Sichtbarkeit pro Punkt (`facing` in `lines.js`): Richtung von der Kopfmitte (Mitte zwischen Landmark 234 und 454) zum Punkt; zeigt sie von der Kamera weg, wird das Linienstück weggelassen. Hängt von den z-Werten von MediaPipe ab; noch nicht vom Nutzer bestätigt.
  - Bart-Analyse (`analyze.js`, Knopf «Analysieren»). Die erste Fassung verglich nur die Helligkeit und scheiterte an den echten Fotos des Nutzers (Nasenlöcher statt Schnauzer, Kieferschatten statt Goatee). Zweite Fassung, an zwei echten Fotos des Nutzers entwickelt:
    - Merkmal ist die fehlende Farbe (Chroma im Lab-Farbraum) gegenüber der Wangenhaut, nicht die Helligkeit. Barthaar ist farbloser als Haut; Schatten behalten die Hautfarbe.
    - Erlaubte Fläche: untere Gesichtshälfte im Netz (Gesichtsrand um 4 % verkleinert), ohne Lippen (8 % vergrössert) und ohne Nase.
    - Schwelle: untere Gruppe + 42 % des Abstands zur oberen Gruppe (Otsu liefert die Gruppen). Reines Otsu schnitt die hellen Schnauzer-Enden ab; Hysterese lief auf der Schattenseite des Gesichts aus.
    - Danach Sprenkel entfernen, kleine Lücken schliessen, Flächen unter 0,5 % verwerfen, jede Fläche und jedes Loch (Mund im Vollbart) als Umriss. So geht jede Bartform, nicht nur Schnauzer und Goatee.
    - Geprüft auf dem frontalen Foto mit von Hand gesetzten Gesichtspunkten (hier lässt sich MediaPipe nicht ausführen): Schnauzer, Fleck unter der Lippe und Goatee werden gefunden; ein kleiner falscher Fleck am Gesichtsrand und ein Ausläufer am Kiefer bleiben. Mit echten Landmarks und mit mehreren Fotos noch nicht geprüft.
    - Zweites «Analysieren» nach eigenen Änderungen erfindet nichts neu: Jeder Punkt wird nur an die nächste Bartkante innerhalb von 3,5 % der Gesichtsbreite gezogen (Feinabgleich). «Zurücksetzen» beginnt neu.
  - Editor: mehrere Fotos auf einmal wählbar; beim Ziehen werden die anderen Punkte ausgeblendet; «Spiegeln» überträgt die zuletzt bearbeitete oder angetippte Seite; «Form löschen» entfernt eine ganze Form. Gruppen sind jetzt «Bart» und «Brauen».
  - Zoom im Editor: zwei Finger zoomen (bis 6×) und verschieben, ein Finger auf freier Fläche verschiebt, Knopf «Zoom» schaltet 1× → 2× → 4× → 1×. Umsetzung über CSS-Transform der Zeichenfläche; die Lupe bleibt im sichtbaren Ausschnitt.
  - Vierte Runde am iPhone: Die Farb-Analyse trifft den Schnauzer brauchbar, läuft aber unter dem Mund auf der Schattenseite aus (mehrere überlappende Formen bis zur Wange). Der Nutzer beurteilt sie als nicht gut genug. Darum läuft eine Recherche nach einem modellbasierten Verfahren (Notizen ausserhalb des Repositories).
  - Testbilder des Nutzers (frontal, Profil links, Profil rechts, je 1122×1402) liegen lokal ausserhalb des Repositories und dürfen nicht eingecheckt werden.
  - Offene Wünsche des Nutzers: Der Style soll sich an seinen Kopf anpassen statt 1:1 übernommen zu werden (gehört zu Schritt 6: Feinjustierung auf dem eigenen Gesicht). Augenbrauen werden noch nicht analysiert.
- Inhalt von Schritt 5:
  - `DEFAULT_STYLE` in `lines.js`: geschlossene Startformen für Schnauzer, Goatee und beide Augenbrauen.
  - Linien-Modell erweitert: `closed`, `enabled`, `group` (bart, brauen), `partner` (linke und rechte Braue).
  - Editor mit bis zu drei Fotos (Reiter «Foto 1–3»). Alle Fotos zeigen dieselben Formen, weil die Punkte im Gesichtsnetz verankert sind. Schalter für Bart und Brauen.
  - Antippen: näher als 11 Bildschirm-Pixel an einem Punkt greift den Punkt, sonst fügt ein Tipp auf die Linie einen Punkt ein.
  - Live-Spiegel: Knopf «‹ Menü» statt «Kamera stoppen».
- MediaPipe: `@mediapipe/tasks-vision` Version 1.2.3, in `tracker.js` fest eingetragen. Bibliothek, WASM und Modell werden vorerst aus dem Netz geladen (jsDelivr, Modell von Hugging Face bzw. Google Storage). Liegt das Modell unter `models/face_landmarker.task`, wird es automatisch von dort genommen. Für Schritt 12 (offline) müssen Bibliothek, WASM und Modell ins Repository.
- Linien: `lines.js` enthält Modell (`{ tri, w }`), Projektion, One-Euro-Glättung (minCutoff 2, beta 0.05, auf den projizierten Pixelpunkten) und das Zeichnen als Catmull-Rom-Kurve.
- Editor (`editor.js`, `geometry.js`):
  - Foto wird nach der Gesichtserkennung auf das Gesicht zugeschnitten (Rand für Hals, Ohren, Haaransatz).
  - Anker eines Punkts: Delaunay-Triangulation der 468 Netzpunkte des Fotos (Iris-Punkte 468–477 ausgeschlossen, sie bewegen sich mit dem Blick), dann baryzentrische Gewichte. Ausserhalb des Netzes: nächstes Dreieck, Gewichte dürfen negativ sein.
  - Bedienung: Punkt ziehen (mit Lupe), Linie antippen oder «Punkt +» für neuen Punkt, «Punkt löschen», «Spiegeln», «Zurücksetzen» (stellt die Startformen wieder her).
  - Spiegeln rechnet in 3D an der Gesichtsmitte (Ebene aus den Paaren 33/263, 133/362, 61/291, 234/454 und Mittellinien-Punkten), nicht über eine Tabelle von Landmark-Paaren. Quelle ist die zuletzt bearbeitete Seite. Formen über der Mitte werden symmetrisch neu aufgebaut; Formen ganz auf der Quellseite überschreiben ihre Partnerform (`partner`).
  - Editor und Live-Spiegel benutzen dasselbe Style-Objekt im Speicher; gespeichert wird noch nichts (Schritt 7).
- Diagnose: `?cpu=1` schaltet die Grafikkarte ab, `?glatt=0` die Glättung, `?sync=0` das Kopieren des Kamerabilds, `?verdeckt=0` das Ausblenden der abgewandten Seite. Knopf «Punkte ein/aus» zeigt die Gesichtspunkte.
- Dateien: `index.html`, `style.css`, `app.js` (Kamera, Schleife, Bildschirme), `tracker.js` (MediaPipe), `lines.js` (Linien), `editor.js` (Editor), `geometry.js` (Dreiecksnetz, Spiegelung), `analyze.js` (Bart-Analyse). Bei jeder Änderung die Versionsnummer `?v=` in `index.html` und in den `import`-Zeilen erhöhen, sonst lädt Safari alte Dateien.
- Nächster Schritt nach bestandenem Test: 6 (Gesichtsscan und Fixieren).
