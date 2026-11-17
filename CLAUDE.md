# SOLIDAGO Kassenprüfung – Projektbriefing für Claude Code

Sprache mit dem Nutzer: **Deutsch**. Der Nutzer ist Kassenprüfer, kein Entwickler: Erklärungen einfach halten, Fachbegriffe vermeiden oder kurz erklären.

## Ziel
Installierbare Desktop-App (zuerst **Windows**, später Mac) für die jährliche Kassenprüfung einer SOLIDAGO-Gemeinschaft (bis zu 20 Klienten/Mitglieder). Mitglieder reichen über das Jahr „Anträge auf Auszahlung“ mit Original-Rechnungen auf Papier ein. Die App:
1. empfängt Fotos von Anträgen und Rechnungen **vom Android-Handy über das WLAN** (QR-Code-Kopplung),
2. erkennt **am Inhalt** (nicht am Dateinamen), ob es ein Antrag oder eine Rechnung ist, und liest alles **lokal** aus,
3. ordnet Anträge über die Mitgliedsnummer den Klienten zu und Rechnungen den Antragszeilen,
4. prüft Summen und Doppelungen,
5. erzeugt den Kassenprüfungsbericht nach Vordruck als druckfähiges PDF mit Unterschrift.

**Keine manuelle Erfassung**: Der Nutzer bestätigt/korrigiert nur markierte Stellen, Scan daneben.

## Feste Vorgaben
- **Datenschutz**: Gesundheitsdaten von Mitgliedern. Alles bleibt lokal. Keine Cloud, kein externer OCR-/KI-Dienst, keine Telemetrie.
- Ein Nutzer pro Installation. Später Weitergabe an Kollegen → einfache Installation (ein Installer), keine Konfiguration.
- Prüfjahr = Kalenderjahr; jedes Jahr neu, keine Archivierung (aber Sicherung/Export der Daten anbieten).

## Handy-Kopplung (entschieden)
- Desktop-App startet einen kleinen lokalen HTTP-Server im Heimnetz.
- Button „Belege vom Handy“ → Fenster mit QR-Code (URL mit LAN-IP, Port und Einmal-Schlüssel) + Adresse als Text als Ausweichweg.
- Handy scannt QR mit der Kamera → Chrome öffnet einfache Upload-Seite (vom Server ausgeliefert) → Fotos aufnehmen (`<input type="file" accept="image/*" capture="environment" multiple>`; funktioniert ohne HTTPS) oder PDFs auswählen → Upload → erscheinen sofort in der Desktop-App.
- Schlüssel gilt nur für diese Sitzung; Server nur aktiv, solange das Fenster offen ist.
- Windows-Firewall-Abfrage beim ersten Start: Nutzer muss „Private Netzwerke“ erlauben → in der App erklären.
- Fallback: Dateien per Drag & Drop / Dateiauswahl importieren (z. B. aus Sync-Ordner).

## Antragsformular (immer gleiches Layout)
Kopf: Datum, Mitgliedsnummer, Absender. Tabelle Zeilen 1–10: Beleg-Nr., Beleg-Datum, Beträge in 6 Spalten:
PRAEV (Prävention), AMB (Ambulant), STAT (stationär), ZAB (Zahnarzt), ZAER (Zahnersatz), AHMIT (Arznei u. Heilmittel).
Darunter Zeile „SUMMEN“ und „Gesamtsumme von … €“. Eine Zeile/Spalte kann mehrere Rechnungen zusammenfassen. Das Kästchen „Anlage … Summen in Zeile 10“ ist unzuverlässig → ignorieren.

## Auslesen – erprobter Ansatz (siehe `ocr-test/`)
Getestet mit Tesseract 5 (`deu`) + OpenCV in Python, an 3 Anträgen und 2 Rechnungen (Handyfotos nur 720×1280): Dokumenttyp, alle Antragszeilen, Summen, Gesamtsumme, Rechnungsbetrag/-datum/Aussteller und der komplette Abgleich waren korrekt.
1. Seite im Foto finden (größte Kontur, 4 Ecken) und perspektivisch auf A4 entzerren (1654×2339).
2. Typ: Text enthält „Antrag auf Auszahlung“/„SOLIDAGO“ → Antrag, sonst Rechnung.
3. Antrag: horizontale Gitterlinien per Morphologie → Tabellenzeilen (längste Linienfolge); Spaltenmitten über OCR der Kopfwörter PRAEV…AHMIT (fehlende interpolieren); jede Zeile als Streifen OCR, Beträge der nächstgelegenen Spaltenmitte zuordnen. Antragsdatum, Mitgliedsnummer, Gesamtsumme per Regex.
4. Rechnung: Aussteller (1. Zeile), Rechnungsdatum, Rechnungsnummer, Rechnungsbetrag (Stichworte Rechnungsbetrag/Gesamtbetrag/zu zahlen/Summe), alle Beträge, „Betrag erhalten“; Kategorie-Vorschlag über Stichworte.
5. Zuordnung Rechnung ↔ Antragszeile über den Betrag (erst Rechnungsbetrag, dann irgendein Betrag auf dem Beleg).
Offen: Apotheken-Kassenzettel (Thermopapier), mehrseitige Rechnungen, eine Rechnung für mehrere Zeilen bzw. mehrere Rechnungen für eine Zeile (Teilsummen-Kombination).

