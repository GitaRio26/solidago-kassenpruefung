// Entwickler-Werkzeug: Oberfläche im Browser mit Test-Attrappe statt Electron starten und Bildschirmfotos machen.
// Liest die Testbilder mit der echten Auslese-Logik (tesseract-Programm) und zeigt das Ergebnis in der Oberfläche.
// Aufruf: node test/ui-preview.js <ausgabeordner>
const http = require("http"), fs = require("fs"), path = require("path");
const req = m => { try { return require(m); } catch { return require("/opt/npm-tools/node_modules/" + m); } };
const { chromium } = req("playwright"); const sharp = req("sharp");
const ip = require("../src/core/imgproc"); const OCR = require("../src/core/ocr");
const { recognize } = require("../src/core/recognize"); const { encodeGray } = require("../src/core/png");
const P = require("../src/core/pruefung");

const ROOT = path.join(__dirname, ".."), OUT = process.argv[2] || "/tmp/ui", FX = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });
const tmpBelege = fs.mkdtempSync("/tmp/belege-");

async function buildState() {
  const eng = OCR.createCli(); const S = { version: 2, seq: 0, settings: { verein: "", jahr: 2026, pruefDatum: "2026-11-17", von: "2026-01-01", bis: "2026-12-31", pruefer1: "", pruefer2: "", ort: "", kassier: "", vollst: "auto", gekennzeichnet: true, entlastung: "auto", weitererTermin: "", ergebnisZusatz: "", bemerkungen: "", sig1: null, sig2: null }, clients: [], docs: {}, klaerung: {} };
  for (const f of fs.readdirSync(FX).filter(f => f.endsWith(".jpg")).sort()) {
    const { data, info } = await sharp(path.join(FX, f)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const r = await recognize(ip.gray(info.width, info.height, new Uint8Array(data)), eng.ocr);
    const id = f.replace(".jpg", ""); fs.copyFileSync(path.join(FX, f), path.join(tmpBelege, f));
    fs.writeFileSync(path.join(tmpBelege, id + "_s1.png"), encodeGray(r.page));
    if (r.typ === "antrag") r.daten.zeilen.forEach((z, i) => { z.id = id + "z" + i; });
    S.docs[id] = { id, name: f, file: f, previews: [id + "_s1.png"], seq: ++S.seq, batch: "h1", quelle: "handy", eingang: new Date().toISOString(), status: "fertig", typ: r.typ, daten: r.daten, bestaetigt: {} };
  }
  // ein Beleg, der noch gelesen wird
  S.docs.x = { id: "x", name: "IMG_2041.jpg", file: "rechnung_1.jpg", previews: [], seq: ++S.seq, batch: "h1", quelle: "handy", eingang: new Date().toISOString(), status: "liest", typ: null, daten: null, bestaetigt: {} };
  P.syncKlienten(S);
  return S;
}

(async () => {
  const S = await buildState();
  const map = { "/core/pruefung.js": path.join(ROOT, "src/core/pruefung.js"), "/vendor/pdf.min.js": path.join(__dirname, "make-fixtures.js").replace("make-fixtures.js", "leer.js") };
  const srv = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    let p = map[u] || (u.startsWith("/beleg/") ? path.join(tmpBelege, path.basename(u)) : path.join(ROOT, "src/renderer", u));
    if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "Content-Type": p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".html") ? "text/html; charset=utf-8" : "image/png" });
    fs.createReadStream(p).pipe(s);
  }).listen(0);
  const port = srv.address().port;
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const errors = []; pg.on("pageerror", e => errors.push(e.message)); pg.on("console", m => m.type() === "error" && errors.push(m.text()));
  await pg.addInitScript(state => {
    let S = state, cb = null;
    const setp = (o, p, v) => { for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] == null) o[p[i]] = typeof p[i + 1] === "number" ? [] : {}; o = o[p[i]]; } if (v === undefined) { if (Array.isArray(o)) o.splice(p[p.length - 1], 1); else delete o[p[p.length - 1]]; } else o[p[p.length - 1]] = v; };
    window.api = {
      getState: async () => ({ S: JSON.parse(JSON.stringify(S)), pending: 1, version: "0.1.0-test", datenOrdner: "C:\\Users\\Prüfer\\AppData\\Roaming\\SOLIDAGO Kassenpruefung\\Pruefdaten" }),
      set: async (p, v) => { setp(S, p, v === undefined ? undefined : JSON.parse(JSON.stringify(v))); return true; },
      onState: f => { cb = f; }, onPdfRender: () => {}, pdfResult: async () => {},
      importFiles: async () => 0, importDialog: async () => 0, reread: async () => {}, removeDoc: async id => { delete S.docs[id]; cb && cb({ S: JSON.parse(JSON.stringify(S)), pending: 0 }); },
      handyStart: async () => ({ urls: ["http://192.168.178.24:47110/u/Xy7kP2mQ9aLr"], qr: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><rect x="20" y="20" width="60" height="60" fill="#000"/><rect x="160" y="20" width="60" height="60" fill="#000"/><rect x="20" y="160" width="60" height="60" fill="#000"/><text x="120" y="130" font-size="14" text-anchor="middle">QR</text></svg>'), batch: "h1" }),
      handyStop: async () => {}, reportPdf: async () => { window.print(); return null; }, backup: async () => null, restore: async () => false,
      reset: async () => true, replaceAll: async n => { S = n; cb && cb({ S: JSON.parse(JSON.stringify(S)), pending: 0 }); return true; }, openFolder: async () => {},
      belegUrl: f => "/beleg/" + encodeURIComponent(f)
    };
    window.__finish = () => { S.docs.x.status = "fertig"; S.docs.x.typ = "rechnung"; S.docs.x.daten = { aussteller: "Optiker Klarblick", nummer: "O-5", datum: "2026-07-07", betrag: 120, alleBetraege: [120], kategorie: null, bezahlt: false, unsicher: ["betrag"] }; cb({ S: JSON.parse(JSON.stringify(S)), pending: 0 }); };
  }, S);
  await pg.goto(`http://localhost:${port}/index.html`);
  await pg.waitForTimeout(800);
  const shot = async n => { await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(OUT, n + ".png"), fullPage: false }); };
  await shot("1_eingang");
  await pg.evaluate(() => window.__finish()); await shot("2_eingang_fertig");
  await pg.click("tr[data-doc=antrag_999]"); await pg.waitForTimeout(800); await shot("3_antrag");
  await pg.click("#back"); await pg.click("tr[data-doc=x]"); await pg.waitForTimeout(500); await shot("4_rechnung");
  await pg.click("#back");
  await pg.click("[data-tab=pruefung]"); await shot("5_pruefung");
  await pg.click("[data-tab=klienten]"); await shot("6_klienten");
  await pg.click("#btnHandy"); await shot("7_handy"); await pg.click("#hClose");
  // Beispieldaten
  await pg.click("[data-tab=daten]"); await pg.click("#demo"); await pg.click("#mYes"); await pg.waitForTimeout(600);
  await pg.click("[data-tab=pruefung]"); await shot("8_demo_pruefung");
  await pg.click("[data-tab=bericht]"); await shot("9_bericht");
  await pg.evaluate(() => buildReport());
  await pg.emulateMedia({ media: "print" });
  await pg.pdf({ path: path.join(OUT, "bericht.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  await br.close(); srv.close();
  console.log(errors.length ? "Fehler in der Seite:\n" + errors.join("\n") : "Keine Skriptfehler.");
  console.log("Bilder in", OUT);
})().catch(e => { console.error(e); process.exit(1); });
