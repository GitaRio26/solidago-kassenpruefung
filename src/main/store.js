"use strict";
// Lokale Speicherung: <Nutzerprofil>/SOLIDAGO Kassenpruefung/Pruefdaten/state.json + belege/
const fs = require("fs");
const path = require("path");

function defaultState() {
  const now = new Date();
  const y = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1; // ab Oktober: laufendes Jahr
  return {
    version: 2, seq: 0,
    settings: {
      verein: "", jahr: y, pruefDatum: now.toISOString().slice(0, 10), von: `${y}-01-01`, bis: `${y}-12-31`,
      pruefer1: "", pruefer2: "", ort: "", kassier: "",
      vollst: "auto", gekennzeichnet: true, entlastung: "auto",
      weitererTermin: "", ergebnisZusatz: "", bemerkungen: "", sig1: null, sig2: null
    },
    clients: [], docs: {}, klaerung: {}
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.belege = path.join(dir, "belege");
    fs.mkdirSync(this.belege, { recursive: true });
    this.file = path.join(dir, "state.json");
    this.S = this.load();
    this.timer = null;
  }
  load() {
    for (const f of [this.file, this.file + ".bak"]) {
      try {
        const s = JSON.parse(fs.readFileSync(f, "utf8"));
        const d = defaultState();
        return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}) });
      } catch { /* nächste Datei versuchen */ }
    }
    return defaultState();
  }
  // verzögert und sicher speichern (erst temporäre Datei, dann umbenennen)
  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.S));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak");
      fs.renameSync(tmp, this.file);
    };
    if (now) write(); else this.timer = setTimeout(() => { try { write(); } catch (e) { console.error("Speichern:", e); } }, 400);
  }
  // Pfad-Operationen aus der Oberfläche: set(["docs", id, "daten", "betrag"], 12.5)
  set(p, value) {
    let o = this.S;
    for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] == null) o[p[i]] = typeof p[i + 1] === "number" ? [] : {}; o = o[p[i]]; }
    if (value === undefined) { if (Array.isArray(o)) o.splice(p[p.length - 1], 1); else delete o[p[p.length - 1]]; }
    else o[p[p.length - 1]] = value;
    this.save();
  }
  filePath(name) { return path.join(this.belege, path.basename(name)); }
  reset(keepClients) {
    for (const f of fs.readdirSync(this.belege)) { try { fs.unlinkSync(path.join(this.belege, f)); } catch {} }
    const d = defaultState();
    if (keepClients) {
      d.clients = this.S.clients;
      for (const k of ["verein", "pruefer1", "pruefer2", "ort", "kassier"]) d.settings[k] = this.S.settings[k];
      const y = (+this.S.settings.jahr || d.settings.jahr) + 1;
      Object.assign(d.settings, { jahr: y, von: `${y}-01-01`, bis: `${y}-12-31` });
    }
    this.S = d; this.save(true);
  }
  // Sicherung = Ordnerkopie (state.json + belege)
  backupTo(target) {
    fs.mkdirSync(path.join(target, "belege"), { recursive: true });
    this.save(true);
    fs.copyFileSync(this.file, path.join(target, "state.json"));
    for (const f of fs.readdirSync(this.belege)) fs.copyFileSync(path.join(this.belege, f), path.join(target, "belege", f));
  }
  restoreFrom(src) {
    const s = JSON.parse(fs.readFileSync(path.join(src, "state.json"), "utf8"));
    if (!s.docs || !s.settings) throw new Error("Keine gültige Sicherung (state.json fehlt oder ist unvollständig).");
    for (const f of fs.readdirSync(this.belege)) { try { fs.unlinkSync(path.join(this.belege, f)); } catch {} }
    const sb = path.join(src, "belege");
    if (fs.existsSync(sb)) for (const f of fs.readdirSync(sb)) fs.copyFileSync(path.join(sb, f), path.join(this.belege, f));
    const d = defaultState();
    this.S = Object.assign(d, s, { settings: Object.assign(d.settings, s.settings) });
    this.save(true);
  }
}

module.exports = { Store, defaultState };
