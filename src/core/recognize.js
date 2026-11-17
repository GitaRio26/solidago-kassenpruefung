"use strict";
// Auslesen von Anträgen und Rechnungen (Portierung von ocr-test/antrag_auslesen.py und pipeline.py)
const ip = require("./imgproc");

const KATS = ["PRAEV", "AMB", "STAT", "ZAB", "ZAER", "AHMIT"];
const UNSICHER_CONF = 70; // Wörter mit geringerer Erkennungs-Sicherheit werden markiert

// Stichworte für den Kategorie-Vorschlag bei Rechnungen
const KAT_WORDS = {
  ZAER: ["zahnersatz", "zahntechni", "dentallabor", "krone", "prothese", "implantat"],
  ZAB: ["zahnarzt", "zahnärzt", "zahnreinigung", "zahnmedizin", "kieferorthop"],
  AHMIT: ["apotheke", "heilmittel", "physiotherap", "arznei", "ergotherap", "logopäd", "massage", "krankengymnastik"],
  STAT: ["klinik", "krankenhaus", "stationär", "reha"],
  AMB: ["arztpraxis", "allgemeinmedizin", "heilpraktiker", "facharzt", "praxis für", "osteopath", "psychotherap"],
  PRAEV: ["kurs", "prävention", "yoga", "rückenschule", "pilates", "qigong", "fitness"]
};

const RE_DATE = /(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})(?!\d)/;
const RE_AMOUNT_G = /(?<![\d,.])(\d{1,3}(?:\.\d{3})+|\d{1,5}),(\d{2})(?!\d)/g;

function toISO(d, m, y) {
  y = +y; if (y < 100) y += 2000;
  d = +d; m = +m;
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parseDate(s) { const m = RE_DATE.exec(String(s || "")); return m ? toISO(m[1], m[2], m[3]) : null; }
function eur(s) { return Math.round(Number(String(s).replace(/\./g, "").replace(",", ".")) * 100) / 100; }
// Betrag in einer Tabellenzelle: auch "107.01" oder "107,01€" akzeptieren
function cellAmount(t) {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d{1,5})[,.](\d{2})€?$/.exec(t);
  return m ? eur(m[1].replace(/\./g, "") + "," + m[2]) : null;
}
function allAmounts(text) { return [...String(text).matchAll(RE_AMOUNT_G)].map(m => eur(m[1] + "," + m[2])); }
const minConf = ws => (ws.length ? Math.min(...ws.map(w => w.conf)) : 0);

// Wörter des Textes, die zu einem Treffer gehören (für die Sicherheit eines Feldes)
function confOf(words, value) {
  const parts = String(value).split(/\s+/).filter(Boolean);
  const hits = words.filter(w => {
    const c = w.text.replace(/[^\wÄÖÜäöüß,.\-]/g, "");
    return c.length >= 2 && parts.some(p => c.includes(p) || p.includes(c));
  });
  return hits.length ? minConf(hits) : 0;
}

function classify(text) {
  const t = String(text).toLowerCase();
  return /antrag\s*auf\s*auszahlung|solidago/.test(t) ? "antrag" : "rechnung";
}

