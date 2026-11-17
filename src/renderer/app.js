"use strict";
/* SOLIDAGO Kassenprüfung – Oberfläche
   Daten liegen im Hauptprozess (lokale Datei im Nutzerprofil). Änderungen gehen als
   api.set(pfad, wert) dorthin; Ergebnisse der Texterkennung kommen über api.onState zurück. */

const P = window.Pruefung;
const CATS = P.KATS, KAT = P.KAT_KEYS, CATNAME = Object.fromEntries(CATS);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtEUR = n => (n == null || isNaN(n)) ? "" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEURc = n => (n == null || isNaN(n)) ? "–" : fmtEUR(n) + " €";
const fmtDate = iso => (iso ? iso.split("-").reverse().join(".") : "");
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function parseAmount(v) {
  let s = String(v ?? "").trim().replace(/[€\s]/g, ""); if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s); return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }

let S = null, pending = 0, R = null, deferred = null;
const view = { tab: "eingang", docId: null, clientId: null, filter: "alle", viewDoc: null, zoom: 1, original: false, back: null };

/* ---------- Daten ändern ---------- */
function set(path, value) {
  let o = S;
  for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null) o[path[i]] = typeof path[i + 1] === "number" ? [] : {}; o = o[path[i]]; }
  if (value === undefined) { if (Array.isArray(o)) o.splice(path[path.length - 1], 1); else delete o[path[path.length - 1]]; }
  else o[path[path.length - 1]] = value;
  return window.api.set(path, value);
}
const doc = id => S.docs[id];
function compute() { P.syncKlienten(S); R = P.pruefen(S); return R; }

/* ---------- Start ---------- */
(async () => {
  const st = await window.api.getState();
  S = st.S; pending = st.pending; view.version = st.version; view.datenOrdner = st.datenOrdner;
  window.api.onState(msg => {
    // Während der Eingabe nicht neu zeichnen – erst wenn das Feld verlassen wird
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $("#main").contains(a)) { deferred = msg; return; }
    S = msg.S; pending = msg.pending; render();
  });
  document.addEventListener("focusout", () => setTimeout(() => {
    if (!deferred) return; const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    S = deferred.S; pending = deferred.pending; deferred = null; render();
  }, 50));
  window.api.onPdfRender(renderPdfPages);
  render();
})();

$("#tabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  view.tab = b.dataset.tab; view.docId = null; render(); window.scrollTo(0, 0);
});
$("#btnHandy").onclick = openHandy;

function render() {
  compute();
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === view.tab));
  const nOffen = R.befunde.filter(b => !b.geklaert && b.lvl !== "info").length;
  $("#tabs [data-tab=pruefung]").innerHTML = `Prüfübersicht${nOffen ? `<span class="cnt">${nOffen}</span>` : ""}`;
  const nLiest = Object.values(S.docs).filter(d => d.status === "wartet" || d.status === "liest").length;
  $("#busy").innerHTML = nLiest ? `<span class="spin"></span>liest ${nLiest} Beleg(e) aus …` : "";
  const m = $("#main");
  if (view.docId && doc(view.docId)) {
    const d = doc(view.docId);
    if (d.typ === "antrag" && d.status === "fertig") return renderAntrag(m, d);
    return renderBeleg(m, d);
  }
  view.docId = null;
  ({ eingang: renderEingang, klienten: renderKlienten, pruefung: renderPruefung, bericht: renderBericht, daten: renderDaten })[view.tab](m);
}
function openDoc(id) {
  view.back = { tab: view.tab }; view.docId = id; view.viewDoc = id; view.zoom = 1; view.original = false;
  render(); window.scrollTo(0, 0);
}
function goBack() { view.docId = null; render(); }

const STATUS = { ok: ["b-ok", "✓ in Ordnung", "s-ok"], err: ["b-err", "✗ Beanstandung", "s-err"], open: ["b-open", "● offen", "s-open"], none: ["b-none", "– keine Daten", "s-none"] };
const badge = st => `<span class="badge ${STATUS[st][0]}">${STATUS[st][1]}</span>`;
const TYP = { antrag: ["b-ok", "Antrag"], rechnung: ["b-info", "Rechnung"], folgeseite: ["b-none", "Folgeseite"] };
function docStatus(d) {
  if (d.status === "wartet") return `<span class="badge b-none">wartet</span>`;
  if (d.status === "liest") return `<span class="badge b-none"><span class="spin" style="width:9px;height:9px;border:2px solid var(--green);border-right-color:transparent;border-radius:50%;display:inline-block;animation:spin 1s linear infinite"></span> liest …</span>`;
  if (d.status === "fehler") return `<span class="badge b-err" title="${esc(d.fehler)}">✗ Fehler</span>`;
  const t = TYP[d.typ] || ["b-none", d.typ || "?"];
  return `<span class="badge ${t[0]}">${t[1]}</span>`;
}
const offeneUnsicher = d => P.offeneStellen(d);
function thumb(d) { const f = (d.previews || [])[0]; return f ? `<img class="thumb" src="${window.api.belegUrl(f)}" loading="lazy">` : `<div class="thumb" style="width:34px;height:46px;background:#eef0ef;border-radius:3px"></div>`; }
function linkText(l) {
  if (!l) return null;
  const a = doc(l.antragId); if (!a) return null;
  const zs = a.daten.zeilen.filter(z => l.zeilen.includes(z.id)).map(z => z.nr).join(", ");
  return `Mitglied ${esc(P.klientNr(a))} · Antrag ${fmtDate(a.daten.datum)}${zs ? ` · Zeile ${esc(zs)}` : ""}`;
}

/* ================= Eingang ================= */
function renderEingang(m) {
  const all = Object.values(S.docs).sort((a, b) => b.seq - a.seq);
  const F = {
    alle: () => true,
    offen: d => offeneUnsicher(d) > 0 || d.status === "fehler",
    ohne: d => d.typ === "rechnung" && d.status === "fertig" && !R.rechnung[d.id]?.link?.zeilen?.length,
    antraege: d => d.typ === "antrag", rechnungen: d => d.typ === "rechnung"
  };
  const list = all.filter(F[view.filter] || F.alle);
  const cnt = k => all.filter(F[k]).length;
  m.innerHTML = `
  <div class="grid" style="grid-template-columns:1fr 340px;align-items:start;gap:16px">
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:10px;flex-wrap:wrap">
        <h3>Eingegangene Belege <span class="muted" style="font-weight:400">(${all.length})</span></h3>
        <div class="filters">
          ${[["alle", "Alle"], ["offen", "Zu prüfen"], ["ohne", "Rechnung ohne Antrag"], ["antraege", "Anträge"], ["rechnungen", "Rechnungen"]].map(([k, t]) => `<button class="small ${view.filter === k ? "active" : ""}" data-f="${k}">${t} (${cnt(k)})</button>`).join("")}
        </div>
      </div>
      ${list.length ? `<table class="t"><thead><tr><th></th><th>Eingang</th><th>Art</th><th>Inhalt</th><th>Zuordnung / Hinweis</th><th></th></tr></thead><tbody>
        ${list.map(d => {
          const u = offeneUnsicher(d); let inhalt = `<span class="muted">${esc(d.name)}</span>`, zu = "";
          if (d.status === "fertig" && d.typ === "antrag") {
            const ra = R.antrag[d.id];
            inhalt = `<b>Mitglied ${esc(P.klientNr(d) || "?")}</b> ${esc(d.daten.name || "")}<br><span class="muted">vom ${fmtDate(d.daten.datum) || "?"} · ${d.daten.zeilen.length} Zeile(n) · ${fmtEURc(d.daten.gesamt)}</span>`;
            zu = ra ? badge(ra.status) : "";
          } else if (d.status === "fertig" && d.typ === "rechnung") {
            inhalt = `<b>${esc(d.daten.aussteller || "Rechnung")}</b><br><span class="muted">${d.daten.nummer ? "Nr. " + esc(d.daten.nummer) + " · " : ""}${fmtDate(d.daten.datum) || "ohne Datum"} · ${fmtEURc(d.daten.betrag)}</span>`;
            const lt = linkText(R.rechnung[d.id]?.link);
            zu = lt ? `<span class="hint" style="color:var(--green-d)">→ ${lt}</span>` : `<span class="badge b-open">nicht zugeordnet</span>`;
          } else if (d.typ === "folgeseite") { inhalt = `<span class="muted">Folgeseite zu „${esc(doc(d.folgeVon)?.daten?.aussteller || "Rechnung")}“</span>`; }
          else if (d.status === "fehler") zu = `<span class="hint" style="color:var(--red)">${esc(d.fehler)}</span>`;
          if (u) zu += ` <span class="badge b-open" title="unsicher gelesene Stellen bitte prüfen">${u} × prüfen</span>`;
          return `<tr class="click" data-doc="${d.id}"><td>${thumb(d)}</td><td class="hint">${new Date(d.eingang).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}<br>${d.quelle === "handy" ? "📱 Handy" : "💾 Datei"}</td>
            <td>${docStatus(d)}</td><td>${inhalt}</td><td>${zu}</td><td class="right"><button class="icon" data-del="${d.id}" title="Beleg löschen">🗑</button></td></tr>`;
        }).join("")}</tbody></table>`
      : `<p class="hint">${all.length ? "Keine Belege in dieser Auswahl." : "Noch keine Belege. Klicke oben rechts auf „📱 Belege vom Handy“ oder ziehe Fotos/PDFs hierher."}</p>`}
    </div>
    <div>
      <div class="card">
        <h3 style="margin-bottom:8px">Belege hinzufügen</h3>
        <button class="primary" id="eHandy" style="width:100%;padding:10px">📱 Belege vom Handy senden</button>
        <div class="drop mt" id="drop">Fotos oder PDFs hierher ziehen<br><span class="hint">oder</span><br><button class="small" id="ePick" style="margin-top:6px">Dateien auswählen …</button></div>
        <p class="hint" style="margin:10px 0 0">Die App erkennt selbst, ob ein Blatt ein <b>Antrag</b> oder eine <b>Rechnung</b> ist, liest alles aus und ordnet es zu. Am besten je Mitglied erst den Antrag, dann seine Rechnungen senden. Gelb markierte Stellen bitte kurz prüfen.</p>
      </div>
    </div>
  </div>`;
  $$("[data-f]").forEach(b => b.onclick = () => { view.filter = b.dataset.f; render(); });
  $$("tr[data-doc]").forEach(tr => tr.onclick = e => { if (e.target.closest("button")) return; openDoc(tr.dataset.doc); });
  $$("[data-del]").forEach(b => b.onclick = () => confirmBox("Diesen Beleg löschen?", () => window.api.removeDoc(b.dataset.del)));
  $("#eHandy").onclick = openHandy;
  $("#ePick").onclick = async () => { const n = await window.api.importDialog(); if (n) toast(`${n} Datei(en) übernommen – werden ausgelesen …`); };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async e => { const n = await window.api.importFiles([...e.dataTransfer.files]); toast(n ? `${n} Datei(en) übernommen – werden ausgelesen …` : "Bitte JPG-, PNG- oder PDF-Dateien verwenden."); });
}
// Dateien auch außerhalb der Ablagefläche annehmen
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", async e => {
  e.preventDefault(); if (e.target.closest && e.target.closest("#drop")) return;
  if (!e.dataTransfer?.files?.length) return;
  const n = await window.api.importFiles([...e.dataTransfer.files]);
  toast(n ? `${n} Datei(en) übernommen – werden ausgelesen …` : "Bitte JPG-, PNG- oder PDF-Dateien verwenden.");
});