## Prüfregeln
1. Zeilenbeträge je Spalte = Summenzeile; Summenzeile gesamt = Gesamtsumme.
2. Jeder Antragsbetrag durch Rechnung(en) in gleicher Höhe belegt; Rechnungen ohne Antragszeile melden.
3. Doppelung: gleiche Rechnung (Nummer, sonst Betrag + Datum + Aussteller) mehrfach eingereicht – auch über alle Anträge des Jahres; identische Dateien (Hash).
4. Kategorie der Rechnung ≠ Spalte → nur Hinweis.
5. Prüfer kann Befunde als „geklärt“ markieren (+ Bemerkung).

## Bericht
Seite 1 = Vordruck „Bericht Kassenprüfung“ (Felder: Gemeinschaft, Jahr, Prüfdatum, Zeitraum, Prüfer 1/2 mit Anschrift, Ergebnis-Kreuze, Belege vollständig/unvollständig, eindeutig gekennzeichnet, Entlastung ja/nein, weiterer Termin, Bemerkungen, Ort/Datum, Unterschriften Prüfer 1/2 + Kassier). Kreuze automatisch aus den Befunden, übersteuerbar. Unterschrift digital (Zeichenfeld) oder handschriftlich auf Ausdruck.
Anlage: Übersicht aller Klienten, Befundliste, Prüfumfang, Einzelnachweis je Antrag.
→ Layout, Bedienung und Berichtsaufbau aus `prototyp/SOLIDAGO_Kassenpruefung.html` übernehmen (vom Nutzer gesehen). Achtung: Der Prototyp nutzt noch manuelle Erfassung je Zeile – das wird durch das automatische Auslesen ersetzt.

## Technik-Vorschlag (vor Start mit Nutzer kurz abstimmen)
- Electron (Windows-Installer via electron-builder, später Mac), UI aus dem Prototyp
- Lokaler Server: Node `http`/express im Main-Prozess; QR-Code per `qrcode`
- OCR: entweder tesseract.js (WASM, `deu` traineddata mitliefern, offline) + opencv.js, **oder** Python-Sidecar (OpenCV + Tesseract, mit PyInstaller gebündelt). Ergebnisse gegen die Python-Tests in `ocr-test/` vergleichen.
- Daten: lokale Ordnerstruktur bzw. SQLite im Nutzerprofil; Bilder als Dateien
- PDF-Bericht: `webContents.printToPDF`

## Testdaten
Der Nutzer hat echte Beispielfotos (Antrag Mitglied 723 vom 26.10.2026 mit 2 Zahnarztrechnungen 107,01 € und 17,73 €; Anträge vom 29.12.2024 und 13.04.2026). Echte Personendaten → nicht ins Repo einchecken, nur lokal in `testdaten/` (in .gitignore).

## Stand der Umsetzung (17.11.2026)
- **Technik entschieden**: Electron (Windows-Installer per GitHub Actions → Releases), OCR mit **tesseract.js** + mitgeliefertem `resources/tessdata/deu.traineddata`, Bildverarbeitung als reines JS (`src/core/imgproc.js`, Portierung von `ocr-test/`, kein opencv.js).
- Aufbau: `src/core` (imgproc, recognize, pruefung, ocr – ohne Electron testbar), `src/main` (main, store, leser = OCR-Warteschlange, handy = Upload-Server, upload.html), `src/renderer` (Oberfläche aus dem Prototyp).
- Unsicher gelesene Stellen: Tabellenzeilen werden in 3 Vergrößerungen gelesen; Abweichung oder geringe Sicherheit → gelb markiert, Nutzer bestätigt. Gegenprobe Zeilen ↔ Summenzeile ↔ Gesamtsumme hebt Markierungen auf.
- Zuordnung Rechnung ↔ Zeile: Betrag (Rechnungsbetrag, dann beliebiger Betrag), Teilsummen (bis 4 Rechnungen je Zeile), eine Rechnung für mehrere Zeilen; bevorzugt Rechnungen, die direkt nach dem Antrag hochgeladen wurden. Manuelle Zuordnung möglich.
- PDFs werden in der Oberfläche mit pdf.js gerendert; mehrseitige Rechnungen / Folgeseiten werden zusammengefasst.
- Tests: `test/pruefung.test.js`, `test/auslesen.test.js`, `test/durchlauf.test.js` (künstliche Testbilder in `test/fixtures`).
- Offen: Test mit echten Fotos des Nutzers; Apotheken-Kassenzettel; Mac-Version; Code-Signatur (SmartScreen-Warnung).
