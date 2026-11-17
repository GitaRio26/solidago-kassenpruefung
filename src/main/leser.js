"use strict";
// Warteschlange für das Auslesen der eingegangenen Belege (läuft im Hintergrund der App).
const fs = require("fs");
const path = require("path");
const ip = require("../core/imgproc");
const { recognize } = require("../core/recognize");
const { encodeGray, jpegOrientation, orientationToDeg } = require("../core/png");
const P = require("../core/pruefung");

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

class Leser {
  // store: Store, ocrFactory: () => Promise<{ocr}>, decodeImage(buf) -> gray, renderPdf(docId) -> [gray], onChange()
  constructor({ store, ocrFactory, decodeImage, renderPdf, onChange }) {
    Object.assign(this, { store, ocrFactory, decodeImage, renderPdf, onChange });
    this.queue = []; this.running = false; this.engine = null;
  }
  get S() { return this.store.S; }

  // neue Datei aufnehmen
  addFile(buf, origName, { quelle = "import", batch = null } = {}) {
    const S = this.S, id = uid();
    const ext = (path.extname(origName || "").toLowerCase().match(/^\.(jpe?g|png|pdf|webp|gif|bmp)$/) || [".jpg"])[0];
    const file = id + ext;
    fs.writeFileSync(this.store.filePath(file), buf);
    const hash = require("crypto").createHash("sha256").update(buf).digest("hex");
    S.seq = (S.seq || 0) + 1;
    S.docs[id] = { id, name: origName || file, file, previews: [], hash, size: buf.length, seq: S.seq, batch, quelle,
      eingang: new Date().toISOString(), status: "wartet", typ: null, daten: null, bestaetigt: {} };
    this.store.save(); this.onChange();
    this.enqueue(id);
    return id;
  }
  enqueue(id) { if (!this.queue.includes(id)) this.queue.push(id); this.run(); }
  pending() { return this.queue.length + (this.running ? 1 : 0); }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift(), d = this.S.docs[id];
        if (!d) continue;
        d.status = "liest"; d.fehler = null; this.onChange();
        try { await this.read(d); }
        catch (e) { console.error(e); d.status = "fehler"; d.fehler = String(e && e.message || e); }
        this.store.save(); this.onChange();
      }
    } finally { this.running = false; }
  }

  async read(d) {
    if (!this.engine) this.engine = await this.ocrFactory();
    const buf = fs.readFileSync(this.store.filePath(d.file));
    let pages;
    if (/\.pdf$/i.test(d.file)) pages = await this.renderPdf(d.id);
    else {
      let img = this.decodeImage(buf);
      // Handyfotos: Drehung laut EXIF (nur wenn das Bild noch nicht hochkant gedreht ist)
      const deg = orientationToDeg(jpegOrientation(buf));
      if (deg && !(deg % 180 && img.h > img.w)) img = ip.rotate(img, deg);
      pages = [img];
    }
    if (!pages || !pages.length) throw new Error("Datei enthält keine lesbare Seite.");

    const results = [];
    for (let i = 0; i < pages.length; i++) {
      const r = await recognize(pages[i], this.engine.ocr);
      const pv = `${d.id}_s${i + 1}.png`;
      fs.writeFileSync(this.store.filePath(pv), encodeGray(r.page, 200));
      results.push({ ...r, preview: pv });
    }
    // Seiten zu Belegen zusammenfassen: neue Gruppe bei jedem Antrag und bei jeder Rechnung mit eigener Nummer/eigenem Datum
    const groups = [];
    for (const r of results) {
      const last = groups[groups.length - 1];
      const folge = last && r.typ === "rechnung" && last.typ === "rechnung" && ((!r.daten.nummer && !r.daten.datum) || (r.daten.nummer && r.daten.nummer === last.daten.nummer));
      if (folge) mergeRechnung(last, r); else groups.push({ ...r, previews: [r.preview] });
    }
    groups.forEach((g, i) => {
      const doc = i === 0 ? d : (() => {
        const nid = uid();
        const n = { ...d, id: nid, name: `${d.name} (Teil ${i + 1})`, seq: d.seq + i / 100, bestaetigt: {}, zuordnung: undefined, hash: d.hash + ":" + i };
        this.S.docs[nid] = n; return n;
      })();
      if (g.typ === "antrag") g.daten.zeilen.forEach(z => { z.id = uid(); });
      Object.assign(doc, { status: "fertig", typ: doc.typManuell || g.typ, daten: g.daten, previews: g.previews, seitenrand: g.seitenrand, text: g.text.slice(0, 4000) });
    });
    if (groups.length > 1) d.hash = d.hash + ":0";
    // Einzelnes Foto einer Folgeseite (ohne Nummer/Datum) an die vorherige Rechnung derselben Übertragung hängen
    if (groups.length === 1 && d.typ === "rechnung" && !d.daten.nummer && !d.daten.datum && d.batch) {
      const prev = Object.values(this.S.docs).filter(x => x.batch === d.batch && x.seq < d.seq && x.status === "fertig" && x.typ !== "folgeseite").sort((a, b) => b.seq - a.seq)[0];
      if (prev && prev.typ === "rechnung") {
        mergeRechnung(prev, { daten: d.daten, text: d.text || "", previews: d.previews });
        prev.previews = [...prev.previews, ...d.previews];
        d.typ = "folgeseite"; d.folgeVon = prev.id;
      }
    }
    P.syncKlienten(this.S);
  }

  async close() { if (this.engine) { await this.engine.close(); this.engine = null; } }

  // erneut lesen, optional mit vorgegebenem Typ ("antrag" | "rechnung")
  reread(id, typ) {
    const d = this.S.docs[id]; if (!d) return;
    if (typ) d.typManuell = typ;
    d.status = "wartet"; d.bestaetigt = {}; delete d.folgeVon;
    this.enqueue(id); this.onChange();
  }
  remove(id) {
    const d = this.S.docs[id]; if (!d) return;
    const shared = Object.values(this.S.docs).some(x => x.id !== id && x.file === d.file);
    const files = [...(d.previews || []), ...(shared ? [] : [d.file])];
    for (const f of files) { try { fs.unlinkSync(this.store.filePath(f)); } catch {} }
    delete this.S.docs[id];
    for (const k of Object.keys(this.S.klaerung || {})) if (k.includes(id)) delete this.S.klaerung[k];
    this.queue = this.queue.filter(x => x !== id);
    this.store.save(); this.onChange();
  }
}

function mergeRechnung(target, r) {
  const t = target.daten, n = r.daten;
  if (t.betrag == null || (n.betrag != null && n.unsicher && !n.unsicher.includes("betrag"))) t.betrag = n.betrag ?? t.betrag;
  t.alleBetraege = [...new Set([...(t.alleBetraege || []), ...(n.alleBetraege || [])])].sort((a, b) => a - b);
  t.kategorie = t.kategorie || n.kategorie;
  t.bezahlt = t.bezahlt || n.bezahlt;
  if (r.preview) target.previews = [...(target.previews || []), r.preview];
  target.text = (target.text || "") + "\n" + (r.text || "");
}

module.exports = { Leser, uid };
