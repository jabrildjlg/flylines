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

## Aktueller Abschnitt: Bartkontur aus den Fotos (Stand 21.11.2026)

Die Entwicklung dieses Abschnitts läuft ab jetzt im Terminal auf dem Computer des Nutzers (Windows), weil dort die echte Gesichtserkennung auf den echten Testfotos laufen kann. Vorher wurde blind entwickelt. Der volle Recherche-Bericht liegt in `docs/recherche-bartkontur.md`.

Ergebnis der Recherche in Kürze:

- Kein fertiges Browser-Modell hat eine Bart-Klasse. Die Bartkante ist auch für Menschen unscharf (zwei Annotatoren: rund 78 % Überlappung).
- Zielbild: Vorlage führt, Modell hilft, Nutzer entscheidet. Ein Modell liefert die grobe Bartfläche, `analyze.js` zieht Punkte nur noch in einem schmalen Band an die Kante, der Nutzer korrigiert und gibt frei.
- Erster Kandidat: MediaPipe `InteractiveSegmenter` in der neuen Fassung (in `@mediapipe/tasks-vision` 1.2.3 enthalten: `setImage(image)`, dann `segment(strokes)` mit `BrushMode` POSITIVE/NEGATIVE/LASSO; Modell `interactive_segmentation.task`, 30,5 MB, Eingabe 768×768). Zweiter Kandidat: Selfie-Multiclass (16,4 MB), falls es Bart als «Haar» einordnet. Ob eines davon einen Bart trifft, ist nirgends belegt und muss gemessen werden.
- Rückfall: SlimSAM über Transformers.js (auf dem iPhone nur WASM, wegen eines offenen WebKit-Speicherfehlers mit WebGPU), danach eigenes kleines Modell auf FaceSynthetics.
- Nicht verfolgen: KI-Sprachmodell für Koordinaten (ungenau, bräuchte Schlüssel), volles 3D-Kopfmodell.

Vom Nutzer vorgeschlagener Ablauf, der unabhängig vom Modell funktioniert und zuerst fertig werden soll:

1. Fotos von vorn und von beiden Seiten laden.
2. Punkte mit Zoom genau setzen, mit so vielen Punkten wie nötig (Startform oder Analyse-Vorschlag als Ausgangslage).
3. Fertiges Ergebnis zur Freigabe zeigen: alle Fotos mit der feinen Linie ohne Punkte, dazu «Passt» und «Zurück zum Bearbeiten». Erst nach «Passt» gilt der Style als fertig.

Reihenfolge der Aufgaben (wie immer: eine Aufgabe, dann stoppen und den Nutzer testen lassen):

- A. Freigabe-Ansicht im Editor (Punkt 3 oben). Klein, ohne neues Modell.
- B. Prüfstand ausserhalb der App: Testfotos in einem Ordner NEBEN dem Repository (nie einchecken, das Repository ist öffentlich), von Hand gezogene Soll-Konturen, ein Skript, das eine Variante in einem ferngesteuerten Browser mit echtem MediaPipe durchrechnet, Überlagerungsbilder schreibt und den mittleren Abstand zur Soll-Kontur in Prozent der Gesichtsbreite ausgibt. Werkzeuge des Prüfstands dürfen Node und Pakete benutzen; die ausgelieferte App bleibt ohne Build-Schritt.
- C. Kandidaten messen: heutige Farb-Analyse, Interactive Segmenter (ganzes Foto und Ausschnitt der unteren Gesichtshälfte, Striche aus Landmarks), Selfie-Multiclass. Ergebnis mit Bildern und Zahlen berichten, noch nichts in die App einbauen.
- D. Den Gewinner als Flächenfinder vor `analyze.js` setzen. Modell erst bei «Analysieren» laden und danach freigeben.

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
  - Vierte Runde am iPhone: Die Farb-Analyse trifft den Schnauzer brauchbar, läuft aber unter dem Mund auf der Schattenseite aus (mehrere überlappende Formen bis zur Wange). Der Nutzer beurteilt sie als nicht gut genug. Die Recherche dazu ist abgeschlossen, siehe Abschnitt «Aktueller Abschnitt: Bartkontur aus den Fotos».
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
- Dateien: `index.html`, `style.css`, `app.js` (Kamera, Schleife, Bildschirme), `tracker.js` (MediaPipe), `lines.js` (Linien), `editor.js` (Editor), `geometry.js` (Dreiecksnetz, Spiegelung), `analyze.js` (Bart-Analyse). Dazu `pruefstand/` (Prüfstand, nicht Teil der App). Bei jeder Änderung die Versionsnummer `?v=` in `index.html` und in den `import`-Zeilen erhöhen, sonst lädt Safari alte Dateien.
- Aufgabe A bestanden (iPhone-Test am 21.11.2026, `?v=11`): Freigabe-Ansicht.
  - Knopf «Fertig» oben rechts im Editor (aktiv, sobald ein Foto geladen ist) öffnet die Ansicht «Freigabe»: alle geladenen Fotos untereinander zum Scrollen, jedes mit den eingeschalteten Formen als feine Linie ohne Punkte und ohne dunklen Rand (`renderReview` in `editor.js`, `drawLine` mit `halo: false`, 1,5 Bildschirm-Pixel breit).
  - «Zurück zum Bearbeiten» führt unverändert in den Editor. «Passt» gibt den Style frei und führt zum Startbildschirm, dort steht «✓ Style freigegeben.».
  - Freigabe = Abdruck der Linien (`approvedLines` in `app.js`, JSON von `style.lines`). Jede spätere Änderung (auch Bereich ein/aus) hebt sie auf; der Startbildschirm meldet dann «Style seit der Freigabe geändert». Die Freigabe sperrt den Live-Spiegel nicht und wird noch nicht gespeichert (Schritt 7).
  - Am Computer geprüft (Chromium, 390×844, echtes MediaPipe, die drei Testbilder): Ansicht, beide Knöpfe und das Aufheben der Freigabe laufen ohne Fehler. Beobachtung dabei: Auf den Profilfotos scheinen die Formen der abgewandten Gesichtsseite durch (Editor und Freigabe blenden sie anders als der Live-Spiegel nicht aus). Nicht Teil von Aufgabe A.
