// Erzeugt künstliche Testbilder (erfundene Daten) für die Auslese-Tests:
// Formular als HTML -> PNG (Chrome) -> "Handyfoto" (verzerrt, verkleinert, Hintergrund).
// Aufruf: node test/make-fixtures.js   (braucht playwright + sharp, nur für Entwickler)
const path = require("path");
const fs = require("fs");
const req = m => { try { return require(m); } catch { return require("/opt/npm-tools/node_modules/" + m); } };
const { chromium } = req("playwright");
const sharp = req("sharp");
const OUT = path.join(__dirname, "fixtures");

const COLS = ["PRAEV", "AMB", "STAT", "ZAB", "ZAER", "AHMIT"];
function antragHTML(a) {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const z = a.zeilen[i];
    rows.push(`<tr><td>${i + 1}</td><td>${z ? z.datum : ""}</td>${COLS.map(c => `<td class="n">${z && z.kat === c ? z.betrag : ""}</td>`).join("")}</tr>`);
  }
  const sums = COLS.map(c => a.summen[c] || "");
  return `<html><body style="margin:0;width:1240px;height:1754px;background:#fff;font-family:Arial;color:#111">
  <div style="padding:70px 90px">
   <div style="display:flex;justify-content:space-between"><div style="font-size:44px;font-weight:bold;color:#3f9a45">SOLIDAGO</div>
   <div style="font-size:18px;text-align:right">Solidargemeinschaft für Gesundheit e.V.</div></div>
   <div style="font-size:30px;font-weight:bold;margin:50px 0 30px">Antrag auf Auszahlung vom ${a.datum}</div>
   <div style="font-size:22px;line-height:1.9">Mitgliedsnummer ${a.nr}<br>Absender: ${a.name}, ${a.adresse}</div>
   <table style="border-collapse:collapse;margin-top:40px;width:100%;font-size:21px">
    <tr style="height:62px"><th style="width:80px">Beleg-Nr.</th><th style="width:150px">Beleg-Datum</th>${COLS.map(c => `<th>${c}</th>`).join("")}</tr>
    ${rows.join("")}
    <tr style="height:62px"><td colspan="2"><b>SUMMEN</b></td>${sums.map(s => `<td class="n"><b>${s}</b></td>`).join("")}</tr>
   </table>
   <div style="font-size:24px;margin-top:40px">Gesamtsumme von ${a.gesamt} €</div>
   <div style="font-size:16px;margin-top:30px">Anlage ☐ weitere Summen in Zeile 10</div>
   <div style="margin-top:80px;border-top:1px solid #000;width:400px;font-size:16px">Datum, Unterschrift</div>
  </div>
  <style>td,th{border:2px solid #222;padding:6px 8px;height:62px} td.n{text-align:right} th{font-size:19px}</style>
  </body></html>`;
}
function rechnungHTML(r) {
  return `<html><body style="margin:0;width:1240px;height:1754px;background:#fff;font-family:Arial;color:#111">
  <div style="padding:90px 110px;font-size:22px;line-height:1.6">
   <div style="font-size:30px;font-weight:bold">${r.aussteller}</div>
   <div>${r.adresse}</div>
   <div style="margin-top:80px">${r.patient}</div>
   <div style="margin-top:60px;font-size:28px;font-weight:bold">Rechnung</div>
   <div>Rechnungsnummer: ${r.nummer}</div>
   <div>Rechnungsdatum: ${r.datum}</div>
   <table style="margin-top:40px;width:100%;border-collapse:collapse">
    <tr><th align="left">Datum</th><th align="left">Leistung</th><th align="right">Betrag</th></tr>
    ${r.pos.map(p => `<tr><td>${r.datum}</td><td>${p[0]}</td><td align="right">${p[1]} €</td></tr>`).join("")}
   </table>
   <div style="margin-top:40px;font-weight:bold">Rechnungsbetrag: ${r.betrag} €</div>
   <div style="margin-top:60px">Bitte überweisen Sie den Betrag innerhalb von 30 Tagen.</div>
  </div></body></html>`;
}

