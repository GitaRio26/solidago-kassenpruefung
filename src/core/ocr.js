"use strict";
// Texterkennung – zwei austauschbare Anbindungen mit gleichem Ergebnisformat:
//   createTesseractJs(): tesseract.js (in der App, komplett offline, deutsches Sprachmodell liegt bei)
//   createCli():          installiertes tesseract-Programm (nur für Entwickler-Tests)
// Ergebnis von ocr(img, psm): { text, words: [{text, left, top, width, height, conf, line}] }
const path = require("path");
const { encodeGray } = require("./png");

function parseTSV(tsv) {
  const words = [], lines = new Map();
  for (const row of String(tsv).split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c.slice(11).join("\t").trim();
    if (!text) continue;
    const key = `${c[2]}.${c[3]}.${c[4]}`;
    const wd = { text, left: +c[6], top: +c[7], width: +c[8], height: +c[9], conf: +c[10], line: key };
    words.push(wd);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(text);
  }
  return { text: [...lines.values()].map(l => l.join(" ")).join("\n"), words };
}

// Ersatzweg: Wörter aus der Block-Struktur von tesseract.js
function fromBlocks(blocks) {
  const words = [], lines = [];
  blocks.forEach((b, bi) => (b.paragraphs || []).forEach((p, pi) => (p.lines || []).forEach((l, li) => {
    const key = `${bi}.${pi}.${li}`, t = [];
    for (const w of l.words || []) {
      const text = String(w.text || "").trim(); if (!text) continue;
      words.push({ text, left: w.bbox.x0, top: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0, conf: w.confidence, line: key });
      t.push(text);
    }
    if (t.length) lines.push(t.join(" "));
  })));
  return { text: lines.join("\n"), words };
}

function tessdataDir() {
  // in der installierten App liegt das Sprachmodell unter resources/tessdata
  const cands = [];
  if (process.resourcesPath) cands.push(path.join(process.resourcesPath, "tessdata"));
  cands.push(path.join(__dirname, "..", "..", "resources", "tessdata"));
  const fs = require("fs");
  return cands.find(p => fs.existsSync(path.join(p, "deu.traineddata"))) || cands[cands.length - 1];
}

async function createTesseractJs({ cachePath } = {}) {
  const T = require("tesseract.js");
  const worker = await T.createWorker("deu", T.OEM.LSTM_ONLY, {
    langPath: tessdataDir(), gzip: false, cacheMethod: "none", cachePath: cachePath || undefined,
    logger: () => {}, errorHandler: e => console.error("OCR:", e)
  });
  let queue = Promise.resolve();
  const ocr = (img, psm = 6) => {
    const run = async () => {
      await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
      const { data } = await worker.recognize(encodeGray(img), {}, { tsv: true, blocks: true, text: false });
      if (data.tsv) return parseTSV(data.tsv);
      return fromBlocks(data.blocks || []);
    };
    const p = queue.then(run, run); queue = p.catch(() => {}); return p;
  };
  return { ocr, close: () => worker.terminate(), name: "tesseract.js" };
}

function createCli() {
  const { execFileSync } = require("child_process");
  const fs = require("fs"), os = require("os");
  const ocr = async (img, psm = 6) => {
    const f = path.join(os.tmpdir(), `ocr_${process.pid}_${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(f, encodeGray(img));
    try {
      const out = execFileSync("tesseract", [f, "stdout", "-l", "deu", "--psm", String(psm), "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
      return parseTSV(out);
    } finally { fs.unlinkSync(f); }
  };
  return { ocr, close: async () => {}, name: "tesseract-cli" };
}

module.exports = { parseTSV, createTesseractJs, createCli, tessdataDir };
