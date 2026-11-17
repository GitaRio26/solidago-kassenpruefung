"use strict";
// Bildverarbeitung in reinem JavaScript (Ersatz für die OpenCV-Schritte aus ocr-test/).
// Ein Graubild ist {w, h, d: Uint8Array} mit Werten 0..255.

const A4_W = 1654, A4_H = 2339;

function gray(w, h, d) { return { w, h, d: d || new Uint8Array(w * h) }; }

// RGBA/BGRA (4 Kanäle) -> Grau (Reihenfolge der Farben fast egal, Gewichte wie OpenCV für RGB)
function fromRGBA(w, h, buf, bgr = false) {
  const g = gray(w, h);
  const [ri, bi] = bgr ? [2, 0] : [0, 2];
  for (let i = 0, j = 0; i < g.d.length; i++, j += 4) g.d[i] = (buf[j + ri] * 299 + buf[j + 1] * 587 + buf[j + bi] * 114 + 500) / 1000;
  return g;
}

function rotate(img, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return img;
  const { w, h, d } = img;
  const out = deg === 180 ? gray(w, h) : gray(h, w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = d[y * w + x];
    if (deg === 90) out.d[x * h + (h - 1 - y)] = v;
    else if (deg === 270) out.d[(w - 1 - x) * h + y] = v;
    else out.d[(h - 1 - y) * w + (w - 1 - x)] = v;
  }
  return out;
}

// --- Weichzeichnen (separierbarer Gauß, Rand wie OpenCV) ---
function gaussKernel(k, sigma) {
  if (!sigma || sigma <= 0) sigma = 0.3 * ((k - 1) * 0.5 - 1) + 0.8;
  const r = (k - 1) / 2, ker = new Float64Array(k);
  let s = 0;
  for (let i = 0; i < k; i++) { ker[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)); s += ker[i]; }
  for (let i = 0; i < k; i++) ker[i] /= s;
  return ker;
}
const reflect101 = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i; return i; };
const replicate = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
function blurFloat(img, k, sigma, border = reflect101) {
  const { w, h, d } = img, ker = gaussKernel(k, sigma), r = (k - 1) / 2;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const xi = new Int32Array(w + 2 * r), yi = new Int32Array(h + 2 * r);
  for (let i = -r; i < w + r; i++) xi[i + r] = border(i, w);
  for (let i = -r; i < h + r; i++) yi[i + r] = border(i, h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) { let s = 0; for (let i = 0; i < k; i++) s += ker[i] * d[row + xi[x + i]]; tmp[row + x] = s; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = 0; i < k; i++) s += ker[i] * tmp[yi[y + i] * w + x]; out[y * w + x] = s;
  }
  return out;
}
function gaussianBlur(img, k, sigma) {
  const f = blurFloat(img, k, sigma), out = gray(img.w, img.h);
  for (let i = 0; i < f.length; i++) out.d[i] = Math.round(f[i]);
  return out;
}

// --- Schwellwerte ---
function otsu(img) {
  const hist = new Float64Array(256);
  for (const v of img.d) hist[v]++;
  const n = img.d.length;
  let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, th = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}
// wie cv2.adaptiveThreshold(GAUSSIAN_C, THRESH_BINARY, block, C): hell (255) = Hintergrund
function adaptiveThreshold(img, block = 31, C = 12) {
  const m = blurFloat(img, block, 0, replicate), out = gray(img.w, img.h);
  // OpenCV rundet den Mittelwert auf ganze Zahlen
  for (let i = 0; i < m.length; i++) out.d[i] = img.d[i] > Math.round(m[i]) - C ? 255 : 0;
  return out;
}