- Lokal testen: `python -m http.server` im Repository, dann im ferngesteuerten Browser öffnen. Der Testbrowser lädt Dateien nur aus dem Temp-Ordner oder dem Repository hoch; Testbilder deshalb vorübergehend in den Temp-Ordner kopieren, nie ins Repository.
- Rückmeldung des Nutzers nach Aufgabe A (21.11.2026): Die Analyse ist unverändert schlecht (erwartet, A hat sie nicht berührt). Wunsch: Am Anfang alle drei Ansichten analysieren und daraus die Linien bilden; «Analysieren» auf einem Seitenfoto soll dieses Foto analysieren.
  - Befund im Code: `analyzeBeard` rechnet nur im Bild des frontalsten Fotos. Die anderen Fotos fliessen pro Dreieck gewichtet mit (Flächenverhältnis im Quadrat); bei echten Profilfotos sind die frontalen Dreiecke fast von der Kante gesehen, das Gewicht geht gegen null. Umgekehrt sieht das frontale Foto Wange, Kieferecke und Koteletten kaum. Der Eindruck «nur das Frontbild» stimmt also praktisch. `editor.analyze()` springt zudem immer auf das frontalste Foto.
  - Einordnung: Der Wunsch gehört zu C und D. Im Prüfstand (B) deshalb von Anfang an Soll-Konturen für alle drei Fotos vorsehen und in C als eigene Variante messen: jede Ansicht für sich analysieren (im eigenen Bild, nur die dort gut sichtbaren Dreiecke), Ergebnisse im Gesichtsnetz zusammenführen.
- Aufgabe B umgesetzt (21.11.2026): Prüfstand in `pruefstand/` (Anleitung in `pruefstand/README.md`).
  - `node pruefstand/run.mjs --name <versuch>` startet einen kleinen Webserver, steuert das installierte Chrome fern (`playwright-core`), lädt die Fotos aus `../flylines-testbilder` in `pruefstand/bench.html` (benutzt die echten Module der App und das echte MediaPipe auf dem Prozessor), lässt die Analyse laufen und schreibt Überlagerungsbilder und `messung.json` nach `../flylines-testbilder/ergebnis/<versuch>/`.
  - Mass: mittlerer Abstand zwischen Ergebnis und Soll-Kontur in Prozent der Gesichtsbreite, getrennt nach «zu viel gefunden» und «zu wenig gefunden», dazu der 95-%-Wert.
  - Soll-Konturen in `../flylines-testbilder/soll.json` (Punkte in Prozent des Originalfotos). VORLÄUFIG: von Claude an einem Raster abgelesen und am Bild kontrolliert, vom Nutzer noch nicht bestätigt. Genauigkeit etwa ±1 % der Gesichtsbreite; kleinere Unterschiede zwischen Varianten sind darum nicht aussagekräftig. Die Oberkante des Kinnbarts schliesst die lichten Stoppeln ein.
  - Der Editor gibt für den Prüfstand `photoData()` heraus (Foto, Gesichtspunkte, Ausschnitt im Original).