// ---------- Antrag ----------
async function readAntrag(page, pageText, ocr) {
  const { clean, rowLines: tab } = ip.analyseTable(page);
  const res = { datum: null, mitglied: null, absender: null, name: null, gesamt: null, zeilen: [], summen: {}, unsicher: [], conf: {} };
  const head1 = parseKopf(pageText);
  Object.assign(res, head1.werte); res.conf = head1.conf;

  if (tab.length < 3) { res.unsicher.push("tabelle"); finishUnsicher(res); return res; }
  const t0 = tab[0], t1 = tab[tab.length - 1];

  // Kopf (oberhalb der Tabelle) noch einmal vergrößert lesen und vergleichen
  if (t0 > 100) {
    const hb = ip.adaptiveThreshold(ip.crop(page, 0, 0, page.w, t0), 31, 12);
    const head2 = parseKopf(await ocr(ip.resize(hb, Math.round(hb.w * 1.5), Math.round(hb.h * 1.5)), 6));
    for (const f of ["datum", "mitglied", "name"]) {
      const a = res[f], b = head2.werte[f];
      if (a == null && b != null) { res[f] = b; res.conf[f] = head2.conf[f]; if (f === "name") res.absender = head2.werte.absender; }
      else if (a != null && b != null && a !== b) res.conf[f] = 0; // widersprüchlich -> markieren
    }
  }

  // Spaltenmitten über die Kopfwörter
  const head = await ocr(ip.crop(clean, 0, t0 - 10, clean.w, t1 + 10), 11);
  const heads = {};
  for (const w of head.words) {
    const k = w.text.toUpperCase().replace(/[^A-Z]/g, "");
    if (KATS.includes(k) && !(k in heads)) heads[k] = w.left + Math.trunc(w.width / 2);
  }
  const known = Object.entries(heads).map(([k, x]) => [KATS.indexOf(k), x]).sort((a, b) => a[0] - b[0]);
  if (known.length < 2) { res.unsicher.push("spalten"); finishUnsicher(res); return res; }
  const [i0, x0] = known[0], [i1, x1] = known[known.length - 1], step0 = (x1 - x0) / (i1 - i0);
  KATS.forEach((k, i) => { if (!(k in heads)) heads[k] = Math.trunc(x0 + (i - i0) * step0); });
  const centers = KATS.map(k => heads[k]), step = (centers[5] - centers[0]) / 5;

  // jede Tabellenzeile als Streifen lesen – in drei Vergrößerungen. Weichen die Lesungen
  // voneinander ab, gilt die Mehrheit und die Stelle wird zur Kontrolle markiert.
  const parseRow = (words, scale) => {
    const row = { betraege: {}, conf: {} };
    for (const w of words) {
      const t = w.text.replace(/^[\s|.'"‚,;:]+|[\s|.'"‚,;:]+$/g, "");
      const cx = (w.left + w.width / 2) / scale - 15;
      const amt = cellAmount(t);
      if (RE_DATE.test(t) && parseDate(t) && cx < centers[0] - step * 0.6) { row.datum = parseDate(t); row.conf.datum = w.conf; }
      else if (t.toUpperCase().startsWith("SUMME")) row.nr = "SUMMEN";
      else if (amt != null) {
        let j = 0; for (let k = 1; k < 6; k++) if (Math.abs(centers[k] - cx) < Math.abs(centers[j] - cx)) j = k;
        if (Math.abs(centers[j] - cx) < step * 0.6) { row.betraege[KATS[j]] = amt; row.conf[KATS[j]] = w.conf; }
      } else if (/^\d{1,2}$/.test(t) && cx < centers[0] - 2 * step && row.nr == null) row.nr = t;
    }
    return row;
  };
  const vote = vals => { // häufigster Wert (bei Gleichstand der erste), einig = alle gleich
    const c = new Map(); vals.forEach(v => c.set(JSON.stringify(v ?? null), (c.get(JSON.stringify(v ?? null)) || 0) + 1));
    let best = null, n = 0; for (const [k, m] of c) if (m > n) { n = m; best = k; }
    return { value: JSON.parse(best), einig: c.size === 1 };
  };
  for (let r = 0; r < tab.length - 1; r++) {
    const a = tab[r], b = tab[r + 1];
    if (b - a < 25) continue;
    const strip = ip.pad(ip.crop(clean, 0, a + 3, clean.w, b - 3), 15);
    const reads = [];
    for (const sc of [1, 1.5, 2]) {
      const img = sc === 1 ? strip : ip.resize(strip, Math.round(strip.w * sc), Math.round(strip.h * sc));
      reads.push(parseRow((await ocr(img, 6)).words, sc));
    }
    const kats = KATS.filter(k => reads.some(x => x.betraege[k] != null));
    if (!kats.length) continue;
    const nr = vote(reads.map(x => x.nr)).value;
    if (reads.some(x => x.nr === "SUMMEN") || nr === "SUMMEN") {
      for (const k of kats) {
        const v = vote(reads.map(x => x.betraege[k]));
        if (v.value == null) continue;
        res.summen[k] = v.value;
        if (!v.einig || Math.min(...reads.map(x => x.conf[k] ?? 100)) < UNSICHER_CONF) res.unsicher.push("summe_" + k);
      }
      continue;
    }
    const dat = vote(reads.map(x => x.datum));
    for (const kat of kats) {
      const v = vote(reads.map(x => x.betraege[kat]));
      if (v.value == null) continue;
      const confs = reads.map(x => x.conf[kat]).filter(c => c != null);
      res.zeilen.push({ nr: nr || String(res.zeilen.length + 1), datum: dat.value, kat, betrag: v.value,
        unsicher: !v.einig || !dat.einig || !dat.value || Math.max(...confs) < UNSICHER_CONF });
    }
  }
  finishUnsicher(res);
  return res;
}
// Kopfangaben eines Antrags aus erkanntem Text
function parseKopf(pt) {
  const full = pt.text, werte = {}, conf = {};
  let m = /Auszahlung\s*vom\s*[:.]?\s*(\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4})/i.exec(full) || /Datum\s*[:.]?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(full);
  if (m) { werte.datum = parseDate(m[1]); conf.datum = confOf(pt.words, m[1]); }
  // "Mitgliedsnummer", auch bei Lesefehlern wie "Mitgledsnummer" oder "Mitglieds-Nr."
  m = /Mitgl\w*\s*[-.]?\s*(?:nr\.?|nummer)?\s*[:.;]?\s*(\d{1,6})\b/i.exec(full) || /Mi\w{0,3}gl\w*\D{0,25}?(\d{2,6})\b/i.exec(full);
  if (m) { werte.mitglied = m[1]; conf.mitglied = confOf(pt.words, m[1]); }
  m = /Absender\s*[:.;,]?\s*(.+)/i.exec(full);
  if (m) {
    werte.absender = m[1].replace(/^[^A-Za-zÄÖÜäöü]+/, "").trim();
    werte.name = werte.absender.split(",")[0].trim(); conf.name = confOf(pt.words, werte.name);
  }
  m = /Gesamtsumme\s*(?:von)?\s*[:.]?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,5},\d{2})/i.exec(full);
  if (m) { werte.gesamt = eur(m[1]); conf.gesamt = confOf(pt.words, m[1]); }
  return { werte, conf };
}
function finishUnsicher(res) {
  for (const f of ["datum", "mitglied", "gesamt", "name"]) if (res[f] == null || (res.conf[f] ?? 0) < UNSICHER_CONF) res.unsicher.push(f);
  delete res.conf;
  // Gegenprobe: Wenn Zeilen, Summenzeile und Gesamtsumme zusammenpassen, sind diese Beträge bestätigt
  const r2 = x => Math.round(x * 100) / 100;
  const kats = Object.keys(res.summen);
  const colOk = k => r2(res.zeilen.filter(z => z.kat === k).reduce((a, z) => a + z.betrag, 0)) === res.summen[k];
  if (kats.length && kats.every(colOk)) {
    res.unsicher = res.unsicher.filter(f => !f.startsWith("summe_"));
    if (res.gesamt != null && r2(kats.reduce((a, k) => a + res.summen[k], 0)) === res.gesamt) res.unsicher = res.unsicher.filter(f => f !== "gesamt");
  }
  res.unsicher = [...new Set(res.unsicher)];
}

