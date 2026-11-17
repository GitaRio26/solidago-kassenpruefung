// Liest die Testbilder aus test/fixtures (oder übergebene Dateien) und vergleicht mit erwartet.json.
// Aufruf: node test/auslesen.test.js [--tjs] [bild.jpg ...]
//   --tjs  = tesseract.js verwenden (wie in der App), sonst das installierte tesseract-Programm
const path = require("path"), fs = require("fs");
const req = m => { try { return require(m); } catch { return require("/opt/npm-tools/node_modules/" + m); } };
const sharp = req("sharp");
const ip = require("../src/core/imgproc");
const { recognize } = require("../src/core/recognize");
const OCR = require("../src/core/ocr");

async function load(file) {
  const { data, info } = await sharp(file).rotate().greyscale().raw().toBuffer({ resolveWithObject: true });
  return ip.gray(info.width, info.height, new Uint8Array(data));
}

(async () => {
  const args = process.argv.slice(2), tjs = args.includes("--tjs");
  let files = args.filter(a => !a.startsWith("--"));
  const fx = path.join(__dirname, "fixtures");
  const useFixtures = !files.length;
  if (useFixtures) files = fs.readdirSync(fx).filter(f => f.endsWith(".jpg")).sort().map(f => path.join(fx, f));
  const eng = tjs ? await OCR.createTesseractJs() : OCR.createCli();
  console.log("Texterkennung:", eng.name);
  const out = {};
  for (const f of files) {
    const t = Date.now();
    const r = await recognize(await load(f), eng.ocr);
    out[path.basename(f)] = r;
    console.log(`\n[${path.basename(f)}] ${r.typ}  (${Date.now() - t} ms, Seitenrand ${r.seitenrand ? "gefunden" : "NICHT gefunden"})`);
    console.log(JSON.stringify(r.daten, null, 1));
  }
  await eng.close();
  if (!useFixtures) return;

  // Vergleich mit den erwarteten Werten
  const exp = JSON.parse(fs.readFileSync(path.join(fx, "erwartet.json"), "utf8"));
  const iso = s => s.split(".").reverse().join("-"), num = s => Number(s.replace(",", "."));
  // Ein falsch gelesener Wert ist nur dann ein Fehler, wenn er NICHT zur Kontrolle markiert wurde
  const errs = [], marked = [];
  const check = (what, got, want, flagged = false) => {
    if (got === want) return;
    (flagged ? marked : errs).push(`${what}: erkannt ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)}`);
  };
  const A = out["antrag_999.jpg"];
  check("Antrag Typ", A.typ, "antrag");
  const u = f => A.daten.unsicher.includes(f);
  check("Antrag Datum", A.daten.datum, iso(exp.antrag.datum), u("datum"));
  check("Mitgliedsnummer", A.daten.mitglied, exp.antrag.nr, u("mitglied"));
  check("Name", A.daten.name, exp.antrag.name, u("name"));
  check("Gesamtsumme", A.daten.gesamt, num(exp.antrag.gesamt), u("gesamt"));
  check("Anzahl Zeilen", A.daten.zeilen.length, exp.antrag.zeilen.length);
  exp.antrag.zeilen.forEach((z, i) => {
    const g = A.daten.zeilen[i] || {};
    check(`Zeile ${i + 1} Datum`, g.datum, iso(z.datum), g.unsicher); check(`Zeile ${i + 1} Spalte`, g.kat, z.kat); check(`Zeile ${i + 1} Betrag`, g.betrag, num(z.betrag), g.unsicher);
  });
  for (const [k, v] of Object.entries(exp.antrag.summen)) check(`Summe ${k}`, A.daten.summen[k], num(v), u("summe_" + k));
  exp.rechnungen.forEach((r, i) => {
    const g = out[`rechnung_${i + 1}.jpg`];
    check(`Rechnung ${i + 1} Typ`, g.typ, "rechnung");
    check(`Rechnung ${i + 1} Betrag`, g.daten.betrag, num(r.betrag));
    check(`Rechnung ${i + 1} Datum`, g.daten.datum, iso(r.datum));
    check(`Rechnung ${i + 1} Nummer`, g.daten.nummer, r.nummer);
    check(`Rechnung ${i + 1} Aussteller`, g.daten.aussteller, r.aussteller);
  });
  if (marked.length) console.log(`\n● ${marked.length} Lesefehler, aber korrekt zur Kontrolle markiert:\n  ` + marked.join("\n  "));
  console.log(errs.length ? `\n✗ ${errs.length} unbemerkte Abweichung(en):\n  ` + errs.join("\n  ") : "\n✓ Alle Werte korrekt erkannt oder zur Kontrolle markiert.");
  process.exitCode = errs.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; })
  .finally(() => setTimeout(() => process.exit(), 500));
