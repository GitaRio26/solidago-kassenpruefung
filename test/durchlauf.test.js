// Durchlauf ohne Electron: Handy-Server -> Upload der Testfotos -> Auslesen -> Prüfung
// Aufruf: node test/durchlauf.test.js [--tjs]
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), assert = require("assert");
const req = m => { try { return require(m); } catch { return require("/opt/npm-tools/node_modules/" + m); } };
const sharp = req("sharp");
const { Store } = require("../src/main/store");
const { Leser } = require("../src/main/leser");
const { HandyServer } = require("../src/main/handy");
const OCR = require("../src/core/ocr");
const ip = require("../src/core/imgproc");
const P = require("../src/core/pruefung");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solidago-"));
  const store = new Store(dir);
  // Ersatz für nativeImage: JPEG mit sharp dekodieren (synchron vorbereitet)
  const decoded = new Map();
  const leser = new Leser({
    store, onChange: () => {}, renderPdf: async () => { throw new Error("kein PDF im Test"); },
    decodeImage: buf => decoded.get(buf.length),
    ocrFactory: async () => (process.argv.includes("--tjs") ? OCR.createTesseractJs() : OCR.createCli())
  });
  const handy = new HandyServer({ onFile: (b, n, batch) => leser.addFile(b, n, { quelle: "handy", batch }), statusFor: id => ({ status: store.S.docs[id]?.status }) });
  const info = await handy.start();
  const url = new URL(info.urls[0] || `http://127.0.0.1:${info.port}/u/${handy.token}`);
  const base = `http://127.0.0.1:${info.port}${url.pathname}`;
  const get = u => new Promise((res, rej) => http.get(u, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ code: r.statusCode, body: b })); }).on("error", rej));
  const post = (u, buf) => new Promise((res, rej) => { const r = http.request(u, { method: "POST" }, rr => { let b = ""; rr.on("data", c => b += c); rr.on("end", () => res({ code: rr.statusCode, body: b })); }); r.on("error", rej); r.end(buf); });

  assert.strictEqual((await get(base)).code, 200, "Upload-Seite");
  assert.strictEqual((await get(base.replace(handy.token, "falsch"))).code, 403, "falscher Schlüssel wird abgewiesen");
  const fx = path.join(__dirname, "fixtures");
  for (const f of ["antrag_999.jpg", "rechnung_1.jpg", "rechnung_2.jpg", "rechnung_3.jpg"]) {
    const buf = fs.readFileSync(path.join(fx, f));
    const { data, info: im } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
    decoded.set(buf.length, ip.gray(im.width, im.height, new Uint8Array(data)));
    const r = await post(`${base}/upload?name=${encodeURIComponent(f)}`, buf);
    assert.strictEqual(r.code, 200, "Upload " + f);
  }
  // gleiche Datei noch einmal -> identische Datei soll als Doppelung gemeldet werden
  await post(`${base}/upload?name=nochmal.jpg`, fs.readFileSync(path.join(fx, "rechnung_2.jpg")));
  handy.stop();
  const t0 = Date.now();
  while (leser.pending() && Date.now() - t0 < 180000) await new Promise(r => setTimeout(r, 200));
  const docs = Object.values(store.S.docs);
  console.log(docs.map(d => `${d.name}: ${d.status} ${d.typ} ${d.fehler || ""}`).join("\n"));
  assert.ok(docs.every(d => d.status === "fertig"), "alle gelesen");
  const R = P.pruefen(store.S);
  console.log("Klienten:", store.S.clients.map(c => c.nr + " " + c.name).join(", "));
  console.log("Befunde:\n " + R.befunde.map(b => `[${b.lvl}] ${b.text}`).join("\n "));
  assert.deepStrictEqual(store.S.clients.map(c => c.nr), ["999"]);
  assert.strictEqual(R.links.filter(l => l.zeilen.length).length, 3, "3 Rechnungen zugeordnet");
  assert.ok(R.befunde.some(b => b.key.startsWith("dopp:") && b.text.includes("Identische Bilddatei")), "identische Datei erkannt");
  store.save(true);
  assert.ok(fs.existsSync(path.join(dir, "state.json")));
  console.log("\n✓ Durchlauf erfolgreich (Daten in " + dir + ")");
})().catch(e => { console.error(e); process.exitCode = 1; });