// ---------- Rechnung ----------
function readRechnung(pageText) {
  const t = pageText.text, low = t.toLowerCase(), words = pageText.words;
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  const res = { aussteller: null, nummer: null, datum: null, betrag: null, alleBetraege: [], kategorie: null, bezahlt: false, unsicher: [] };

  // Aussteller: erste Zeile mit genug Buchstaben (Randstriche usw. abschneiden)
  for (const l of lines.slice(0, 8)) {
    const c = l.replace(/^[^A-Za-zÄÖÜäöüß]+/, "").replace(/[^A-Za-zÄÖÜäöüß.)]+$/, "");
    if ((c.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 4) { res.aussteller = c; break; }
  }
  // "Rechnungsnummer", auch mit Lesefehlern ("Rechnengsnummer", "Rechnungs-Nr.")
  const NUM = "\\s*[:.;]?\\s*([A-Za-z0-9][A-Za-z0-9\\-\\/.]*[A-Za-z0-9]|\\d)";
  let m = new RegExp("\\bRe\\w{2,9}\\s*-?\\s*(?:nu\\w{3,5}|nr\\.?|no\\.?)" + NUM, "i").exec(t)
    || new RegExp("\\bBeleg\\s*-?\\s*(?:nu\\w{3,5}|nr\\.?)" + NUM, "i").exec(t);
  if (m) res.nummer = m[1];
  m = /\bRe\w{2,9}\s*-?\s*datum\s*[:.;]?\s*(\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4})/i.exec(t) || /Datum\s*[:.;]?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(t) || RE_DATE.exec(t);
  if (m) res.datum = parseDate(m[1] && m[2] && m[3] ? `${m[1]}.${m[2]}.${m[3]}` : m[1]);

  // Rechnungsbetrag: Stichworte in dieser Rangfolge, jeweils letzter Treffer
  const AMT = "(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d{1,5},\\d{2})";
  for (const kw of ["rechnungsbetrag", "gesamtbetrag", "endbetrag", "zu\\s*zahlen", "zahlbetrag", "gesamtsumme", "rechnungssumme", "summe", "gesamt", "betrag"]) {
    const hits = [...t.matchAll(new RegExp(kw + "[^\\d\\n]{0,30}" + AMT, "gi"))];
    if (hits.length) { const h = hits[hits.length - 1]; res.betrag = eur(h[1]); if (confOf(words, h[1]) < UNSICHER_CONF) res.unsicher.push("betrag"); break; }
  }
  res.alleBetraege = [...new Set(allAmounts(t))].sort((a, b) => a - b);
  if (res.betrag == null && res.alleBetraege.length) { res.betrag = Math.max(...res.alleBetraege); res.unsicher.push("betrag"); }

  let best = 0;
  for (const [k, ws] of Object.entries(KAT_WORDS)) {
    const n = ws.reduce((a, w) => a + low.split(w).length - 1, 0);
    if (n > best) { best = n; res.kategorie = k; }
  }
  res.bezahlt = /betrag\s*(dankend\s*)?erhalten|bar\s*bezahlt|quittiert|betrag\s*bezahlt/i.test(t);
  for (const f of ["aussteller", "datum", "betrag"]) if (res[f] == null && !res.unsicher.includes(f)) res.unsicher.push(f);
  return res;
}

