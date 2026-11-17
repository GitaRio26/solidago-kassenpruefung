// Prüflogik mit erfundenen Daten testen. Aufruf: node test/pruefung.test.js
const assert = require("assert");
const P = require("../src/core/pruefung");

let seq = 0;
const S = { docs: {}, clients: [], klaerung: {} };
function antrag(id, batch, mitglied, datum, gesamt, zeilen, summen) {
  S.docs[id] = { id, name: id + ".jpg", seq: ++seq, batch, status: "fertig", typ: "antrag", bestaetigt: {},
    daten: { datum, mitglied, name: "Test " + mitglied, gesamt, summen, unsicher: [],
      zeilen: zeilen.map((z, i) => ({ id: `${id}-z${i + 1}`, nr: String(i + 1), datum: z[0], kat: z[1], betrag: z[2], unsicher: false })) } };
}
function rechnung(id, batch, aussteller, nummer, datum, betrag, extra = {}) {
  S.docs[id] = { id, name: id + ".jpg", seq: ++seq, batch, status: "fertig", typ: "rechnung", bestaetigt: {}, hash: extra.hash,
    daten: { aussteller, nummer, datum, betrag, alleBetraege: [betrag, ...(extra.weitere || [])], kategorie: extra.kat || null, bezahlt: false, unsicher: [] } };
}

// Mitglied 723: Antrag mit 2 Zahnarztrechnungen (wie Beispiel des Nutzers) – alles korrekt
antrag("A1", "b1", "723", "2026-10-26", 124.74, [["2026-09-02", "ZAB", 107.01], ["2026-09-16", "ZAB", 17.73]], { ZAB: 124.74 });
rechnung("R1", "b1", "Zahnarztpraxis Dr. Muster", "R-1", "2026-09-02", 107.01, { kat: "ZAB" });
rechnung("R2", "b1", "Zahnarztpraxis Dr. Muster", "R-2", "2026-09-16", 17.73, { kat: "ZAB" });
// Mitglied 101: Rechenfehler in der Summenzeile, eine Zeile aus 2 Apothekenbelegen, ein Beleg fehlt
antrag("A2", "b2", "101", "2026-03-15", 310.00, [["2026-02-28", "AHMIT", 66.00], ["2026-03-01", "AMB", 205.00], ["2026-03-05", "AMB", 30.00]], { AHMIT: 66.00, AMB: 234.00 });
rechnung("R3", "b2", "Linden-Apotheke", null, "2026-02-28", 40.00, { kat: "AHMIT" });
rechnung("R4", "b2", "Linden-Apotheke", null, "2026-02-27", 26.00, { kat: "AHMIT" });
rechnung("R5", "b2", "Heilpraktikerin Grün", "HP-77", "2026-03-01", 205.00, { kat: "AMB" });
// Mitglied 723 reicht später dieselbe Rechnung R-2 noch einmal ein (Doppelung über Anträge hinweg)
antrag("A3", "b3", "723", "2026-11-30", 17.73, [["2026-09-16", "ZAB", 17.73]], { ZAB: 17.73 });
rechnung("R6", "b3", "Zahnarztpraxis Dr. Muster", "R-2", "2026-09-16", 17.73, { kat: "ZAB" });
// Rechnung ohne Antrag
rechnung("R7", "b3", "Physio am Park", "P-1", "2026-11-02", 88.00, { kat: "AHMIT" });

assert.ok(P.syncKlienten(S));
assert.deepStrictEqual(S.clients.map(c => c.nr).sort(), ["101", "723"]);
const R = P.pruefen(S);
const links = Object.fromEntries(R.links.map(l => [l.docId, l.zeilen.join(",")]));
console.log("Zuordnung:", links);
assert.strictEqual(links.R1, "A1-z1"); assert.strictEqual(links.R2, "A1-z2");
assert.strictEqual(links.R3, "A2-z1"); assert.strictEqual(links.R4, "A2-z1"); // zwei Belege für eine Zeile
assert.strictEqual(links.R5, "A2-z2"); assert.strictEqual(links.R6, "A3-z1");
assert.ok(!links.R7);

const keys = R.befunde.map(b => b.key.split(":")[0] + ":" + b.lvl);
console.log("Befunde:\n " + R.befunde.map(b => `[${b.lvl}] ${b.text}`).join("\n "));
assert.strictEqual(R.antrag.A1.status, "ok");
assert.ok(keys.includes("sum:err"), "Rechenfehler Summenzeile");
assert.ok(keys.includes("ges:err"), "Gesamtsumme passt nicht");
assert.ok(R.befunde.some(b => b.key === "fehlt:A2-z3"), "fehlender Beleg");
assert.ok(R.befunde.some(b => b.key.startsWith("dopp:R6")), "Doppelung Rechnung R-2");
assert.ok(R.befunde.some(b => b.key === "doppz:A3-z1"), "Doppelung Antragszeile");
assert.ok(R.befunde.some(b => b.key === "ohne:R7"), "Rechnung ohne Antrag");
assert.strictEqual(R.client.k723.status, "err");
assert.strictEqual(R.antrag.A2.zeile["A2-z1"].belegt, 66);

// Prüfer klärt die Doppelung -> Antrag 3 nur noch wegen der Antragszeilen-Doppelung beanstandet
S.klaerung["doppz:A3-z1"] = { geklaert: true, bemerkung: "Erstattung zurückgefordert" };
for (const b of R.befunde.filter(b => b.key.startsWith("dopp:R6"))) S.klaerung[b.key] = { geklaert: true };
const R2 = P.pruefen(S);
assert.strictEqual(R2.antrag.A3.status, "ok");
assert.strictEqual(R2.antrag.A3.zeile["A3-z1"].status, "ok");
// Prüfer ordnet R7 von Hand zu "keine Zuordnung" -> bleibt gemeldet
S.docs.R7.zuordnung = { antragId: "A2", zeilen: ["A2-z3"] };
const R3 = P.pruefen(S);
assert.ok(R3.befunde.some(b => b.key === "abw:A2-z3"), "manuelle Zuordnung mit falschem Betrag -> Abweichung");
console.log("\n✓ Prüflogik: alle Tests bestanden.");