// --- Seite im Foto finden und entzerren ---
// Größte zusammenhängende helle Fläche nach Otsu = Papier. Ecken = Extrempunkte von x+y und y-x
// (gleiche Eckenreihenfolge wie im Python-Test). Wenn die Fläche kein Viereck ist: nur vergrößern.
function findPage(img) {
  const { w, h } = img;
  const blImg = gaussianBlur(img, 5, 0), th = otsu(blImg), bl = blImg.d;
  const lab = new Int32Array(w * h);
  let bestId = 0, bestN = 0, id = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (lab[start] || bl[start] <= th) continue;
    id++; let sp = 0, n = 0; stack[sp++] = start; lab[start] = id;
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w; n++;
      if (x > 0 && !lab[p - 1] && bl[p - 1] > th) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && !lab[p + 1] && bl[p + 1] > th) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && !lab[p - w] && bl[p - w] > th) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && !lab[p + w] && bl[p + w] > th) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (n > bestN) { bestN = n; bestId = id; }
  }
  if (!bestN) return null;
  const best = { minX: new Int32Array(h).fill(w), maxX: new Int32Array(h).fill(-1) };
  for (let p = 0; p < w * h; p++) if (lab[p] === bestId) {
    const y = (p / w) | 0, x = p - y * w;
    if (x < best.minX[y]) best.minX[y] = x; if (x > best.maxX[y]) best.maxX[y] = x;
  }
  let filled = 0;
  let tl, tr, br, blc, sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (let y = 0; y < h; y++) {
    if (best.maxX[y] < 0) continue;
    filled += best.maxX[y] - best.minX[y] + 1;
    for (const x of [best.minX[y], best.maxX[y]]) {
      const s = x + y, dd = y - x;
      if (s < sMin) { sMin = s; tl = [x, y]; }
      if (s > sMax) { sMax = s; br = [x, y]; }
      if (dd < dMin) { dMin = dd; tr = [x, y]; }
      if (dd > dMax) { dMax = dd; blc = [x, y]; }
    }
  }
  const quad = [tl, tr, br, blc];
  const area = Math.abs(quad.reduce((a, p, i) => { const q = quad[(i + 1) % 4]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const ok = filled > w * h * 0.2 && area > filled * 0.9 && area < filled * 1.1;
  return ok ? quad : null;
}

function solveHomography(src, dst) { // Abbildung src[i] -> dst[i]
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / A[i][i]);
}
function warpQuad(img, quad, W = A4_W, H = A4_H) {
  const M = solveHomography([[0, 0], [W, 0], [W, H], [0, H]], quad); // Ziel -> Foto
  const out = gray(W, H), { w, h, d } = img;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = M[6] * x + M[7] * y + 1, u = (M[0] * x + M[1] * y + M[2]) / q, v = (M[3] * x + M[4] * y + M[5]) / q;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out.d[y * W + x] = 0; continue; }
    const fx = u - x0, fy = v - y0, i = y0 * w + x0;
    out.d[y * W + x] = Math.round((d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy);
  }
  return out;
}
function resize(img, W, H) {
  const out = gray(W, H), { w, h, d } = img, sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.min(w - 1.001, Math.max(0, (x + 0.5) * sx - 0.5)), v = Math.min(h - 1.001, Math.max(0, (y + 0.5) * sy - 0.5));
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * w + x0;
    out.d[y * W + x] = Math.round((d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy);
  }
  return out;
}
// Ergebnis: entzerrte Seite (A4-Format) + ob ein Seitenrand gefunden wurde
function warpPage(img) {
  const quad = findPage(img);
  if (quad) return { page: warpQuad(img, quad), quad };
  // kein Viereck: proportional auf A4-Breite bringen
  return { page: resize(img, A4_W, Math.round(img.h * A4_W / img.w)), quad: null };
}