/* ================= Klienten ================= */
function renderKlienten(m) {
  const clients = [...S.clients].sort((a, b) => (+a.nr || 0) - (+b.nr || 0));
  if (!clients.find(c => c.id === view.clientId)) view.clientId = clients[0]?.id || null;
  const c = S.clients.find(x => x.id === view.clientId);
  m.innerHTML = `
  <div class="split">
    <div class="card clist">
      <h3 style="padding:4px 6px 10px">Klienten <span class="muted" style="font-weight:400">(${S.clients.length})</span></h3>
      ${clients.length ? clients.map(x => `<div class="item ${x.id === view.clientId ? "active" : ""}" data-cid="${x.id}"><span class="sdot ${STATUS[R.client[x.id]?.status || "none"][2]}"></span><span class="nr">${esc(x.nr)}</span><span class="nm">${esc(x.name) || "<i class='muted'>ohne Namen</i>"}</span></div>`).join("")
        : `<p class="hint" style="padding:6px">Klienten werden automatisch aus den Mitgliedsnummern der Anträge angelegt.</p>`}
    </div>
    <div>${c ? clientDetail(c) : `<div class="card"><p class="muted">Noch keine Anträge eingegangen.</p></div>`}</div>
  </div>`;
  $$(".clist .item").forEach(el => el.onclick = () => { view.clientId = el.dataset.cid; render(); });
  if (!c) return;
  const ci = S.clients.indexOf(c);
  $$("[data-cf]").forEach(inp => inp.onchange = () => { set(["clients", ci, inp.dataset.cf], inp.value.trim()); render(); });
  $$("tr[data-aid]").forEach(tr => tr.onclick = () => openDoc(tr.dataset.aid));
  $("#delClient").onclick = () => {
    const rc = R.client[c.id] || { antraege: [] };
    const rechn = [...new Set(R.links.filter(l => rc.antraege.includes(l.antragId)).map(l => l.docId))];
    const text = rc.antraege.length
      ? `Klient ${c.nr} ${c.name} löschen? Dabei werden auch seine ${rc.antraege.length} Antrag/Anträge und ${rechn.length} zugeordnete Rechnung(en) dieses Prüfjahres gelöscht. Hinweis: Auch ein ausgeschiedenes Mitglied gehört für das Jahr, in dem es Anträge gestellt hat, noch in die Prüfung.`
      : `Klient ${c.nr} ${c.name} aus der Liste löschen?`;
    confirmBox(text, async () => {
      for (const id of [...rc.antraege, ...rechn]) { delete S.docs[id]; await window.api.removeDoc(id); }
      set(["clients", S.clients.indexOf(c)], undefined);
      view.clientId = null; render(); toast("Klient gelöscht");
    });
  };
}
function clientDetail(c) {
  const rc = R.client[c.id] || { antraege: [], status: "none" };
  const as = rc.antraege.map(doc).sort((a, b) => (a.daten.datum || "").localeCompare(b.daten.datum || ""));
  return `
  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2>${esc(c.name) || "Klient " + esc(c.nr)}</h2><div class="row">${badge(rc.status)}<button class="small danger" id="delClient">Klient löschen</button></div></div>
    <div class="grid" style="grid-template-columns:140px 1fr 1.4fr">
      <div><label>Mitgliedsnummer</label><input value="${esc(c.nr)}" disabled></div>
      <div><label>Name</label><input data-cf="name" value="${esc(c.name)}"></div>
      <div><label>Anschrift (optional)</label><input data-cf="adresse" value="${esc(c.adresse)}"></div>
    </div>
  </div>
  <div class="card mt">
    <h3 style="margin-bottom:6px">Anträge auf Auszahlung</h3>
    ${as.length ? `<table class="t">
      <thead><tr><th>Antrag vom</th><th class="num">Zeilen</th><th class="num">beantragt</th><th class="num">lt. Rechnungen</th><th class="num">Differenz</th><th>Ergebnis</th></tr></thead>
      <tbody>${as.map(a => { const r = R.antrag[a.id], tot = a.daten.gesamt ?? r.sZeilen; return `
        <tr class="click" data-aid="${a.id}"><td><b>${fmtDate(a.daten.datum) || "<i class='muted'>ohne Datum</i>"}</b>${offeneUnsicher(a) ? ` <span class="badge b-open">${offeneUnsicher(a)} × prüfen</span>` : ""}</td>
        <td class="num">${a.daten.zeilen.length}</td><td class="num">${fmtEURc(tot)}</td><td class="num">${fmtEURc(r.sBeleg)}</td>
        <td class="num" style="${P.eq(tot, r.sBeleg) ? "" : "color:var(--red);font-weight:600"}">${fmtEURc(P.r2(tot - r.sBeleg))}</td><td>${badge(r.status)}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>Summe</td><td class="num">${rc.nZeilen}</td><td class="num">${fmtEURc(rc.sAntrag)}</td><td class="num">${fmtEURc(rc.sBeleg)}</td><td class="num">${fmtEURc(P.r2(rc.sAntrag - rc.sBeleg))}</td><td></td></tr></tfoot>
    </table>` : `<p class="hint">Keine Anträge.</p>`}
  </div>`;
}

/* ================= Antrag (Kontrolle neben dem Scan) ================= */
function fieldHTML(d, key, label, value, opts = {}) {
  const uns = (d.daten.unsicher || []).includes(opts.flag || key) && !d.bestaetigt?.[opts.flag || key];
  return `<div class="field"><label class="lbl"><span>${label}</span>${uns ? `<button class="ok" data-ok="${opts.flag || key}" title="Wert stimmt mit dem Scan überein">✓ stimmt</button>` : ""}</label>
    <input data-k="${key}" ${opts.type ? `type="${opts.type}"` : ""} class="${uns ? "unsicher" : ""} ${opts.num ? "num" : ""}" value="${esc(value ?? "")}" ${opts.ph ? `placeholder="${opts.ph}"` : ""}></div>`;
}
function renderAntrag(m, a) {
  const d = a.daten, r = R.antrag[a.id], c = P.klientVon(S, a);
  const linkedDocs = [...new Set(R.links.filter(l => l.antragId === a.id).map(l => l.docId))];
  m.innerHTML = `
  <div class="row" style="margin-bottom:14px;gap:14px">
    <button id="back">← zurück</button>
    <h2>Antrag auf Auszahlung · ${esc(P.klientNr(a))} ${esc(c?.name || d.name || "")}</h2>${badge(r.status)}
    <div class="spacer"></div>
    <button class="small" id="asRechnung" title="Falls das Blatt falsch erkannt wurde">Ist eine Rechnung</button>
    <button class="small" id="reread">Neu auslesen</button>
    <button class="small danger" id="del">Löschen</button>
  </div>
  <div class="editor">
    <div>
      ${offeneUnsicher(a) ? `<div class="issue warn" style="margin-bottom:10px">● <span class="tx"><b>${offeneUnsicher(a)} Stelle(n) gelb markiert:</b> bitte mit dem Scan rechts vergleichen und mit „✓ stimmt“ bestätigen oder korrigieren.</span><button class="small" id="allOk">Alle stimmen</button></div>` : ""}
      <div class="card">
        <div class="grid" style="grid-template-columns:150px 140px 1fr 170px;align-items:end">
          ${fieldHTML(a, "datum", "Antrag vom", d.datum, { type: "date" })}
          ${fieldHTML(a, "mitglied", "Mitgliedsnummer", P.klientNr(a))}
          ${fieldHTML(a, "name", "Absender / Name", d.name)}
          ${fieldHTML(a, "gesamt", "Gesamtsumme (€)", fmtEUR(d.gesamt), { num: true })}
        </div>
      </div>
      <div class="card" style="margin-top:12px;padding:12px 10px;overflow-x:auto">
        <table class="lines">
          <thead><tr><th class="w-nr">Nr.</th><th class="w-dt">Beleg-Datum</th><th class="w-kat">Spalte</th><th class="w-amt num">Betrag €</th>
            <th class="sep">Rechnung(en)</th><th class="w-amt num">lt. Beleg</th><th class="st"></th><th></th></tr></thead>
          <tbody>${d.zeilen.map((z, i) => {
            const zs = r.zeile[z.id] || {}; const uns = z.unsicher && !a.bestaetigt?.["z:" + z.id];
            const st = zs.status; const cls = st === "err" ? "err" : st === "open" ? "open" : st === "done" ? "done" : "";
            return `<tr class="${cls}" data-z="${i}">
              <td><input data-zf="nr" value="${esc(z.nr)}" style="text-align:center"></td>
              <td><input data-zf="datum" type="date" value="${esc(z.datum || "")}" class="${uns ? "unsicher" : ""}"></td>
              <td><select data-zf="kat" title="${esc(CATNAME[z.kat])}">${KAT.map(k => `<option ${z.kat === k ? "selected" : ""} title="${CATNAME[k]}">${k}</option>`).join("")}</select></td>
              <td><input data-zf="betrag" class="num ${uns ? "unsicher" : ""}" value="${fmtEUR(z.betrag)}"></td>
              <td class="sep"><div class="chips">${(zs.docs || []).map(id => { const x = doc(id); const man = R.links.find(l => l.docId === id && !l.auto); return `<span class="chip ${view.viewDoc === id ? "active" : ""} ${man ? "manual" : ""}" data-show="${id}" title="${esc(x.daten.aussteller || "")} ${x.daten.nummer ? "Nr. " + esc(x.daten.nummer) : ""}"><span>${esc(x.daten.aussteller || x.name)}</span></span>`; }).join("") || `<span class="hint">–</span>`}</div></td>
              <td class="num">${fmtEUR(zs.belegt)}</td>
              <td class="st">${st === "ok" ? "<span style='color:var(--green)'>✓</span>" : st === "err" ? "<span style='color:var(--red)'>✗</span>" : st === "open" ? "<span style='color:#e0a82e'>●</span>" : st === "done" ? "☑" : ""}</td>
              <td style="white-space:nowrap">${uns ? `<button class="ok" data-zok="${i}" title="Datum und Betrag stimmen">✓ stimmt</button>` : ""}<button class="icon" data-zdel="${i}" title="Zeile löschen">✕</button></td></tr>`;
          }).join("")}
          <tr class="sumrow"><td colspan="2">SUMMEN</td><td colspan="2"><div class="row" style="gap:4px;flex-wrap:wrap">${KAT.filter(k => d.summen?.[k] != null || d.zeilen.some(z => z.kat === k)).map(k => { const u = (d.unsicher || []).includes("summe_" + k) && !a.bestaetigt?.["summe_" + k]; return `<span class="hint" style="white-space:nowrap">${k} <input data-sum="${k}" class="num ${u ? "unsicher" : ""}" style="width:80px" value="${fmtEUR(d.summen?.[k])}"></span>`; }).join("") || "–"}</div></td><td colspan="4"></td></tr>
          </tbody>
          <tfoot>
            <tr><td colspan="3">Summe Zeilen</td><td class="num">${fmtEUR(r.sZeilen)}</td><td class="sep">Summe lt. Rechnungen</td><td class="num">${fmtEUR(r.sBeleg)}</td><td colspan="2"></td></tr>
            <tr><td colspan="5">Differenz beantragt (${fmtEURc(d.gesamt ?? r.sZeilen)}) – belegt</td><td class="num" style="color:${P.eq(d.gesamt ?? r.sZeilen, r.sBeleg) ? "var(--green-d)" : "var(--red)"}">${fmtEUR(P.r2((d.gesamt ?? r.sZeilen) - r.sBeleg))}</td><td colspan="2"></td></tr>
          </tfoot>
        </table>
        <div class="row" style="margin-top:8px"><button class="small" id="addLine">+ Zeile</button><span class="hint">Nur nötig, falls eine Zeile nicht erkannt wurde. Rechnungen werden automatisch über den Betrag zugeordnet.</span></div>
      </div>
      <div class="card" style="margin-top:12px">
        <h3 style="margin-bottom:8px">Befunde</h3>
        ${befundListe(r.befunde, { ohneOrt: true }) || `<div class="issue" style="background:var(--green-l);color:var(--green-d)">✓ Alle Zeilen sind durch Rechnungen in gleicher Höhe belegt, keine Doppelungen gefunden.</div>`}
        <div style="margin-top:12px"><label>Notiz zum Antrag (erscheint im Bericht)</label><textarea id="notiz" rows="2">${esc(a.notiz || "")}</textarea></div>
      </div>
    </div>
    <div class="card viewer" id="viewer"></div>
  </div>`;
  const base = ["docs", a.id];
  $("#back").onclick = goBack;
  $("#reread").onclick = () => confirmBox("Antrag neu auslesen? Deine Korrekturen an diesem Antrag gehen dabei verloren.", () => { window.api.reread(a.id); goBack(); });
  $("#asRechnung").onclick = () => confirmBox("Dieses Blatt als Rechnung neu auslesen?", () => { window.api.reread(a.id, "rechnung"); goBack(); });
  $("#del").onclick = () => confirmBox("Diesen Antrag löschen?", () => { window.api.removeDoc(a.id); goBack(); });
  $("#allOk") && ($("#allOk").onclick = () => {
    for (const f of d.unsicher || []) set([...base, "bestaetigt", f], true);
    d.zeilen.forEach(z => z.unsicher && set([...base, "bestaetigt", "z:" + z.id], true));
    render();
  });
  $$("[data-ok]").forEach(b => b.onclick = () => { set([...base, "bestaetigt", b.dataset.ok], true); render(); });
  $$("[data-zok]").forEach(b => b.onclick = () => { set([...base, "bestaetigt", "z:" + d.zeilen[+b.dataset.zok].id], true); render(); });
  $$("[data-k]").forEach(inp => inp.onchange = () => {
    const k = inp.dataset.k; let v = inp.value.trim();
    if (k === "gesamt") v = parseAmount(v);
    if (k === "mitglied") { set([...base, "klientNr"], v); set([...base, "daten", "mitglied"], v); }
    else set([...base, "daten", k], v === "" ? null : v);
    set([...base, "bestaetigt", k], true); render();
  });
  $$("tr[data-z]").forEach(tr => {
    const i = +tr.dataset.z, z = d.zeilen[i];
    $$("[data-zf]", tr).forEach(inp => inp.onchange = () => {
      const f = inp.dataset.zf; let v = inp.value.trim();
      if (f === "betrag") v = parseAmount(v);
      set([...base, "daten", "zeilen", i, f], v === "" ? null : v);
      if (f === "betrag" || f === "datum") set([...base, "bestaetigt", "z:" + z.id], true);
      render();
    });
  });
  $$("[data-zdel]").forEach(b => b.onclick = () => { set([...base, "daten", "zeilen", +b.dataset.zdel], undefined); render(); });
  $$("[data-sum]").forEach(inp => inp.onchange = () => { set([...base, "daten", "summen", inp.dataset.sum], parseAmount(inp.value)); set([...base, "bestaetigt", "summe_" + inp.dataset.sum], true); render(); });
  $("#addLine").onclick = () => {
    const last = d.zeilen[d.zeilen.length - 1];
    set([...base, "daten", "zeilen", d.zeilen.length], { id: uid(), nr: String((+last?.nr || d.zeilen.length) + 1), datum: last?.datum || null, kat: last?.kat || "AHMIT", betrag: null, unsicher: false });
    render();
  };
  $("#notiz").onchange = e => set([...base, "notiz"], e.target.value);
  $$("[data-show]").forEach(ch => ch.onclick = () => { view.viewDoc = ch.dataset.show; view.zoom = 1; render(); });
  bindBefunde();
  drawViewer([a.id, ...linkedDocs]);
}

/* ================= Rechnung / sonstiger Beleg ================= */
function renderBeleg(m, d) {
  const fertig = d.status === "fertig" && d.daten;
  const isR = d.typ === "rechnung" && fertig;
  const l = isR ? R.rechnung[d.id]?.link : null;
  const befunde = R.befunde.filter(b => b.docId === d.id);
  const A = P.antraege(S).sort((x, y) => (+P.klientNr(x) || 0) - (+P.klientNr(y) || 0) || (x.daten.datum || "").localeCompare(y.daten.datum || ""));
  const curVal = d.zuordnung ? (d.zuordnung.keine ? "keine" : `${d.zuordnung.antragId}|${(d.zuordnung.zeilen || []).join(",")}`) : "";
  m.innerHTML = `
  <div class="row" style="margin-bottom:14px;gap:14px">
    <button id="back">← zurück</button>
    <h2>${isR ? "Rechnung" : d.typ === "folgeseite" ? "Folgeseite" : "Beleg"} · ${esc(isR ? d.daten.aussteller || d.name : d.name)}</h2>${docStatus(d)}
    <div class="spacer"></div>
    ${fertig ? `<button class="small" id="asAntrag">Ist ein Antrag</button>` : ""}
    ${d.typ === "folgeseite" ? `<button class="small" id="asRechnung">Ist eine eigene Rechnung</button>` : ""}
    <button class="small" id="reread">Neu auslesen</button>
    <button class="small danger" id="del">Löschen</button>
  </div>
  <div class="editor">
    <div>
      ${d.status === "fehler" ? `<div class="issue err">✗ <span class="tx">Konnte nicht ausgelesen werden: ${esc(d.fehler)}</span></div>` : ""}
      ${d.status === "wartet" || d.status === "liest" ? `<div class="card"><p class="muted">Wird gerade ausgelesen …</p></div>` : ""}
      ${d.typ === "folgeseite" ? `<div class="card"><p>Diese Seite wurde als Folgeseite der Rechnung <a href="#" id="toParent">„${esc(doc(d.folgeVon)?.daten?.aussteller || "Rechnung")}“</a> erkannt (keine eigene Rechnungsnummer und kein Datum).</p></div>` : ""}
      ${isR ? `
      ${offeneUnsicher(d) ? `<div class="issue warn" style="margin-bottom:10px">● <span class="tx"><b>Gelb markierte Angaben</b> bitte mit dem Scan vergleichen.</span><button class="small" id="allOk">Alle stimmen</button></div>` : ""}
      <div class="card">
        <div class="grid g2">
          ${fieldHTML(d, "aussteller", "Aussteller", d.daten.aussteller)}
          ${fieldHTML(d, "nummer", "Rechnungsnummer", d.daten.nummer)}
          ${fieldHTML(d, "datum", "Rechnungsdatum", d.daten.datum, { type: "date" })}
          ${fieldHTML(d, "betrag", "Rechnungsbetrag (€)", fmtEUR(d.daten.betrag), { num: true })}
          <div><label>Kategorie (Vorschlag)</label><select id="kat"><option value="">– unbekannt –</option>${CATS.map(([k, n]) => `<option value="${k}" ${d.daten.kategorie === k ? "selected" : ""}>${k} – ${n}</option>`).join("")}</select></div>
          <div><label>&nbsp;</label><label style="display:flex;gap:6px;align-items:center;color:var(--ink);font-size:13px"><input type="checkbox" id="bezahlt" style="width:auto" ${d.daten.bezahlt ? "checked" : ""}> Vermerk „Betrag erhalten“ / bezahlt</label></div>
        </div>
        ${d.daten.alleBetraege?.length ? `<p class="hint" style="margin:10px 0 0">Alle Beträge auf dem Beleg: ${d.daten.alleBetraege.map(fmtEUR).join(" · ")}</p>` : ""}
      </div>
      <div class="card" style="margin-top:12px">
        <h3 style="margin-bottom:8px">Zuordnung zum Antrag</h3>
        <select id="zuo">
          <option value="" ${curVal === "" ? "selected" : ""}>automatisch${!d.zuordnung && l ? ` → ${linkText(l)}` : !d.zuordnung ? " (nichts Passendes gefunden)" : ""}</option>
          <option value="keine" ${curVal === "keine" ? "selected" : ""}>keiner Antragszeile zuordnen</option>
          ${A.map(a => `<optgroup label="Mitglied ${esc(P.klientNr(a))} · Antrag vom ${fmtDate(a.daten.datum)}">${a.daten.zeilen.map(z => { const v = `${a.id}|${z.id}`; return `<option value="${v}" ${curVal === v ? "selected" : ""}>Zeile ${esc(z.nr)} · ${fmtDate(z.datum)} · ${z.kat} ${fmtEURc(z.betrag)}</option>`; }).join("")}</optgroup>`).join("")}
        </select>
        <p class="hint" style="margin:6px 0 0">${l && l.auto ? "Automatisch über den Betrag zugeordnet." : d.zuordnung ? "Von Hand festgelegt." : ""} ${l ? `<a href="#" id="toAntrag">Antrag öffnen →</a>` : ""}</p>
      </div>
      <div class="card" style="margin-top:12px">
        <h3 style="margin-bottom:8px">Befunde</h3>
        ${befundListe(befunde, { ohneOrt: true }) || `<p class="hint">Keine Befunde zu dieser Rechnung.</p>`}
      </div>` : ""}
    </div>
    <div class="card viewer" id="viewer"></div>
  </div>`;
  const base = ["docs", d.id];
  $("#back").onclick = goBack;
  $("#reread").onclick = () => { window.api.reread(d.id); toast("Wird neu ausgelesen …"); };
  $("#del").onclick = () => confirmBox("Diesen Beleg löschen?", () => { window.api.removeDoc(d.id); goBack(); });
  $("#asAntrag") && ($("#asAntrag").onclick = () => confirmBox("Dieses Blatt als Antrag neu auslesen?", () => window.api.reread(d.id, "antrag")));
  $("#asRechnung") && ($("#asRechnung").onclick = () => window.api.reread(d.id, "rechnung"));
  $("#toParent") && ($("#toParent").onclick = e => { e.preventDefault(); openDoc(d.folgeVon); });
  if (isR) {
    $("#allOk") && ($("#allOk").onclick = () => { for (const f of d.daten.unsicher || []) set([...base, "bestaetigt", f], true); render(); });
    $$("[data-ok]").forEach(b => b.onclick = () => { set([...base, "bestaetigt", b.dataset.ok], true); render(); });
    $$("[data-k]").forEach(inp => inp.onchange = () => {
      const k = inp.dataset.k; let v = inp.value.trim();
      if (k === "betrag") v = parseAmount(v);
      set([...base, "daten", k], v === "" ? null : v); set([...base, "bestaetigt", k], true); render();
    });
    $("#kat").onchange = e => { set([...base, "daten", "kategorie"], e.target.value || null); render(); };
    $("#bezahlt").onchange = e => set([...base, "daten", "bezahlt"], e.target.checked);
    $("#zuo").onchange = e => {
      const v = e.target.value;
      if (!v) set([...base, "zuordnung"], undefined);
      else if (v === "keine") set([...base, "zuordnung"], { keine: true });
      else { const [antragId, zid] = v.split("|"); set([...base, "zuordnung"], { antragId, zeilen: [zid] }); }
      render();
    };
    $("#toAntrag") && ($("#toAntrag").onclick = e => { e.preventDefault(); openDoc(l.antragId); view.viewDoc = d.id; render(); });
    bindBefunde();
  }
  const pages = d.typ === "folgeseite" ? [d.id] : [d.id, ...Object.values(S.docs).filter(x => x.folgeVon === d.id).map(x => x.id)];
  drawViewer(pages);
}

/* ---------- Scan-Ansicht ---------- */
function drawViewer(docIds) {
  const v = $("#viewer"); if (!v) return;
  if (!docIds.includes(view.viewDoc)) view.viewDoc = docIds[0];
  const cur = doc(view.viewDoc);
  const imgs = cur ? (view.original || !(cur.previews || []).length ? (/\.pdf$/i.test(cur.file || "") ? [] : cur.file ? [cur.file] : []) : cur.previews) : [];
  v.innerHTML = `
    <div class="docbar">
      ${docIds.map(id => { const x = doc(id); if (!x) return ""; const t = x.typ === "antrag" ? "Antrag" : (x.daten?.aussteller || x.name); return `<span class="chip ${id === view.viewDoc ? "active" : ""}" data-vd="${id}"><span>${esc(t)}</span></span>`; }).join("")}
      <div class="spacer"></div>
      <button class="small" data-z="-">−</button><button class="small" data-z="fit">Breite</button><button class="small" data-z="+">+</button>
      ${cur?.file && !/\.pdf$/i.test(cur.file) ? `<button class="small" id="orig" title="zwischen begradigter Seite und Originalfoto wechseln">${view.original ? "Begradigt" : "Original"}</button>` : ""}
    </div>
    <div class="stage" id="stage">${imgs.length ? imgs.map(f => `<img src="${window.api.belegUrl(f)}" alt="Scan">`).join("") : `<div class="empty">${cur?.file ? "Bild wird vorbereitet …" : "Kein Bild vorhanden (Beispieldaten)."}</div>`}</div>`;
  const stage = $("#stage");
  const apply = () => $$("img", stage).forEach(img => { img.style.width = Math.round((stage.clientWidth - 24) * view.zoom) + "px"; });
  apply();
  $$("[data-vd]", v).forEach(ch => ch.onclick = () => { view.viewDoc = ch.dataset.vd; view.zoom = 1; drawViewer(docIds); $$("[data-show]").forEach(c => c.classList.toggle("active", c.dataset.show === view.viewDoc)); });
  $$("[data-z]", v).forEach(b => b.onclick = () => { const z = b.dataset.z; view.zoom = z === "+" ? view.zoom * 1.25 : z === "-" ? view.zoom / 1.25 : 1; apply(); });
  $("#orig") && ($("#orig").onclick = () => { view.original = !view.original; drawViewer(docIds); });
}

/* ---------- Befunde mit „geklärt“ ---------- */
function befundListe(list, { ohneOrt = false } = {}) {
  if (!list.length) return "";
  return `<div class="issues">${list.map(b => {
    const c = S.clients.find(x => x.id === b.clientId), a = b.antragId && doc(b.antragId);
    const ort = ohneOrt ? "" : `<b>${c ? esc(c.nr) + " " + esc(c.name) : "ohne Klient"}</b>${a ? `, Antrag vom ${fmtDate(a.daten.datum)}` : ""}: `;
    const sym = b.lvl === "err" ? "✗" : b.lvl === "warn" ? "●" : "ℹ";
    return `<div class="issue ${b.geklaert ? "solved" : b.lvl}">${sym}
      <div class="tx"><span ${!ohneOrt && (b.antragId || b.docId) ? `data-goto="${b.antragId || b.docId}" data-gotodoc="${b.docId || ""}" style="cursor:pointer"` : ""}>${ort}${esc(b.text)}</span>
        ${b.lvl !== "info" && (b.geklaert || b.bemerkung) ? `<input class="bem" data-bem="${esc(b.key)}" placeholder="Bemerkung, z. B. wie es geklärt wurde (erscheint im Bericht)" value="${esc(b.bemerkung)}">` : ""}</div>
      ${b.lvl !== "info" ? `<label class="kl"><input type="checkbox" data-kl="${esc(b.key)}" ${b.geklaert ? "checked" : ""}> geklärt</label>` : ""}</div>`;
  }).join("")}</div>`;
}
function bindBefunde() {
  $$("[data-kl]").forEach(cb => cb.onchange = () => { set(["klaerung", cb.dataset.kl, "geklaert"], cb.checked); render(); });
  $$("[data-bem]").forEach(inp => inp.onchange = () => set(["klaerung", inp.dataset.bem, "bemerkung"], inp.value.trim()));
  $$("[data-goto]").forEach(el => el.onclick = () => { openDoc(el.dataset.goto); if (el.dataset.gotodoc) { view.viewDoc = el.dataset.gotodoc; render(); } });
}

/* ================= Prüfübersicht ================= */
function renderPruefung(m) {
  const cl = [...S.clients].sort((a, b) => (+a.nr || 0) - (+b.nr || 0));
  const rc = c => R.client[c.id];
  const tot = { a: P.sum(cl.map(c => rc(c).sAntrag)), b: P.sum(cl.map(c => rc(c).sBeleg)), na: cl.reduce((n, c) => n + rc(c).nAntraege, 0), nr: P.rechnungen(S).length };
  const open = R.befunde.filter(b => !b.geklaert), nE = open.filter(b => b.lvl === "err").length, nW = open.filter(b => b.lvl === "warn").length;
  m.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="v">${cl.length}</div><div class="k">Klienten</div></div>
    <div class="kpi"><div class="v">${tot.na} / ${tot.nr}</div><div class="k">Anträge / Rechnungen</div></div>
    <div class="kpi"><div class="v">${fmtEUR(tot.a)} €</div><div class="k">beantragt gesamt</div></div>
    <div class="kpi"><div class="v">${fmtEUR(tot.b)} €</div><div class="k">belegt gesamt</div></div>
    <div class="kpi"><div class="v" style="color:${nE ? "var(--red)" : nW ? "var(--amber)" : "var(--green-d)"}">${nE} / ${nW}</div><div class="k">Beanstandungen / offene Punkte</div></div>
  </div>
  ${R.offenUnsicher ? `<div class="issue warn" style="margin-bottom:16px">● <span class="tx"><b>${R.offenUnsicher} unsicher gelesene Stelle(n)</b> noch nicht bestätigt – bitte im Eingang unter „Zu prüfen“ mit dem Scan vergleichen.</span><button class="small" id="toPruefen">Zu prüfen öffnen</button></div>` : ""}
  <div class="card">
    <h3 style="margin-bottom:6px">Übersicht aller Klienten</h3>
    <table class="t"><thead><tr><th>Mitgl.-Nr.</th><th>Name</th><th class="num">Anträge</th><th class="num">Zeilen</th><th class="num">beantragt</th><th class="num">belegt</th><th class="num">Differenz</th><th>Ergebnis</th></tr></thead>
      <tbody>${cl.map(c => { const r = rc(c); return `<tr class="click" data-cid="${c.id}"><td>${esc(c.nr)}</td><td>${esc(c.name)}</td><td class="num">${r.nAntraege}</td><td class="num">${r.nZeilen}</td><td class="num">${fmtEURc(r.sAntrag)}</td><td class="num">${fmtEURc(r.sBeleg)}</td><td class="num" style="${P.eq(r.sAntrag, r.sBeleg) ? "" : "color:var(--red);font-weight:600"}">${fmtEURc(P.r2(r.sAntrag - r.sBeleg))}</td><td>${badge(r.status)}</td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">Noch keine Anträge.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">Summe</td><td class="num">${tot.na}</td><td class="num">${cl.reduce((n, c) => n + rc(c).nZeilen, 0)}</td><td class="num">${fmtEURc(tot.a)}</td><td class="num">${fmtEURc(tot.b)}</td><td class="num">${fmtEURc(P.r2(tot.a - tot.b))}</td><td></td></tr></tfoot>
    </table>
  </div>
  <div class="card mt">
    <h3 style="margin-bottom:8px">Befunde <span class="hint" style="font-weight:400">– ✗ Beanstandung · ● offen · ℹ Hinweis. Klick auf den Text öffnet den Antrag.</span></h3>
    ${befundListe(R.befunde) || `<div class="issue" style="background:var(--green-l);color:var(--green-d)">✓ Keine Befunde.</div>`}
  </div>`;
  $$("tr[data-cid]").forEach(tr => tr.onclick = () => { view.tab = "klienten"; view.clientId = tr.dataset.cid; render(); });
  $("#toPruefen") && ($("#toPruefen").onclick = () => { view.tab = "eingang"; view.filter = "offen"; render(); });
  bindBefunde();
}

/* ================= Bericht ================= */
function renderBericht(m) {
  const s = S.settings;
  const open = R.befunde.filter(b => !b.geklaert), openErr = open.filter(b => b.lvl === "err").length, openWarn = open.filter(b => b.lvl === "warn").length;
  m.innerHTML = `
  <div class="grid" style="grid-template-columns:1.3fr 1fr;align-items:start;gap:16px">
    <div class="card">
      <h3 style="margin-bottom:12px">Angaben für den Kassenprüfungsbericht</h3>
      <div class="grid g2">
        <div style="grid-column:span 2"><label>Bericht Kassenprüfung für den (Gemeinschaft)</label><input data-s="verein" value="${esc(s.verein)}" placeholder="z. B. Gemeinschaft …"></div>
        <div><label>Prüfjahr</label><input data-s="jahr" type="number" value="${esc(s.jahr)}"></div>
        <div><label>Kassenprüfung am</label><input data-s="pruefDatum" type="date" value="${esc(s.pruefDatum)}"></div>
        <div><label>Zeitraum von</label><input data-s="von" type="date" value="${esc(s.von)}"></div>
        <div><label>bis</label><input data-s="bis" type="date" value="${esc(s.bis)}"></div>
        <div style="grid-column:span 2"><label>1.) Kassenprüfer/in (Name, Anschrift)</label><input data-s="pruefer1" value="${esc(s.pruefer1)}"></div>
        <div style="grid-column:span 2"><label>2.) Kassenprüfer/in (Name, Anschrift) – optional</label><input data-s="pruefer2" value="${esc(s.pruefer2)}"></div>
        <div><label>Ort</label><input data-s="ort" value="${esc(s.ort)}"></div>
        <div><label>Kassier/in (Name)</label><input data-s="kassier" value="${esc(s.kassier)}"></div>
        <div><label>Belege lagen vor</label><select data-s="vollst">
          <option value="auto" ${s.vollst === "auto" ? "selected" : ""}>automatisch (${openWarn ? "unvollständig" : "vollständig"})</option>
          <option value="ja" ${s.vollst === "ja" ? "selected" : ""}>vollständig</option><option value="nein" ${s.vollst === "nein" ? "selected" : ""}>unvollständig</option></select></div>
        <div><label>Entlastung</label><select data-s="entlastung">
          <option value="auto" ${s.entlastung === "auto" ? "selected" : ""}>automatisch (${openErr ? "keine Zustimmung" : "Entlastung vorschlagen"})</option>
          <option value="ja" ${s.entlastung === "ja" ? "selected" : ""}>Entlastung vorschlagen</option><option value="nein" ${s.entlastung === "nein" ? "selected" : ""}>einer Entlastung nicht zustimmen</option>
          <option value="leer" ${s.entlastung === "leer" ? "selected" : ""}>offen lassen (von Hand ankreuzen)</option></select></div>
        <div><label style="display:flex;gap:6px;align-items:center;color:var(--ink);font-size:13px;margin-top:20px"><input type="checkbox" data-s="gekennzeichnet" style="width:auto" ${s.gekennzeichnet ? "checked" : ""}> Belege eindeutig gekennzeichnet</label></div>
        <div><label>Weiterer Prüfungstermin (optional)</label><input data-s="weitererTermin" type="date" value="${esc(s.weitererTermin)}"></div>
        <div style="grid-column:span 2"><label>Ergänzende Ergebnisse / Beanstandungen (zusätzlich zu den automatisch gefundenen)</label><textarea data-s="ergebnisZusatz" rows="2">${esc(s.ergebnisZusatz)}</textarea></div>
        <div style="grid-column:span 2"><label>Besondere Bemerkungen</label><textarea data-s="bemerkungen" rows="2">${esc(s.bemerkungen)}</textarea></div>
      </div>
    </div>
    <div>
      <div class="card">
        <h3 style="margin-bottom:4px">Unterschriften</h3>
        <p class="hint" style="margin:0 0 10px">Mit Maus, Stift oder Finger unterschreiben – oder leer lassen und den ausgedruckten Bericht von Hand unterzeichnen.</p>
        <label>Kassenprüfer/in 1</label><canvas class="sigpad" id="sig1" width="900" height="220"></canvas>
        <div class="row" style="margin:4px 0 12px"><button class="small" data-clr="sig1">löschen</button></div>
        <label>Kassenprüfer/in 2</label><canvas class="sigpad" id="sig2" width="900" height="220"></canvas>
        <div class="row" style="margin:4px 0 0"><button class="small" data-clr="sig2">löschen</button></div>
      </div>
      <div class="card mt">
        <h3 style="margin-bottom:6px">Bericht erstellen</h3>
        <p class="hint" style="margin:0 0 10px">Seite 1 entspricht dem Vordruck „Bericht Kassenprüfung“, danach folgen als Anlage die Übersicht aller Klienten, alle Befunde, der Prüfumfang und der Einzelnachweis je Antrag.</p>
        <button class="primary" id="doPdf">📄 Bericht als PDF speichern</button>
        ${openErr || openWarn ? `<p class="hint" style="margin-top:10px;color:var(--amber)">Hinweis: ${openErr} Beanstandung(en) und ${openWarn} offene(r) Punkt(e) werden im Bericht aufgeführt.</p>` : ""}
        ${R.offenUnsicher ? `<p class="hint" style="margin-top:6px;color:var(--amber)">Achtung: ${R.offenUnsicher} unsicher gelesene Stelle(n) sind noch nicht bestätigt. Bitte vor dem Bericht prüfen.</p>` : ""}
      </div>
    </div>
  </div>`;
  $$("[data-s]").forEach(inp => inp.onchange = () => {
    const k = inp.dataset.s; const v = inp.type === "checkbox" ? inp.checked : inp.value;
    set(["settings", k], v);
    if (k === "jahr" && /^\d{4}$/.test(v)) { set(["settings", "von"], `${v}-01-01`); set(["settings", "bis"], `${v}-12-31`); render(); }
    if (k === "vollst" || k === "entlastung") render();
  });
  setupSig("sig1"); setupSig("sig2");
  $("#doPdf").onclick = async () => {
    buildReport(); const p = await window.api.reportPdf(S.settings.jahr);
    if (p) toast("Bericht gespeichert: " + p);
  };
}
function setupSig(key) {
  const cv = $("#" + key), ctx = cv.getContext("2d");
  ctx.lineWidth = 4.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13224a";
  if (S.settings[key]) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0); im.src = S.settings[key]; }
  let drawing = false, dirty = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  cv.onpointermove = e => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty = true; };
  cv.onpointerup = cv.onpointercancel = () => { if (!drawing) return; drawing = false; if (dirty) set(["settings", key], cv.toDataURL("image/png")); };
  $(`[data-clr="${key}"]`).onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); set(["settings", key], null); };
}

function buildReport() {
  compute();
  const s = S.settings;
  const cl = [...S.clients].sort((a, b) => (+a.nr || 0) - (+b.nr || 0));
  const open = R.befunde.filter(b => !b.geklaert);
  const errs = open.filter(b => b.lvl === "err"), warns = open.filter(b => b.lvl === "warn");
  const hasErr = errs.length > 0 || !!String(s.ergebnisZusatz || "").trim();
  const vollst = s.vollst === "auto" ? !warns.length : s.vollst === "ja";
  const entl = s.entlastung === "auto" ? (errs.length ? "nein" : "ja") : s.entlastung;
  const B = on => `<span class="box">${on ? "☒" : "☐"}</span>`;
  const F = (v, w = 120) => `<span class="fl" style="min-width:${w}px">${esc(v) || "&nbsp;"}</span>`;
  const head = `<div class="ph"><div class="l">● SOLIDAGO</div><div class="r">Bundesverband Solidargemeinschaft für Gesundheit e.V.<br>${esc(s.verein)}</div></div>`;
  const rc = c => R.client[c.id];
  const tot = { a: P.sum(cl.map(c => rc(c).sAntrag)), b: P.sum(cl.map(c => rc(c).sBeleg)), na: cl.reduce((n, c) => n + rc(c).nAntraege, 0), nz: cl.reduce((n, c) => n + rc(c).nZeilen, 0) };
  const nOk = cl.filter(c => rc(c).status === "ok").length;
  const wer = b => { const c = S.clients.find(x => x.id === b.clientId), a = b.antragId && doc(b.antragId); return `${c ? esc(c.nr) + " " + esc(c.name) : "ohne Klient"}${a ? `, Antrag vom ${fmtDate(a.daten.datum)}` : ""}`; };
  let ergebnisText = "";
  if (errs.length) {
    ergebnisText = `${errs.length} Beanstandung(en) bei ${new Set(errs.map(b => b.clientId)).size} Klient(en):<br>` +
      errs.slice(0, 6).map(b => `– ${wer(b)}: ${esc(b.text)}`).join("<br>") + (errs.length > 6 ? `<br>– … weitere ${errs.length - 6}, siehe Anlage Abschnitt 2.` : `<br>Einzelheiten siehe Anlage.`);
  }
  if (String(s.ergebnisZusatz || "").trim()) ergebnisText += (ergebnisText ? "<br>" : "") + esc(s.ergebnisZusatz).replace(/\n/g, "<br>");
  const sigImg = k => (s[k] ? `<img src="${s[k]}">` : "");
  const page1 = `<div class="pg">${head}
    <p>Bericht Kassenprüfung für den: ${F(s.verein, 360)}</p>
    <h1>Kassenprüfungsbericht für das Jahr ${esc(s.jahr)}</h1>
    <p>Am ${F(fmtDate(s.pruefDatum), 110)} hat die Kassenprüfung für den Zeitraum von: ${F(fmtDate(s.von), 90)} bis ${F(fmtDate(s.bis), 90)} stattgefunden.</p>
    <p style="margin-top:8px">An der Kassenprüfung haben als Kassenprüfer teilgenommen (Name, Anschrift):</p>
    <p>1.) ${F(s.pruefer1, 560)}</p><p>2.) ${F(s.pruefer2, 560)}</p>
    <p style="margin-top:8px">Geprüft wurden <b>${cl.length} Klienten</b> mit <b>${tot.na} Anträgen</b> auf Auszahlung (<b>${tot.nz} Antragszeilen</b>) und <b>${P.rechnungen(S).length} Rechnungen</b>
      (beantragt ${fmtEURc(tot.a)}, belegt ${fmtEURc(tot.b)}). Davon ohne Beanstandung: ${nOk} von ${cl.length} Klienten. Prüfprotokoll siehe Anlage.</p>
    <p style="margin-top:8px">Die Kassenprüfung hat</p>
    <div class="opt ind">${B(!hasErr)} keine Beanstandung ergeben. Die Konten wurden für den Zeitraum über ordnungsgemäß und ordentlich geführt.</div>
    <div class="opt ind">${B(hasErr)} folgende Ergebnisse oder Beanstandungen ergeben:<div class="ind" style="font-size:9.5pt;margin-top:3px">${ergebnisText || "&nbsp;"}</div></div>
    <p style="margin-top:8px">Die Belege und Kontoauszüge lagen &nbsp;${B(vollst)} vollständig &nbsp;&nbsp;${B(!vollst)} unvollständig vor.</p>
    <div class="opt">${B(s.gekennzeichnet)} Die Belege sind eindeutig gekennzeichnet. Sie wurden dem Kontenplan sachlich zugeordnet.</div>
    <div class="opt" style="margin-top:7px">${B(entl === "ja")} Die Kassenprüfer schlagen die Entlastung der Vorstandschaft vor.</div>
    <div class="opt">${B(entl === "nein")} Die Kassenprüfer stimmen einer Entlastung nicht zu.</div>
    <div class="opt" style="margin-top:7px">${B(!!s.weitererTermin)} Ein weiterer Prüfungstermin ist für den ${F(fmtDate(s.weitererTermin), 110)} angesetzt worden. Hierüber ist ein gesonderter Bericht zu fertigen.</div>
    <p style="margin-top:8px">Besondere Bemerkungen zur erfolgten Kassenprüfung: &nbsp;${B(!String(s.bemerkungen || "").trim())} keine</p>
    <div class="opt">${B(!!String(s.bemerkungen || "").trim())} folgende Bemerkungen:<div class="ind" style="font-size:9.5pt">${esc(s.bemerkungen).replace(/\n/g, "<br>") || "&nbsp;"}</div></div>
    <p style="margin-top:14px">${F(s.ort, 170)}, den ${F(fmtDate(s.pruefDatum), 130)}<br><span style="font-size:8.5pt;margin-left:60px">(Ort)</span><span style="font-size:8.5pt;margin-left:160px">(Datum)</span></p>
    <div class="sigs" style="margin-top:8px">
      <div class="sig"><div class="img">${sigImg("sig1")}</div><div class="cap">zu 1.) ${esc(String(s.pruefer1 || "").split(",")[0])}</div></div>
      <div class="sig"><div class="img">${sigImg("sig2")}</div><div class="cap">zu 2.) ${esc(String(s.pruefer2 || "").split(",")[0])}</div></div>
      <div class="sig"><div class="img"></div><div class="cap">Unterschrift Kassier: ${esc(s.kassier)}</div></div>
    </div></div>`;
  const statusTxt = { ok: "✓ in Ordnung", err: "✗ Beanstandung", open: "● offen", none: "– keine Anträge" };
  const overview = `<div class="pg">${head}
    <h1>Anlage zum Kassenprüfungsbericht ${esc(s.jahr)} – Prüfprotokoll</h1>
    <h2>1. Übersicht aller Klienten</h2>
    <table class="p"><thead><tr><th>Mitgl.-Nr.</th><th>Name</th><th style="text-align:right">Anträge</th><th style="text-align:right">Zeilen</th><th style="text-align:right">beantragt</th><th style="text-align:right">belegt</th><th style="text-align:right">Differenz</th><th>Ergebnis</th></tr></thead>
      <tbody>${cl.map(c => { const r = rc(c); return `<tr class="${r.status === "err" ? "e" : ""}"><td>${esc(c.nr)}</td><td>${esc(c.name)}</td><td class="num">${r.nAntraege}</td><td class="num">${r.nZeilen}</td><td class="num">${fmtEURc(r.sAntrag)}</td><td class="num">${fmtEURc(r.sBeleg)}</td><td class="num">${fmtEURc(P.r2(r.sAntrag - r.sBeleg))}</td><td>${statusTxt[r.status]}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td colspan="2">Summe</td><td class="num">${tot.na}</td><td class="num">${tot.nz}</td><td class="num">${fmtEURc(tot.a)}</td><td class="num">${fmtEURc(tot.b)}</td><td class="num">${fmtEURc(P.r2(tot.a - tot.b))}</td><td></td></tr></tfoot></table>
    <h2>2. Befunde</h2>
    ${R.befunde.length ? `<table class="p"><thead><tr><th style="width:24px"></th><th>Klient / Antrag</th><th>Befund</th><th>Bemerkung des Prüfers</th></tr></thead><tbody>
      ${R.befunde.map(b => `<tr class="${!b.geklaert && b.lvl === "err" ? "e" : ""}"><td>${b.geklaert ? "☑" : b.lvl === "err" ? "✗" : b.lvl === "warn" ? "●" : "ℹ"}</td><td>${wer(b)}</td><td>${esc(b.text)}${b.geklaert ? " <i>(geklärt)</i>" : ""}</td><td>${esc(b.bemerkung)}</td></tr>`).join("")}
    </tbody></table><p style="font-size:8.5pt">✗ = Beanstandung · ● = offener Punkt · ℹ = Hinweis · ☑ = vom Prüfer geprüft und als geklärt markiert</p>`
      : `<p>Keine Befunde. Alle Antragsbeträge sind durch Rechnungen in gleicher Höhe belegt; es wurden keine Doppelabrechnungen festgestellt.</p>`}
    <h2>3. Prüfumfang</h2>
    <p style="font-size:9.5pt">Alle Anträge auf Auszahlung und Rechnungen wurden fotografiert und lokal auf dem PC des Prüfers ausgelesen (keine Übertragung ins Internet); unsicher gelesene Stellen wurden vom Prüfer mit dem Original verglichen. Für jeden Antrag wurde geprüft: (a) ob die Zeilenbeträge je Spalte der Summenzeile und die Summenzeile der beantragten Gesamtsumme entsprechen, (b) ob jeder im Antrag aufgeführte Betrag durch eine oder mehrere Rechnungen in gleicher Höhe nachgewiesen ist und ob Rechnungen ohne zugehörige Antragszeile vorliegen, (c) ob dieselbe Rechnung (gleiche Rechnungsnummer bzw. gleicher Betrag, gleiches Datum und gleicher Aussteller) oder dieselbe Antragszeile mehrfach eingereicht wurde – auch über alle Anträge des Prüfjahres hinweg, (d) ob identische Bilddateien mehrfach eingereicht wurden, (e) ob die Art der Rechnung zur gewählten Spalte passt (nur Hinweis).</p>
  </div>`;
  const detail = `<div class="pg">${head}
    <h2 style="margin-top:0">4. Einzelnachweis je Klient und Antrag</h2>
    ${cl.map(c => {
      const as = rc(c).antraege.map(doc).sort((a, b) => (a.daten.datum || "").localeCompare(b.daten.datum || ""));
      return `<h3>${esc(c.nr)} · ${esc(c.name)}</h3>` + (as.length ? as.map(a => {
        const r = R.antrag[a.id], t = a.daten.gesamt ?? r.sZeilen;
        return `<div class="cblock"><p style="margin:4px 0 2px;font-size:9.5pt"><b>Antrag vom ${fmtDate(a.daten.datum)}</b> – beantragt ${fmtEURc(t)}${a.notiz ? ` – ${esc(a.notiz)}` : ""}</p>
        <table class="p"><thead><tr><th>Nr.</th><th>Datum</th><th>Spalte</th><th>Rechnung(en)</th><th style="text-align:right">lt. Antrag</th><th style="text-align:right">lt. Beleg</th><th style="text-align:right">Diff.</th><th>Ergebnis</th></tr></thead><tbody>
        ${a.daten.zeilen.map(z => { const zs = r.zeile[z.id]; const docs = zs.docs.map(doc).map(x => `${esc(x.daten.aussteller || "")}${x.daten.nummer ? " Nr. " + esc(x.daten.nummer) : ""}${x.daten.datum ? " v. " + fmtDate(x.daten.datum) : ""}`).join("; ");
          return `<tr class="${zs.status === "err" ? "e" : ""}"><td>${esc(z.nr)}</td><td>${fmtDate(z.datum)}</td><td>${esc(z.kat)}</td><td>${docs || "–"}</td><td class="num">${fmtEUR(z.betrag)}</td><td class="num">${fmtEUR(zs.belegt)}</td><td class="num">${zs.belegt != null ? fmtEUR(P.r2(z.betrag - zs.belegt)) : ""}</td><td>${zs.status === "ok" ? "✓" : zs.status === "err" ? "✗" : zs.status === "done" ? "☑ geklärt" : "● Beleg fehlt"}</td></tr>`; }).join("")}
        </tbody><tfoot><tr><td colspan="4">Summe${P.eq(t, r.sZeilen) ? "" : ` (Zeilen; beantragt lt. Formular ${fmtEURc(t)})`}</td><td class="num">${fmtEUR(r.sZeilen)}</td><td class="num">${fmtEUR(r.sBeleg)}</td><td class="num">${fmtEUR(P.r2(r.sZeilen - r.sBeleg))}</td><td>${({ ok: "✓", err: "✗", open: "●", none: "–" })[r.status]}</td></tr></tfoot></table></div>`;
      }).join("") : `<p style="font-size:9.5pt">Keine Anträge im Prüfzeitraum.</p>`);
    }).join("")}
    <div class="foot">Erstellt am ${fmtDate(todayISO())} mit SOLIDAGO Kassenprüfung ${esc(view.version || "")} · Prüfjahr ${esc(s.jahr)}</div></div>`;
  $("#print").innerHTML = page1 + overview + detail;
}

/* ================= Daten ================= */
function renderDaten(m) {
  const nD = Object.keys(S.docs).length;
  m.innerHTML = `
  <div class="grid g2" style="align-items:start">
    <div class="card">
      <h3>Sicherung</h3>
      <p class="hint">Alle Daten und Fotos liegen nur auf diesem PC – nichts wird ins Internet übertragen. Speichere zwischendurch eine Sicherung, z. B. auf einen USB-Stick.</p>
      <p>${S.clients.length} Klienten · ${nD} Belege</p>
      <div class="row"><button class="primary" id="exp">Sicherung speichern …</button><button id="imp">Sicherung laden …</button><button id="folder">Datenordner öffnen</button></div>
    </div>
    <div class="card">
      <h3>Neues Prüfjahr</h3>
      <p class="hint">Löscht alle Belege und Prüfergebnisse. Vorher den Bericht als PDF und eine Sicherung speichern!</p>
      <div class="row"><button class="danger" id="newYearKeep">Neues Jahr – Klienten behalten</button><button class="danger" id="wipe">Alles löschen</button></div>
    </div>
    <div class="card">
      <h3>Beispieldaten</h3>
      <p class="hint">Lädt erfundene Anträge und Rechnungen (ohne Fotos) – mit einem Rechenfehler, einer Doppelung, einem fehlenden Beleg und unsicher gelesenen Stellen –, um das Programm auszuprobieren. Ersetzt die aktuellen Daten.</p>
      <button id="demo">Beispieldaten laden</button>
    </div>
    <div class="card">
      <h3>Hinweise</h3>
      <p class="hint" style="margin:0">• Beim ersten Klick auf „Belege vom Handy“ fragt Windows, ob die App im Netzwerk erreichbar sein darf: <b>„Private Netzwerke“ anhaken</b> und „Zugriff zulassen“ klicken.<br>
      • Handy und PC müssen im <b>selben WLAN</b> sein.<br>
      • Datenordner: <span class="url" style="font-size:11px">${esc(view.datenOrdner || "")}</span><br>
      • Version ${esc(view.version || "")}</p>
    </div>
  </div>`;
  $("#exp").onclick = async () => { const p = await window.api.backup(); if (p) toast("Sicherung gespeichert: " + p); };
  $("#imp").onclick = () => confirmBox("Aktuelle Daten durch eine Sicherung ersetzen?", async () => { try { if (await window.api.restore()) { toast("Sicherung geladen"); } } catch (e) { toast("Fehler: " + e.message); } });
  $("#folder").onclick = () => window.api.openFolder();
  $("#newYearKeep").onclick = () => confirmBox("Alle Belege löschen und ein neues Prüfjahr beginnen? Klienten und Prüfer-Angaben bleiben erhalten.", async () => { await window.api.reset(true); toast("Neues Prüfjahr angelegt"); });
  $("#wipe").onclick = () => confirmBox("Wirklich ALLE Daten löschen?", async () => { await window.api.reset(false); });
  $("#demo").onclick = () => confirmBox("Aktuelle Daten durch Beispieldaten ersetzen?", async () => { await window.api.replaceAll(demoState()); view.tab = "pruefung"; toast("Beispieldaten geladen"); });
}

function demoState() {
  const y = S.settings.jahr, D = {}; let seq = 0;
  const st = { ...JSON.parse(JSON.stringify(S)), docs: D, clients: [], klaerung: {}, seq: 0 };
  Object.assign(st.settings, { verein: "Gemeinschaft Beispielstadt", pruefer1: "Erika Beispiel, Musterweg 1, 01067 Dresden", ort: "Dresden", kassier: "Max Kassenwart (Beispiel)" });
  const A = (nr, name, datum, gesamt, zeilen, summen, unsicher = []) => { const id = "demoA" + (++seq); D[id] = { id, name: `Antrag ${nr}.jpg`, seq, batch: "demo", quelle: "handy", eingang: new Date().toISOString(), status: "fertig", typ: "antrag", previews: [], bestaetigt: {},
    daten: { datum: `${y}-${datum}`, mitglied: nr, name, gesamt, summen, unsicher, zeilen: zeilen.map((z, i) => ({ id: `${id}z${i}`, nr: String(i + 1), datum: `${y}-${z[0]}`, kat: z[1], betrag: z[2], unsicher: !!z[3] })) } }; };
  const Rg = (aussteller, nummer, datum, betrag, kat, unsicher = []) => { const id = "demoR" + (++seq); D[id] = { id, name: `Rechnung ${aussteller}.jpg`, seq, batch: "demo", quelle: "handy", eingang: new Date().toISOString(), status: "fertig", typ: "rechnung", previews: [], bestaetigt: {},
    daten: { aussteller, nummer, datum: `${y}-${datum}`, betrag, alleBetraege: [betrag], kategorie: kat, bezahlt: false, unsicher } }; };
  A("723", "Anna Muster", "10-26", 124.74, [["09-02", "ZAB", 107.01], ["09-16", "ZAB", 17.73, true]], { ZAB: 124.74 });
  Rg("Zahnarztpraxis Dr. Muster", "R-0815", "09-02", 107.01, "ZAB"); Rg("Zahnarztpraxis Dr. Muster", "R-0902", "09-16", 17.73, "ZAB");
  A("101", "Bernd Beispiel", "03-15", 300.00, [["02-28", "AHMIT", 66.00], ["03-01", "AMB", 205.00], ["03-05", "AMB", 39.00]], { AHMIT: 66.00, AMB: 234.00 }, ["summe_AMB"]);
  Rg("Linden-Apotheke", null, "02-28", 40.00, "AHMIT"); Rg("Linden-Apotheke", null, "02-28", 26.00, "AHMIT", ["betrag"]); Rg("Heilpraktikerin Grün", "HP-77", "03-01", 205.00, "AMB");
  A("102", "Clara Probe", "06-01", 89.90, [["05-20", "PRAEV", 89.90]], { PRAEV: 89.90 });
  Rg("Yogaschule Sonnenhof", "Y-12", "05-20", 89.90, "PRAEV");
  A("102", "Clara Probe", "11-12", 154.80, [["05-20", "PRAEV", 89.90], ["11-01", "AHMIT", 64.90]], { PRAEV: 89.90, AHMIT: 64.90 });
  Rg("Yogaschule Sonnenhof", "Y-12", "05-20", 89.90, "PRAEV"); Rg("Physio am Park", "P-3", "11-01", 64.90, "AMB");
  Rg("Optiker Klarblick", "O-5", "07-07", 120.00, null);
  st.seq = seq;
  return st;
}

/* ================= Handy-Kopplung ================= */
async function openHandy() {
  let info;
  try { info = await window.api.handyStart(); } catch (e) { return toast("Konnte den Empfang nicht starten: " + e.message); }
  const card = $("#modalcard"); card.classList.add("wide");
  const draw = () => {
    const n = Object.values(S.docs).filter(d => d.batch === info.batch).length;
    card.innerHTML = info.urls.length ? `
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2>Belege vom Handy senden</h2><button id="hClose">Fertig</button></div>
      <div class="handy">
        <img class="qr" src="${info.qr}" alt="QR-Code">
        <div>
          <ol>
            <li>Handy mit <b>demselben WLAN</b> wie dieser PC verbinden.</li>
            <li>Mit der <b>Kamera-App</b> den QR-Code scannen und den Link öffnen (Chrome).</li>
            <li>„📷 Foto aufnehmen“ tippen – zuerst den <b>Antrag</b>, dann die <b>Rechnungen</b> dazu. Oder vorhandene Fotos/PDFs auswählen.</li>
          </ol>
          <p class="hint">Falls der QR-Code nicht klappt, diese Adresse im Handy-Browser eintippen:<br><span class="url">${esc(info.urls[0])}</span>
          ${info.urls.length > 1 ? `<br>Andere Adressen dieses PCs: ${info.urls.slice(1).map(u => `<span class="url">${esc(u)}</span>`).join(" ")}` : ""}</p>
          <p style="margin:14px 0 4px">Empfangen in dieser Sitzung: <span class="big">${n}</span> Beleg(e)</p>
          <p class="hint" style="margin:10px 0 0">🔒 Der Link funktioniert nur, solange dieses Fenster offen ist. Die Fotos gehen direkt über dein WLAN auf diesen PC – nicht ins Internet.<br>
          Fragt Windows nach der Firewall: <b>„Private Netzwerke“</b> erlauben. Kommt am Handy „Seite nicht erreichbar“, prüfe WLAN und Firewall.</p>
        </div>
      </div>` : `<h2>Kein WLAN gefunden</h2><p>Dieser PC scheint mit keinem Heimnetz verbunden zu sein. Bitte mit dem WLAN verbinden und erneut versuchen – oder die Fotos per Datei-Import übernehmen.</p><div class="row" style="justify-content:flex-end"><button id="hClose">Schließen</button></div>`;
    $("#hClose").onclick = close;
  };
  const close = () => { clearInterval(t); window.api.handyStop(); $("#modal").classList.remove("show"); card.classList.remove("wide"); render(); };
  draw(); $("#modal").classList.add("show");
  const t = setInterval(draw, 1500);
}

/* ================= PDF-Seiten für die Texterkennung ================= */
async function renderPdfPages({ req, url }) {
  try {
    const lib = window.pdfjsLib; if (!lib) throw new Error("PDF-Unterstützung nicht verfügbar");
    lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    const pdf = await lib.getDocument({ url, isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
      const pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: Math.min(4, 1654 / v1.width) });
      const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const rgba = ctx.getImageData(0, 0, cv.width, cv.height).data, g = new Uint8Array(cv.width * cv.height);
      for (let j = 0, k = 0; j < g.length; j++, k += 4) g[j] = (rgba[k] * 299 + rgba[k + 1] * 587 + rgba[k + 2] * 114 + 500) / 1000;
      pages.push({ w: cv.width, h: cv.height, d: g });
    }
    await window.api.pdfResult(req, pages, null);
  } catch (e) { await window.api.pdfResult(req, null, String(e.message || e)); }
}

/* ---------------- Dialog ---------------- */
function confirmBox(text, onOk) {
  const card = $("#modalcard"); card.classList.remove("wide");
  card.innerHTML = `<p style="margin-top:0">${esc(text)}</p><div class="row" style="justify-content:flex-end"><button id="mNo">Abbrechen</button><button class="primary" id="mYes">OK</button></div>`;
  $("#modal").classList.add("show");
  $("#mNo").onclick = () => $("#modal").classList.remove("show");
  $("#mYes").onclick = () => { $("#modal").classList.remove("show"); onOk(); };
}