// ---------- Gesamtablauf für ein Bild ----------
// img: Graubild des Fotos (bereits richtig gedreht laut EXIF). ocr: Funktion aus ocr.js
async function recognize(img, ocr) {
  let { page, quad } = ip.warpPage(img);
  let bin = ip.adaptiveThreshold(page, 31, 12);
  let txt = await ocr(bin, 6);
  // Falls kaum lesbarer Text: Seite steht vermutlich auf dem Kopf oder quer
  const quality = r => r.words.filter(w => w.conf > 70 && /[A-Za-zÄÖÜäöü]{3}/.test(w.text)).length;
  if (quality(txt) < 12) {
    for (const deg of [180, 90, 270]) {
      const p2 = deg === 180 ? ip.rotate(page, 180) : ip.warpPage(ip.rotate(img, deg)).page;
      const b2 = ip.adaptiveThreshold(p2, 31, 12), t2 = await ocr(b2, 6);
      if (quality(t2) > quality(txt) * 1.5 + 3) { page = p2; bin = b2; txt = t2; }
      if (quality(txt) >= 12) break;
    }
  }
  const typ = classify(txt.text);
  const daten = typ === "antrag" ? await readAntrag(page, txt, ocr) : readRechnung(txt);
  return { typ, daten, page, seitenrand: !!quad, text: txt.text };
}

module.exports = { recognize, classify, readRechnung, readAntrag, parseDate, cellAmount, allAmounts, eur, KATS };