// --- Linien (Tabellengitter) ---
// Öffnen mit einer Linie der Länge k = nur zusammenhängende Läufe >= k behalten
function openHorizontal(bin, k) {
  const { w, h, d } = bin, out = gray(w, h);
  for (let y = 0; y < h; y++) {
    let x = 0; const r = y * w;
    while (x < w) {
      if (!d[r + x]) { x++; continue; }
      let e = x; while (e < w && d[r + e]) e++;
      if (e - x >= k) out.d.fill(255, r + x, r + e);
      x = e;
    }
  }
  return out;
}
function openVertical(bin, k) {
  const { w, h, d } = bin, out = gray(w, h);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!d[y * w + x]) { y++; continue; }
      let e = y; while (e < h && d[e * w + x]) e++;
      if (e - y >= k) for (let i = y; i < e; i++) out.d[i * w + x] = 255;
      y = e;
    }
  }
  return out;
}
function dilateSquare(bin, r) {
  const { w, h, d } = bin, tmp = new Uint8Array(w * h), out = gray(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r) && !m; i++) m = d[y * w + i];
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let i = Math.max(0, y - r); i <= Math.min(h - 1, y + r) && !m; i++) m = tmp[i * w + x];
    out.d[y * w + x] = m;
  }
  return out;
}
// nur in einer Richtung verbreitern (rx: waagerecht, ry: senkrecht)
function dilateAxis(bin, rx, ry) {
  const { w, h, d } = bin, out = gray(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let j = -ry; j <= ry && !m; j++) { const yy = y + j; if (yy < 0 || yy >= h) continue; for (let i = -rx; i <= rx && !m; i++) { const xx = x + i; if (xx >= 0 && xx < w) m = d[yy * w + xx]; } }
    out.d[y * w + x] = m;
  }
  return out;
}
function rowSums(bin) { const s = new Float64Array(bin.h); for (let y = 0; y < bin.h; y++) { let a = 0; for (let x = 0; x < bin.w; x++) a += bin.d[y * bin.w + x]; s[y] = a / 255; } return s; }
function colSums(bin, y0 = 0, y1 = bin.h) { const s = new Float64Array(bin.w); for (let y = y0; y < y1; y++) for (let x = 0; x < bin.w; x++) s[x] += bin.d[y * bin.w + x] / 255; return s; }
function peaks(arr, minval, gap) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (!(arr[i] > minval)) continue;
    const last = out[out.length - 1];
    if (!last || i - last[last.length - 1] > gap) out.push([i]); else last.push(i);
  }
  return out.map(p => Math.trunc(p.reduce((a, b) => a + b, 0) / p.length));
}
function crop(img, x0, y0, x1, y1) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.w, x1); y1 = Math.min(img.h, y1);
  const out = gray(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) out.d.set(img.d.subarray(y * img.w + x0, y * img.w + x1), (y - y0) * out.w);
  return out;
}
function pad(img, p, val = 255) {
  const out = gray(img.w + 2 * p, img.h + 2 * p); out.d.fill(val);
  for (let y = 0; y < img.h; y++) out.d.set(img.d.subarray(y * img.w, (y + 1) * img.w), (y + p) * out.w + p);
  return out;
}

