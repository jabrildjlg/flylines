# Prüfstand für die Bart-Analyse

Rechnet die Analyse der App auf echten Fotos durch, mit dem echten MediaPipe in einem ferngesteuerten Browser, und misst den Abstand zur Soll-Kontur. Gehört nicht zur ausgelieferten App; diese bleibt ohne Build-Schritt.

Die Testfotos und alle Ergebnisse liegen in einem Ordner NEBEN dem Repository (`../flylines-testbilder`). Das Repository ist öffentlich: Fotos, Soll-Konturen und Ergebnisbilder nie einchecken. Das Skript bricht ab, wenn der Foto-Ordner im Repository liegt.

## Einrichten (einmal)

```
cd pruefstand
npm install
```

Es wird das auf dem Rechner installierte Chrome benutzt (sonst Edge). Beim Lauf braucht es Internet, weil MediaPipe und das Modell wie in der App aus dem Netz geladen werden.

## Messen

```
node pruefstand/run.mjs --name mein-versuch
```

| Schalter | Wirkung |
| --- | --- |
| `--name <ordner>` | Name des Ergebnisordners unter `<fotos>/ergebnis/` |
| `--fotos <pfad>` | anderer Foto-Ordner |
| `--nur a.png,b.png` | nur diese Fotos laden |
| `--start` | Startformen ohne Analyse messen (Vergleichswert) |
| `--fein` | danach einen Punkt verschieben und den Feinabgleich prüfen |
| `--raster` | Bilder mit Prozent-Raster schreiben (zum Ablesen von Soll-Punkten) |
| `--soll` | Bilder nur mit der Soll-Kontur schreiben |
| `--punkte` | Gesichtspunkte einzeichnen |

Pro Foto entstehen `<foto>.png` (ganzes Foto) und `<foto>-nah.png` (untere Gesichtshälfte vergrössert): Ergebnis grün, Soll magenta. Dazu `messung.json`.

## Zahlen lesen

Alle Abstände in Prozent der Gesichtsbreite (Ohr zu Ohr, rund 14 cm; 1 % ist also etwa 1,4 mm).

- `mittel`: Mittel aus den beiden folgenden Werten. Kleiner ist besser.
- `zuViel`: mittlerer Abstand der gefundenen Linie zur Soll-Kontur. Hoch, wenn die Analyse Dinge findet, die kein Bart sind (Schatten, Ausläufer).
- `zuWenig`: mittlerer Abstand der Soll-Kontur zur gefundenen Linie. Hoch, wenn Bart fehlt.
- `p95`: 95 % der Punkte liegen näher. Zeigt Ausreisser.
- `gedreht`: 0 = von vorn, 1 = reines Profil.

Vom Ergebnis zählt auf jedem Foto nur, was der Kamera zugewandt ist.

## Soll-Konturen

`<fotos>/soll.json`: pro Dateiname eine Liste geschlossener Formen, jeder Punkt als `[x, y]` in Prozent des Originalfotos.

```
{ "front.png": [ [[39.0, 58.5], [40.7, 56.7], …], … ] }
```

Zum Einzeichnen `--raster` laufen lassen und die Punkte im Bild `<foto>-raster.png` ablesen, danach mit einem normalen Lauf im Bild `<foto>-nah.png` kontrollieren.
