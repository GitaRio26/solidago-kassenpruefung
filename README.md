# SOLIDAGO Kassenprüfung

Desktop-Programm für Windows zur jährlichen Kassenprüfung einer SOLIDAGO-Gemeinschaft.
Anträge auf Auszahlung und Rechnungen werden mit dem Handy fotografiert, **auf dem PC** ausgelesen,
geprüft und als Kassenprüfungsbericht (PDF nach Vordruck) ausgegeben. Es werden keine Daten ins Internet übertragen.

## Installieren (für Prüferinnen und Prüfer)

1. Auf GitHub im Bereich **Releases** (rechte Spalte) die neueste Version öffnen und unter *Assets*
   die Datei `SOLIDAGO-Kassenpruefung-Setup-….exe` herunterladen.
2. Datei doppelklicken. Windows zeigt eventuell **„Der Computer wurde durch Windows geschützt“** –
   das liegt nur daran, dass das Programm (noch) nicht kostenpflichtig signiert ist:
   auf **„Weitere Informationen“** und dann **„Trotzdem ausführen“** klicken.
3. Die App installiert sich ohne weitere Fragen und legt eine Verknüpfung auf dem Desktop an.
4. Beim ersten Klick auf **„📱 Belege vom Handy“** fragt die Windows-Firewall nach:
   **„Private Netzwerke“ anhaken** und **„Zugriff zulassen“** klicken.

## So funktioniert die Prüfung

1. **Belege vom Handy**: QR-Code mit der Handy-Kamera scannen (Handy im selben WLAN), dann je Mitglied
   zuerst den Antrag und danach die zugehörigen Rechnungen fotografieren. Alternativ Fotos/PDFs per Drag & Drop.
2. Die App erkennt selbst, ob ein Blatt ein Antrag oder eine Rechnung ist, liest alles aus, legt die Klienten
   über die Mitgliedsnummer an und ordnet die Rechnungen über den Betrag den Antragszeilen zu.
3. **Gelb markierte Stellen** (unsicher gelesen) mit dem Scan daneben vergleichen: „✓ stimmt“ oder korrigieren.
4. **Prüfübersicht**: Rechenfehler, fehlende Belege, Rechnungen ohne Antrag und Doppelungen.
   Geklärte Punkte abhaken und eine Bemerkung dazuschreiben.
5. **Bericht**: Angaben ergänzen, unterschreiben (Maus/Stift) oder später von Hand – „Bericht als PDF speichern“.
6. **Daten**: Sicherung auf USB-Stick, neues Prüfjahr beginnen.

Die Daten liegen unter `%APPDATA%\SOLIDAGO Kassenpruefung\Pruefdaten` (Fotos und `state.json`).

## Für Entwickler

- Electron-App: `src/main` (Hauptprozess: Speicher, Handy-Server, Texterkennungs-Warteschlange, PDF),
  `src/renderer` (Oberfläche), `src/core` (Bildverarbeitung, Auslesen, Prüflogik – ohne Electron testbar).
- Texterkennung: tesseract.js mit mitgeliefertem deutschen Modell (`resources/tessdata`), komplett offline.
  Die Bildverarbeitung (Seite finden, entzerren, Tabellengitter) ist eine JavaScript-Portierung von `ocr-test/`.
- Tests: `npm test` (tesseract.js) bzw. `npm run test:cli` (installiertes `tesseract`).
  Testbilder in `test/fixtures` sind künstlich erzeugt (`node test/make-fixtures.js`) und enthalten nur erfundene Daten.
- Installer: Jeder Push auf `main` baut über GitHub Actions die Setup.exe und stellt sie unter *Releases* bereit.
- Echte Belege nur lokal in `testdaten/` ablegen (ist in `.gitignore`).