// Größte zusammenhängende Fläche in einem Schwarz-Weiß-Bild (255 = gesetzt) -> Eckpunkte + Größe
function largestComponentQuad(bin) {
  const { w, h, d } = bin, lab = new Int32Array(w * h), stack = new Int32Array(w * h);
  let bestId = 0, bestN = 0, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || !d[s]) continue;
    id++; let sp = 0, n = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const p = stack[--sp], x = p % w; n++;
      if (x > 0 && !lab[p - 1] && d[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && !lab[p + 1] && d[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (p >= w && !lab[p - w] && d[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (p < w * (h - 1) && !lab[p + w] && d[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (n > bestN) { bestN = n; bestId = id; }
  }
  if (!bestN) return null;
  let tl, tr, br, bl, sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity, x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let p = 0; p < w * h; p++) {
    if (lab[p] !== bestId) continue;
    const y = (p / w) | 0, x = p - y * w, s = x + y, dd = y - x;
    if (s < sMin) { sMin = s; tl = [x, y]; } if (s > sMax) { sMax = s; br = [x, y]; }
    if (dd < dMin) { dMin = dd; tr = [x, y]; } if (dd > dMax) { dMax = dd; bl = [x, y]; }
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { quad: [tl, tr, br, bl], n: bestN, box: [x0, y0, x1, y1] };
}

// Tabellengitter auf der Seite suchen und die Tabelle an ihren vier Ecken begradigen.
// Funktioniert auch, wenn der Blattrand nicht gefunden wurde oder das Blatt leicht schräg/gewölbt liegt.
function rectifyTable(page) {
  const bin = adaptiveThreshold(page, 31, 12);
  const inv = gray(page.w, page.h); for (let i = 0; i < inv.d.length; i++) inv.d[i] = 255 - bin.d[i];
  const k = Math.max(30, Math.round(page.w / 40)); // kurze Linienstücke: tolerant gegen Schräglage
  const hl = openHorizontal(inv, k), vl = openVertical(inv, k);
  const grid = gray(page.w, page.h); for (let i = 0; i < grid.d.length; i++) grid.d[i] = hl.d[i] | vl.d[i];
  const c = largestComponentQuad(dilateSquare(grid, 3));
  if (!c) return null;
  const [x0, y0, x1, y1] = c.box;
  if (x1 - x0 < page.w * 0.4 || y1 - y0 < page.h * 0.08) return null; // zu klein für das Antragsgitter
  // Rand um das Gitter lassen (oben mehr: dort steht die Kopfzeile mit PRAEV … AHMIT)
  const mx = Math.round(page.w * 0.012), mTop = Math.round(page.h * 0.035), mBot = Math.round(page.h * 0.03);
  const [tl, tr, br, bl] = c.quad;
  const quad = [[tl[0] - mx, tl[1] - mTop], [tr[0] + mx, tr[1] - mTop], [br[0] + mx, br[1] + mBot], [bl[0] - mx, bl[1] + mBot]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wq = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2, hq = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const W = A4_W - 120, H = Math.round(W * hq / wq);
  return { table: warpQuad(page, quad, W, H), quad };
}

// Tabellenanalyse wie antrag_auslesen.py: Gitterlinien finden, Linien aus dem Bild entfernen
function analyseTable(page) {
  const bin = adaptiveThreshold(page, 31, 12);
  const inv = gray(page.w, page.h); for (let i = 0; i < inv.d.length; i++) inv.d[i] = 255 - bin.d[i];
  const { w, h } = inv;
  // vor der Liniensuche minimal "verdicken", damit leicht schräge oder gewölbte Linien durchgehend bleiben
  const thickH = dilateAxis(inv, 0, 2), thickV = dilateAxis(inv, 2, 0);
  const hl0 = openHorizontal(thickH, Math.trunc(w / 12)), vl0 = openVertical(thickV, 25);
  const hl = gray(w, h), vl = gray(w, h);
  for (let i = 0; i < hl.d.length; i++) { hl.d[i] = hl0.d[i] & inv.d[i]; vl.d[i] = vl0.d[i] & inv.d[i]; }
  const ys = peaks(rowSums(hl0), w * 0.35, 10);
  const lines = gray(w, h); for (let i = 0; i < lines.d.length; i++) lines.d[i] = hl.d[i] | vl.d[i];
  const dil = dilateSquare(lines, 2);
  const clean = gray(w, h); for (let i = 0; i < clean.d.length; i++) clean.d[i] = 255 - (inv.d[i] & ~dil.d[i] & 255);
  let tab = [];
  if (ys.length) {
    const runs = [[ys[0]]];
    for (const y of ys.slice(1)) { const r = runs[runs.length - 1]; if (y - r[r.length - 1] < 100) r.push(y); else runs.push([y]); }
    tab = runs.reduce((a, b) => (b.length > a.length ? b : a));
  }
  let colLines = [];
  if (tab.length >= 2) colLines = peaks(colSums(vl, tab[0], tab[tab.length - 1]), (tab[tab.length - 1] - tab[0]) * 0.35, 10);
  return { bin, clean, rowLines: tab, colLines };
}

module.exports = { A4_W, A4_H, gray, fromRGBA, rotate, rectifyTable, largestComponentQuad, gaussianBlur, otsu, adaptiveThreshold, findPage, warpPage, warpQuad, resize, openHorizontal, openVertical, dilateSquare, peaks, crop, pad, analyseTable };