- Analyse aus allen Ansichten umgesetzt (21.11.2026, `?v=12`), wartet auf den iPhone-Test. Wunsch des Nutzers, auf dessen Entscheid direkt in die App eingebaut (ohne den Vergleich mit den Modellen aus Aufgabe C abzuwarten).
  - `analyzeBeard(photos, current)` rechnet nicht mehr im Bild eines Fotos, sondern auf einer flachen Karte des Gesichts (`unwrap` in `analyze.js`: Winkel um die Kopfachse × Höhe, aus den 3D-Punkten des frontalsten Fotos). Jede Stelle der Karte wird über das Gesichtsnetz in allen Fotos nachgeschlagen; ein Foto zählt mit cos² des Winkels, unter dem es das Dreieck sieht, abgewandte Dreiecke zählen nicht. Ein- und Ausgabe sind Anker (`{ tri, w }`), nicht mehr Pixel.
  - «Analysieren» bleibt auf dem gezeigten Foto (springt nicht mehr aufs Frontbild).
  - Erlaubte Fläche reicht am Kinn über den Netzrand hinaus (`CHIN_SCALE` 1,14; ausserhalb des Netzes wird das nächste Dreieck gerade weitergeführt). Vorher fehlte die Unterkante des Kinnbarts.
  - Fotos zählen je nach Drehung (`|n.z|` der Spiegelebene, 0 = von vorn, 1 = Profil): bis 0,6 voll, ab 0,9 gar nicht (`TURN_FULL`, `TURN_NONE`). Die App meldet, wie viele Fotos mitgezählt haben.
  - Messung auf den drei Testfotos (frontal, zwei reine Profile mit Drehung 0,93), mittlerer Abstand Front / Profil links / Profil rechts:
    - Startformen ohne Analyse: 2,1 / 2,7 / 2,8
    - Analyse vor diesem Schritt (nur Frontbild): 2,8 / 3,3 / 2,3
    - Neue Analyse, Profile voll mitgezählt: 3,0 / 2,9 / 2,9 (falsche Streifen entlang beider Kieferkanten)
    - Neue Analyse wie ausgeliefert (Profile zählen wegen der Drehung nicht): 2,0 / 2,4 / 2,8
  - Befunde:
    - Bei reinem Profil sitzt das Netz von MediaPipe am Kinn rund 3 bis 4 % der Gesichtsbreite zu hoch, und der Teil des Kinnbarts unter der Kinnkante liegt ausserhalb des Netzes. Reine Profilfotos schaden der Analyse deshalb mehr, als sie nützen. Für die Testfotos des Nutzers ist das Ergebnis darum gleich wie mit dem Frontbild allein. Ob Halbprofil-Fotos (etwa 45°) wirklich etwas beitragen, ist NICHT gemessen: Es fehlen solche Testfotos.
    - Nach dem Mass ist die Analyse nur knapp besser als die unveränderten Startformen. Im Bild sitzt sie am Kinnbart und am Fleck unter der Lippe deutlich besser; am Schnauzer fehlt das linke, hellere Drittel, und am Nasenansatz bleibt eine Kerbe. Eine tiefere Schwelle (0,34 und 0,28 statt 0,42) macht es schlechter (Ausläufer).
    - Farbstärke im Verhältnis zur Helligkeit taugt nicht als Merkmal (kein Kontrast zwischen Bart und Haut).
    - Dieselben Linien passen auf den Profilfotos schlechter als vorn, weil das Netz dort daneben liegt. Das kann keine Analyse beheben.
  - Rechenzeit am Computer 0,6 bis 2,7 s; auf dem iPhone nicht gemessen.
- Nächste Aufgabe: C aus dem Abschnitt «Aktueller Abschnitt: Bartkontur aus den Fotos» (Interactive Segmenter und Selfie-Multiclass im Prüfstand messen). Vorher den Nutzer die Soll-Konturen bestätigen lassen und um Halbprofil-Testfotos bitten. Schritt 6 (Gesichtsscan und Fixieren) folgt, sobald der Nutzer einen Style freigegeben hat.