const ANTRAG = {
  datum: "26.10.2026", nr: "999", name: "Erika Beispiel", adresse: "Musterweg 1, 01067 Dresden", gesamt: "171,73",
  zeilen: [{ datum: "02.09.2026", kat: "ZAB", betrag: "107,01" }, { datum: "16.09.2026", kat: "ZAB", betrag: "17,73" }, { datum: "20.09.2026", kat: "AHMIT", betrag: "46,99" }],
  summen: { ZAB: "124,74", AHMIT: "46,99" }
};
const RECHNUNGEN = [
  { aussteller: "Zahnarztpraxis Dr. Muster", adresse: "Hauptstraße 5, 01067 Dresden", patient: "Frau Erika Beispiel", nummer: "R2026-0815", datum: "02.09.2026", pos: [["Zahnärztliche Untersuchung", "57,01"], ["Professionelle Zahnreinigung", "50,00"]], betrag: "107,01" },
  { aussteller: "Zahnarztpraxis Dr. Muster", adresse: "Hauptstraße 5, 01067 Dresden", patient: "Frau Erika Beispiel", nummer: "R2026-0902", datum: "16.09.2026", pos: [["Beratung", "17,73"]], betrag: "17,73" },
  { aussteller: "Linden-Apotheke", adresse: "Am Markt 2, 01067 Dresden", patient: "Frau Erika Beispiel", nummer: "A-55120", datum: "20.09.2026", pos: [["Arznei Johanniskraut", "21,99"], ["Heilmittel Salbe", "25,00"]], betrag: "46,99" }
];

// "Handyfoto": Seite verkleinert, perspektivisch verzerrt auf dunklen Tisch, 720x1280 JPEG
async function photo(png, file, tilt) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = 720, H = 1280, out = Buffer.alloc(W * H);
  // Zielecken der Seite im Foto
  const dst = [[60 + tilt, 90], [670, 70 + tilt], [690 - tilt, 1200], [40, 1180 - tilt]];
  const src = [[0, 0], [info.width, 0], [info.width, info.height], [0, info.height]];
  const Hm = homography(dst, src); // Foto -> Seite
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Hm[6] * x + Hm[7] * y + 1, u = (Hm[0] * x + Hm[1] * y + Hm[2]) / d, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / d;
    let val;
    if (u >= 0 && v >= 0 && u < info.width - 1 && v < info.height - 1) {
      // Mittelwert 2x2 Block (leichte Unschärfe wie Handy)
      const i = (v | 0) * info.width + (u | 0);
      val = (data[i] + data[i + 1] + data[i + info.width] + data[i + info.width + 1]) / 4;
      val = 30 + val * 0.82 - (y / H) * 18; // etwas dunkler/ungleichmäßig beleuchtet
    } else val = 55 + ((x * 7 + y * 13) % 11);
    out[y * W + x] = Math.max(0, Math.min(255, val + ((x * 31 + y * 17) % 7) - 3));
  }
  await sharp(out, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 85 }).toFile(file);
}
function homography(s, d) { // löst 8 Unbekannte, s -> d
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = s[i], [u, v] = d[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1240, height: 1754 } });
  const jobs = [["antrag_999", antragHTML(ANTRAG), 25], ...RECHNUNGEN.map((r, i) => [`rechnung_${i + 1}`, rechnungHTML(r), 10 + i * 12])];
  for (const [name, html, tilt] of jobs) {
    await pg.setContent(html);
    const png = await pg.screenshot({ fullPage: false });
    await photo(png, path.join(OUT, name + ".jpg"), tilt);
  }
  await br.close();
  fs.writeFileSync(path.join(OUT, "erwartet.json"), JSON.stringify({ antrag: ANTRAG, rechnungen: RECHNUNGEN }, null, 1));
  console.log("Testbilder erzeugt in", OUT);
})();
