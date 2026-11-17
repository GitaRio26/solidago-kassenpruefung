// Prüflogik der Kassenprüfung – läuft in der Oberfläche und in den Tests (keine Abhängigkeiten).
//
// Datenmodell (Ausschnitt):
//   S.docs[id] = { id, name, seq, batch, hash, status: "wartet"|"liest"|"fertig"|"fehler",
//                  typ: "antrag"|"rechnung", daten: {...}, bestaetigt: {feld: true}, zuordnung?, klientNr? }
//     Antrag-daten:   { datum, mitglied, name, gesamt, summen:{KAT:betrag}, zeilen:[{id,nr,datum,kat,betrag,unsicher}], unsicher:[feld] }
//     Rechnung-daten: { aussteller, nummer, datum, betrag, alleBetraege, kategorie, bezahlt, unsicher:[feld] }
//     zuordnung (nur Rechnung, vom Prüfer gesetzt): { antragId, zeilen:[zeileId] }  oder  { keine:true }
//   S.clients = [{ id, nr, name, adresse }]
//   S.klaerung[befundKey] = { geklaert, bemerkung }
(function (root) {
  "use strict";
  const KATS = [["PRAEV", "Prävention"], ["AMB", "Ambulant"], ["STAT", "stationär"], ["ZAB", "Zahnarzt"], ["ZAER", "Zahnersatz"], ["AHMIT", "Arznei u. Heilmittel"]];
  const KAT_KEYS = KATS.map(k => k[0]);
  const EPS = 0.005;
  const r2 = x => Math.round((x || 0) * 100) / 100;
  const sum = a => r2(a.reduce((s, x) => s + (x || 0), 0));
  const eq = (a, b) => a != null && b != null && Math.abs(a - b) < EPS;
  const fmt = n => (n == null || isNaN(n)) ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const fdate = iso => (iso ? iso.split("-").reverse().join(".") : "–");
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");

  const antraege = S => Object.values(S.docs).filter(d => d.typ === "antrag" && d.status === "fertig");
  const rechnungen = S => Object.values(S.docs).filter(d => d.typ === "rechnung" && d.status === "fertig");
  const klientNr = a => String(a.klientNr || a.daten.mitglied || "").trim();

  // Klienten aus den Mitgliedsnummern der Anträge anlegen (Name aus dem Absender)
  function syncKlienten(S) {
    let changed = false;
    for (const a of antraege(S)) {
      const nr = klientNr(a); if (!nr) continue;
      let c = S.clients.find(x => String(x.nr) === nr);
      if (!c) { c = { id: "k" + nr, nr, name: a.daten.name || "", adresse: "" }; S.clients.push(c); changed = true; }
      else if (!c.name && a.daten.name) { c.name = a.daten.name; changed = true; }
    }
    return changed;
  }
  const klientVon = (S, a) => S.clients.find(c => String(c.nr) === klientNr(a)) || null;

  // ---------------- Zuordnung Rechnung -> Antragszeile(n) ----------------
  // Ergebnis: links = [{ docId, antragId, zeilen:[zid], auto }]
  function zuordnen(S) {
    const A = antraege(S).sort((x, y) => (x.seq || 0) - (y.seq || 0));
    const R = rechnungen(S);
    const links = [], usedDoc = new Set(), usedZeile = new Set();
    // vom Prüfer festgelegt
    for (const r of R) {
      if (!r.zuordnung) continue;
      usedDoc.add(r.id);
      if (r.zuordnung.keine) continue;
      const a = S.docs[r.zuordnung.antragId]; if (!a) continue;
      const zs = (r.zuordnung.zeilen || []).filter(z => a.daten.zeilen.some(x => x.id === z));
      zs.forEach(z => usedZeile.add(z));
      links.push({ docId: r.id, antragId: a.id, zeilen: zs, auto: false });
    }
    // Nähe Rechnung <-> Antrag: gleiche Übertragung und direkt nach dem Antrag hochgeladen = am besten
    const naehe = (a, r) => {
      if (a.batch && a.batch === r.batch) {
        const next = A.find(x => x.batch === a.batch && (x.seq || 0) > (a.seq || 0));
        if ((r.seq || 0) > (a.seq || 0) && (!next || (r.seq || 0) < (next.seq || 0))) return 0;
        return 1;
      }
      return 2;
    };
    const rank = (a, z, r) => naehe(a, r) * 100 + (r.daten.datum && r.daten.datum === z.datum ? 0 : 10) + (r.daten.kategorie === z.kat ? 0 : 1);
    const offeneZeilen = () => A.flatMap(a => a.daten.zeilen.filter(z => !usedZeile.has(z.id)).map(z => ({ a, z })));
    const frei = () => R.filter(r => !usedDoc.has(r.id));
    const link = (r, a, zs) => { usedDoc.add(r.id); zs.forEach(z => usedZeile.add(z.id)); links.push({ docId: r.id, antragId: a.id, zeilen: zs.map(z => z.id), auto: true }); };

    for (const maxNaehe of [0, 1, 2]) {
      // 1) Rechnungsbetrag = Zeilenbetrag
      for (const { a, z } of offeneZeilen()) {
        const c = frei().filter(r => naehe(a, r) <= maxNaehe && eq(r.daten.betrag, z.betrag)).sort((x, y) => rank(a, z, x) - rank(a, z, y));
        if (c.length) link(c[0], a, [z]);
      }
      // 2) irgendein Betrag auf der Rechnung = Zeilenbetrag
      for (const { a, z } of offeneZeilen()) {
        const c = frei().filter(r => naehe(a, r) <= maxNaehe && (r.daten.alleBetraege || []).some(b => eq(b, z.betrag))).sort((x, y) => rank(a, z, x) - rank(a, z, y));
        if (c.length) link(c[0], a, [z]);
      }
      // 3) mehrere Rechnungen für eine Zeile (Teilsummen, bis zu 4 Rechnungen)
      for (const { a, z } of offeneZeilen()) {
        const c = frei().filter(r => naehe(a, r) <= maxNaehe && r.daten.betrag != null && r.daten.betrag < z.betrag + EPS).slice(0, 14);
        const combo = findeKombination(c, z.betrag, 4);
        if (combo) combo.forEach(r => link(r, a, [z]));
      }
      // 4) eine Rechnung für mehrere Zeilen desselben Antrags (bis zu 4 Zeilen)
      for (const r of frei()) {
        if (r.daten.betrag == null) continue;
        for (const a of A) {
          if (naehe(a, r) > maxNaehe) continue;
          const zs = a.daten.zeilen.filter(z => !usedZeile.has(z.id));
          const combo = findeKombination(zs.map(z => ({ z, daten: { betrag: z.betrag } })), r.daten.betrag, 4, 2);
          if (combo) { link(r, a, combo.map(c => c.z)); break; }
        }
      }
    }
    return links;
  }
  // Teilmenge, deren Beträge genau "ziel" ergeben (kleine Mengen, einfache Suche)
  function findeKombination(items, ziel, maxN, minN = 2) {
    const n = items.length;
    const rec = (start, rest, pick) => {
      if (pick.length >= minN && Math.abs(rest) < EPS) return pick;
      if (pick.length >= maxN || rest < -EPS) return null;
      for (let i = start; i < n; i++) { const r = rec(i + 1, r2(rest - items[i].daten.betrag), [...pick, items[i]]); if (r) return r; }
      return null;
    };
    return rec(0, ziel, []);
  }

  // ---------------- Prüfung ----------------
  function pruefen(S) {
    const links = zuordnen(S);
    const res = { links, antrag: {}, client: {}, rechnung: {}, befunde: [] };
    const kl = key => S.klaerung?.[key] || {};
    const add = (b) => {
      const k = kl(b.key); b.geklaert = !!k.geklaert; b.bemerkung = k.bemerkung || "";
      res.befunde.push(b); return b;
    };
    const A = antraege(S).sort((x, y) => (x.daten.datum || "").localeCompare(y.daten.datum || "") || (x.seq || 0) - (y.seq || 0));
    const R = rechnungen(S);

    // je Rechnung: Verknüpfung
    for (const r of R) res.rechnung[r.id] = { link: links.find(l => l.docId === r.id) || null };

    for (const a of A) {
      const d = a.daten, c = klientVon(S, a);
      const ra = { zeile: {}, befunde: [], sZeilen: sum(d.zeilen.map(z => z.betrag)), sBeleg: 0, offenUnsicher: 0 };
      res.antrag[a.id] = ra;
      const base = { antragId: a.id, clientId: c?.id || null };
      const B = (key, lvl, text, extra = {}) => ra.befunde.push(add({ key, lvl, text, ...base, ...extra }));

      if (!klientNr(a)) B(`klient:${a.id}`, "warn", "Mitgliedsnummer nicht erkannt – bitte im Antrag eintragen.");
      // 1) Rechenprüfung des Antrags
      const kats = KAT_KEYS.filter(k => d.summen?.[k] != null || d.zeilen.some(z => z.kat === k));
      for (const k of kats) {
        const s = sum(d.zeilen.filter(z => z.kat === k).map(z => z.betrag)), ss = d.summen?.[k];
        if (ss == null) { if (Object.keys(d.summen || {}).length) B(`sum:${a.id}:${k}`, "err", `Summenzeile Spalte ${k} fehlt, Zeilen ergeben ${fmt(s)}.`); }
        else if (!eq(s, ss)) B(`sum:${a.id}:${k}`, "err", `Rechenfehler Spalte ${k}: Zeilen ergeben ${fmt(s)}, Summenzeile ${fmt(ss)} (Differenz ${fmt(r2(ss - s))}).`);
      }
      const sSum = sum(Object.values(d.summen || {}));
      if (d.gesamt == null) B(`ges:${a.id}`, "warn", "Gesamtsumme nicht erkannt – bitte im Antrag eintragen.");
      else if (Object.keys(d.summen || {}).length && !eq(sSum, d.gesamt)) B(`ges:${a.id}`, "err", `Rechenfehler: Summenzeile gesamt ${fmt(sSum)} ≠ Gesamtsumme ${fmt(d.gesamt)} (Differenz ${fmt(r2(d.gesamt - sSum))}).`);
      else if (!Object.keys(d.summen || {}).length && !eq(ra.sZeilen, d.gesamt)) B(`ges:${a.id}`, "err", `Rechenfehler: Zeilen ergeben ${fmt(ra.sZeilen)} ≠ Gesamtsumme ${fmt(d.gesamt)}.`);

      // 2) Belege je Zeile
      for (const z of d.zeilen) {
        const ls = links.filter(l => l.antragId === a.id && l.zeilen.includes(z.id));
        const docs = ls.map(l => S.docs[l.docId]);
        // Betrag lt. Beleg: bei einer Rechnung für mehrere Zeilen zählt der Zeilenbetrag
        const belegt = ls.length ? sum(ls.map(l => (l.zeilen.length > 1 ? z.betrag : S.docs[l.docId].daten.betrag))) : null;
        const st = { docs: docs.map(x => x.id), belegt, status: "ok" };
        ra.zeile[z.id] = st;
        const zt = `Zeile ${z.nr} (${fdate(z.datum)}, ${z.kat} ${fmt(z.betrag)})`;
        if (!ls.length) { st.status = "open"; B(`fehlt:${z.id}`, "warn", `${zt}: keine passende Rechnung gefunden.`, { zeileId: z.id }); continue; }
        if (!eq(belegt, z.betrag)) { st.status = "err"; B(`abw:${z.id}`, "err", `${zt}: Beleg(e) über ${fmt(belegt)} – Differenz ${fmt(r2(z.betrag - belegt))}.`, { zeileId: z.id }); }
        for (const r of docs) {
          // 4) Kategorie nur als Hinweis
          if (r.daten.kategorie && r.daten.kategorie !== z.kat) B(`kat:${r.id}:${z.id}`, "info", `${zt}: Rechnung „${r.daten.aussteller || r.name}“ passt eher zu Spalte ${r.daten.kategorie}.`, { zeileId: z.id, docId: r.id });
          if (r.daten.datum && z.datum && r.daten.datum !== z.datum && ls.length === 1) B(`dat:${r.id}:${z.id}`, "info", `${zt}: Rechnungsdatum ${fdate(r.daten.datum)} weicht vom Beleg-Datum im Antrag ab.`, { zeileId: z.id, docId: r.id });
        }
      }
      ra.sBeleg = sum(d.zeilen.map(z => ra.zeile[z.id]?.belegt));
    }
    // noch nicht bestätigte, unsicher gelesene Stellen (keine Prüfbefunde, sondern Lese-Kontrolle)
    res.offenUnsicher = Object.values(S.docs).reduce((n, d) => n + offeneStellen(d), 0);

    // 3) Rechnungen ohne Antragszeile, Doppelungen, identische Dateien
    for (const r of R) {
      const l = res.rechnung[r.id].link;
      if (!l || !l.zeilen.length) add({ key: `ohne:${r.id}`, lvl: "warn", text: `Rechnung „${r.daten.aussteller || r.name}“ über ${fmt(r.daten.betrag)} vom ${fdate(r.daten.datum)} ist keiner Antragszeile zugeordnet.`, docId: r.id, antragId: l?.antragId || null, clientId: l ? klientVon(S, S.docs[l.antragId])?.id : null });
    }
    const gruppen = {};
    for (const r of R) {
      const d = r.daten, aus = norm(d.aussteller).slice(0, 12);
      const key = d.nummer ? `N|${norm(d.nummer)}|${aus}` : (d.betrag != null && d.datum ? `B|${d.betrag}|${d.datum}|${aus}` : null);
      if (key) (gruppen[key] = gruppen[key] || []).push(r);
      if (r.hash) (gruppen["H|" + r.hash] = gruppen["H|" + r.hash] || []).push(r);
    }
    const gemeldet = new Set(); // je Rechnung nur eine Doppelungs-Meldung (identische Datei zuerst)
    const gEntries = Object.entries(gruppen).sort((a, b) => (b[0].startsWith("H|") - a[0].startsWith("H|")));
    for (const [key, g] of gEntries) {
      if (g.length < 2) continue;
      g.sort((x, y) => (x.seq || 0) - (y.seq || 0));
      for (const r of g.slice(1)) {
        if (gemeldet.has(r.id)) continue; gemeldet.add(r.id);
        const l = res.rechnung[r.id].link, a = l && S.docs[l.antragId];
        const erst = g[0], la = res.rechnung[erst.id].link, ea = la && S.docs[la.antragId];
        const wo = ea ? `bereits im Antrag vom ${fdate(ea.daten.datum)} (Mitglied ${klientNr(ea)})` : "bereits eingereicht";
        const was = key.startsWith("H|") ? "Identische Bilddatei" : key.startsWith("N|") ? `Rechnung Nr. ${r.daten.nummer}` : `Rechnung über ${fmt(r.daten.betrag)} vom ${fdate(r.daten.datum)}`;
        add({ key: `dopp:${r.id}:${key.slice(0, 2)}`, lvl: "err", text: `Mögliche Doppelung: ${was} von „${r.daten.aussteller || r.name}“ ${wo}.`, docId: r.id, antragId: a?.id || null, clientId: a ? klientVon(S, a)?.id : null });
      }
    }
    // gleiche Antragszeile (Datum + Spalte + Betrag) in mehreren Anträgen desselben Mitglieds
    const zg = {};
    for (const a of A) for (const z of a.daten.zeilen) if (z.datum) (zg[`${klientNr(a)}|${z.datum}|${z.kat}|${z.betrag}`] = zg[`${klientNr(a)}|${z.datum}|${z.kat}|${z.betrag}`] || []).push({ a, z });
    for (const g of Object.values(zg)) {
      if (g.length < 2 || new Set(g.map(x => x.a.id)).size < 2) continue;
      for (const { a, z } of g.slice(1)) {
        const e = g[0];
        const b = add({ key: `doppz:${z.id}`, lvl: "err", text: `Mögliche Doppelabrechnung: Zeile ${z.nr} (${fdate(z.datum)}, ${z.kat} ${fmt(z.betrag)}) steht schon im Antrag vom ${fdate(e.a.daten.datum)}.`, antragId: a.id, clientId: klientVon(S, a)?.id || null, zeileId: z.id });
        res.antrag[a.id].befunde.push(b);
      }
    }

    // Status je Antrag und Klient
    const offen = bs => bs.filter(b => !b.geklaert);
    for (const a of A) {
      const ra = res.antrag[a.id];
      for (const b of res.befunde) if (b.antragId === a.id && !ra.befunde.includes(b)) ra.befunde.push(b);
      const o = offen(ra.befunde);
      ra.status = !a.daten.zeilen.length ? "none" : o.some(b => b.lvl === "err") ? "err" : o.some(b => b.lvl === "warn") ? "open" : "ok";
      for (const z of a.daten.zeilen) {
        const zb = o.filter(b => b.zeileId === z.id && b.lvl !== "info");
        if (zb.some(b => b.lvl === "err")) ra.zeile[z.id].status = "err";
        else if (ra.zeile[z.id].status !== "err" && zb.some(b => b.lvl === "warn")) ra.zeile[z.id].status = "open";
        else if (ra.zeile[z.id].status !== "ok" && !zb.length) ra.zeile[z.id].status = "done"; // geklärt
      }
    }
    for (const c of S.clients) {
      const as = A.filter(a => klientNr(a) === String(c.nr)), rs = as.map(a => res.antrag[a.id]);
      const ob = offen(res.befunde.filter(b => b.clientId === c.id));
      res.client[c.id] = {
        antraege: as.map(a => a.id), nAntraege: as.length, nZeilen: rs.reduce((n, r) => n + Object.keys(r.zeile).length, 0),
        nBelege: new Set(links.filter(l => as.some(a => a.id === l.antragId)).map(l => l.docId)).size,
        sAntrag: sum(as.map((a, i) => (a.daten.gesamt != null ? a.daten.gesamt : rs[i].sZeilen))), sBeleg: sum(rs.map(r => r.sBeleg)),
        nErr: ob.filter(b => b.lvl === "err").length, nWarn: ob.filter(b => b.lvl === "warn").length,
        status: !as.length ? "none" : ob.some(b => b.lvl === "err") || rs.some(r => r.status === "err") ? "err" : ob.some(b => b.lvl === "warn") || rs.some(r => r.status === "open") ? "open" : "ok"
      };
    }
    const lvlOrder = { err: 0, warn: 1, info: 2 };
    res.befunde.sort((x, y) => (x.geklaert - y.geklaert) || lvlOrder[x.lvl] - lvlOrder[y.lvl]);
    return res;
  }

  // Anzahl unsicher gelesener Stellen eines Belegs, die der Prüfer noch nicht bestätigt hat
  function offeneStellen(d) {
    if (!d || d.status !== "fertig" || !d.daten || (d.typ !== "antrag" && d.typ !== "rechnung")) return 0;
    let n = (d.daten.unsicher || []).filter(f => !d.bestaetigt?.[f]).length;
    if (d.typ === "antrag") n += d.daten.zeilen.filter(z => z.unsicher && !d.bestaetigt?.["z:" + z.id]).length;
    return n;
  }

  const api = { KATS, KAT_KEYS, pruefen, offeneStellen, zuordnen, syncKlienten, klientVon, klientNr, antraege, rechnungen, fmt, fdate, sum, eq, r2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Pruefung = api;
})(typeof self !== "undefined" ? self : this);
