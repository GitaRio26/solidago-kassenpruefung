import sys,cv2,numpy as np,pytesseract,re
def warp_page(g):
    bl=cv2.GaussianBlur(g,(5,5),0); _,th=cv2.threshold(bl,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    cnts,_=cv2.findContours(th,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); c=max(cnts,key=cv2.contourArea)
    ap=cv2.approxPolyDP(c,0.02*cv2.arcLength(c,True),True)
    if len(ap)!=4: return cv2.resize(g,None,fx=2.3,fy=2.3,interpolation=cv2.INTER_CUBIC)
    p=ap.reshape(4,2).astype("float32"); s=p.sum(1); d=np.diff(p,axis=1).ravel()
    src=np.array([p[s.argmin()],p[d.argmin()],p[s.argmax()],p[d.argmax()]],dtype="float32")
    W,H=1654,2339; return cv2.warpPerspective(g,cv2.getPerspectiveTransform(src,np.array([[0,0],[W,0],[W,H],[0,H]],dtype="float32")),(W,H))
def peaks(arr,minval,gap):
    idx=np.where(arr>minval)[0]; out=[]
    for i in idx:
        if not out or i-out[-1][-1]>gap: out.append([i])
        else: out[-1].append(i)
    return [int(np.mean(p)) for p in out]
g=warp_page(cv2.imread(sys.argv[1],0))
inv=255-cv2.adaptiveThreshold(g,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,12)
Hh,Ww=inv.shape
h=cv2.morphologyEx(inv,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(Ww//12,1)))
v=cv2.morphologyEx(inv,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,25)))
ys=peaks(h.sum(1)/255,Ww*0.35,10)
# Tabelle = längste Folge von Linien mit Abstand < 100 px
runs=[[ys[0]]]
for y in ys[1:]:
    (runs[-1].append(y) if y-runs[-1][-1]<100 else runs.append([y]))
tab=max(runs,key=len); t0,t1=tab[0],tab[-1]
xs=peaks(v[t0:t1].sum(0)/255,(t1-t0)*0.5,10)
print(f"Tabelle: {len(tab)} Zeilenlinien, {len(xs)} Spaltenlinien")

clean=255-(inv & ~cv2.dilate(h|v,np.ones((5,5))))
d=pytesseract.image_to_data(clean[t0-10:t1+10],lang="deu",config="--psm 11",output_type=pytesseract.Output.DICT)
heads={}
for i,t in enumerate(d["text"]):
    k=re.sub(r"[^A-Z]","",t.upper())
    if k in ("PRAEV","AMB","STAT","ZAB","ZAER","AHMIT") and k not in heads: heads[k]=d["left"][i]+d["width"][i]//2
order=["PRAEV","AMB","STAT","ZAB","ZAER","AHMIT"]
# fehlende Köpfe aus gleichmäßigen Abständen ergänzen
known=[(order.index(k),x) for k,x in heads.items()]
if len(known)>=2:
    (i0,x0),(i1,x1)=min(known),max(known); step=(x1-x0)/(i1-i0)
    for i,k in enumerate(order): heads.setdefault(k,int(x0+(i-i0)*step))
centers=[heads[k] for k in order]; step=(centers[-1]-centers[0])/5
print("Spaltenmitten:",dict(zip(order,centers)))
amt=re.compile(r"\d{1,5},\d{2}"); dt=re.compile(r"\d{2}\.\d{2}\.\d{4}")
rows=[]
for r in range(len(tab)-1):
    a,b=tab[r],tab[r+1]
    if b-a<25: continue
    strip=cv2.copyMakeBorder(clean[a+3:b-3],15,15,15,15,cv2.BORDER_CONSTANT,value=255)
    dd=pytesseract.image_to_data(strip,lang="deu",config="--psm 6",output_type=pytesseract.Output.DICT)
    row={}
    for i,t in enumerate(dd["text"]):
        t=t.strip(" |.'\"‚,;:")
        cx=dd["left"][i]+dd["width"][i]//2-15
        if dt.fullmatch(t): row["Datum"]=t
        elif t.upper().startswith("SUMME"): row["Nr"]="SUMMEN"
        elif amt.fullmatch(t):
            j=min(range(6),key=lambda j:abs(centers[j]-cx))
            if abs(centers[j]-cx)<step*0.6: row[order[j]]=t
        elif re.fullmatch(r"\d{1,2}",t) and cx<centers[0]-2*step: row.setdefault("Nr",t)
    if any(k in order for k in row): rows.append(row); print(row)
full=pytesseract.image_to_string(clean,lang="deu",config="--psm 6")
for lab,pat in [("Antragsdatum",r"(?:Auszahlung vom|Datum)\s*(\d{2}\.\d{2}\.\d{4})"),("Mitgliedsnr",r"Mitgliedsnummer\s*(\d+)"),("Gesamtsumme",r"Gesamtsumme von\s*([\d.]+,\d{2})")]:
    m=re.search(pat,full); print(lab+":",m and m.group(1))
