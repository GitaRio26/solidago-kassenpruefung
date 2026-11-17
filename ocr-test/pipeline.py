import sys,re,cv2,numpy as np,pytesseract,subprocess,json
exec(open("antrag_auslesen.py").read().split("g=warp_page")[0])  # warp_page, peaks
amtre=re.compile(r"(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d])")
def eur(s): return float(s.replace(".","").replace(",","."))
def page_text(g):
    b=cv2.adaptiveThreshold(g,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,12)
    return pytesseract.image_to_string(b,lang="deu",config="--psm 6")
def read_antrag(path):
    out=subprocess.run(["python3","antrag_auslesen.py",path],capture_output=True,text=True).stdout
    rows=[eval(l) for l in out.splitlines() if l.startswith("{")]
    g=warp_page(cv2.imread(path,0)); t=page_text(g)
    m=re.search(r"Auszahlung\s+vom\s*(\d{2}\.\d{2}\.\d{4})",t); dat=m and m.group(1)
    m=re.search(r"Mitgliedsnummer\D{0,40}?(\d{2,6})",t,re.S); nr=m and m.group(1)
    m=re.search(r"Gesamtsumme von\s*([\d.]+,\d{2})",t); ges=m and eur(m.group(1))
    return dict(datum=dat,mitglied=nr,gesamt=ges,zeilen=[r for r in rows if r.get("Nr")!="SUMMEN"],summen=next((r for r in rows if r.get("Nr")=="SUMMEN"),{}))
KAT={"ZAB":["zahnarzt","zahnärzt","zahnärzte"],"AHMIT":["apotheke","heilmittel","physiotherap","arznei"],"AMB":["arztpraxis","allgemeinmedizin","heilpraktiker"],"STAT":["klinik","krankenhaus"],"PRAEV":["kurs","prävention","yoga"],"ZAER":["zahnersatz","zahntechni","labor"]}
def read_beleg(path):
    g=warp_page(cv2.imread(path,0)); t=page_text(g)
    lines=[l.strip() for l in t.splitlines() if l.strip()]
    m=re.search(r"(?:Rechnungsbetrag|Gesamtbetrag|zu zahlen|Summe|Betrag)\s*:?\s*([\d.]+,\d{2})",t,re.I)
    m2=re.search(r"Rechnungsdatum\s*:?\s*(\d{2}\.\d{2}\.\d{4})",t)
    m3=re.search(r"Rechnungsnummer\s*:?\s*(\w+)",t)
    low=t.lower(); kat=next((k for k,ws in KAT.items() if any(w in low for w in ws)),None)
    return dict(aussteller=lines[0] if lines else "",betrag=m and eur(m.group(1)),datum=m2 and m2.group(1),
                nummer=m3 and m3.group(1),kategorie=kat,alle_betraege=sorted({eur(a) for a in amtre.findall(t)}),bezahlt="betrag erhalten" in low)
docs=[]
for p in sys.argv[1:]:
    g=warp_page(cv2.imread(p,0)); t=page_text(g).lower()
    typ="Antrag" if ("antrag auf auszahlung" in t or "solidago" in t) else "Rechnung"
    docs.append((p,typ,read_antrag(p) if typ=="Antrag" else read_beleg(p)))
for p,typ,d in docs: print(f"\n[{p.split('/')[-1]}] erkannt als: {typ}\n",json.dumps(d,ensure_ascii=False,indent=1))
# Abgleich
A=[d for p,t,d in docs if t=="Antrag"][0]; B=[d for p,t,d in docs if t=="Rechnung"]
print("\n================ PRÜFUNG ================")
print(f"Antrag vom {A['datum']}, Mitglied {A['mitglied']}, Gesamtsumme {A['gesamt']:.2f} €")
order=["PRAEV","AMB","STAT","ZAB","ZAER","AHMIT"]
for k in order:
    s=round(sum(eur(z[k]) for z in A["zeilen"] if k in z),2); ss=eur(A["summen"].get(k,"0,00"))
    if s or ss: print(f"  Spalte {k}: Zeilen {s:.2f} / Summenzeile {ss:.2f} → {'✓' if abs(s-ss)<.005 else '✗'}")
tot=round(sum(eur(v) for k,v in A["summen"].items() if k in order),2)
print(f"  Summenzeile gesamt {tot:.2f} / Gesamtsumme {A['gesamt']:.2f} → {'✓' if abs(tot-A['gesamt'])<.005 else '✗'}")
used=set()
for z in A["zeilen"]:
    k=next(k for k in order if k in z); v=eur(z[k])
    hit=next((i for i,b in enumerate(B) if i not in used and b["betrag"] is not None and abs(b["betrag"]-v)<.005),None)
    if hit is None: hit=next((i for i,b in enumerate(B) if i not in used and any(abs(a-v)<.005 for a in b["alle_betraege"])),None)
    if hit is None: print(f"  Zeile {z.get('Datum')} {k} {v:.2f} € → ✗ kein passender Beleg"); continue
    used.add(hit); b=B[hit]
    hinweise=[]
    if b["kategorie"] and b["kategorie"]!=k: hinweise.append(f"Kategorie lt. Beleg eher {b['kategorie']}")
    if b["datum"] and b["datum"]!=z.get("Datum"): hinweise.append(f"Rechnungsdatum {b['datum']}")
    print(f"  Zeile {z.get('Datum')} {k} {v:.2f} € → ✓ Rechnung {b['nummer']} ({b['aussteller']}) über {b['betrag']:.2f} €" + (f"  [Hinweis: {'; '.join(hinweise)}]" if hinweise else ""))
for i,b in enumerate(B):
    if i not in used: print(f"  Beleg ohne Antragszeile: {b['nummer']} {b['betrag']}")
