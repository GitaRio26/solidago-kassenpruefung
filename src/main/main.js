"use strict";
// Hauptprozess der Desktop-App: Fenster, Speicherung, Texterkennung, Handy-Server, PDF-Bericht.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { Store } = require("./store");
const { Leser } = require("./leser");
const { HandyServer } = require("./handy");
const ip = require("../core/imgproc");
const OCR = require("../core/ocr");
const QRCode = require("qrcode");

const ROOT = path.join(__dirname, "..", "..");
const UI_DIR = path.join(ROOT, "src", "renderer");
const UI_MAP = { // zusätzliche Dateien, die die Oberfläche laden darf
  "core/pruefung.js": path.join(ROOT, "src", "core", "pruefung.js"),
  "vendor/pdf.min.js": path.join(ROOT, "node_modules", "pdfjs-dist", "build", "pdf.min.js"),
  "vendor/pdf.worker.min.js": path.join(ROOT, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.js")
};

app.commandLine.appendSwitch("lang", "de-DE"); // deutsche Datumsfelder und Texte
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win = null, store = null, leser = null, handy = null, sendTimer = null;
const pdfRequests = new Map();

function broadcast() { // Änderungen aus dem Hintergrund an die Oberfläche melden (gebündelt)
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send("state", { S: store.S, pending: leser.pending() }); }, 150);
}

function decodeImage(buf) {
  let im = nativeImage.createFromBuffer(buf);
  if (im.isEmpty()) throw new Error("Bildformat wird nicht unterstützt – bitte als JPG oder PNG senden.");
  const { width, height } = im.getSize(), max = Math.max(width, height);
  if (max > 2600) im = im.resize(width >= height ? { width: 2600, quality: "better" } : { height: 2600, quality: "better" });
  const s = im.getSize();
  return ip.fromRGBA(s.width, s.height, im.toBitmap(), true);
}
// PDF-Seiten rendert die Oberfläche (pdf.js) und schickt Graubilder zurück
function renderPdf(docId) {
  return new Promise((resolve, reject) => {
    const req = Math.random().toString(36).slice(2);
    const t = setTimeout(() => { pdfRequests.delete(req); reject(new Error("PDF konnte nicht gelesen werden (Zeitüberschreitung).")); }, 120000);
    pdfRequests.set(req, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
    win.webContents.send("pdf:render", { req, url: `app://beleg/${store.S.docs[docId].file}` });
  });
}

function insideDir(dir, rel) {
  const p = path.resolve(dir, rel);
  return p.startsWith(path.resolve(dir) + path.sep) ? p : null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1050, minHeight: 650, show: false,
    title: "SOLIDAGO Kassenprüfung", backgroundColor: "#f5f7f6", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.loadURL("app://ui/index.html");
  win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath("userData"), "Pruefdaten"));
  protocol.handle("app", req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    let p = null;
    if (u.host === "ui") p = UI_MAP[rel] || insideDir(UI_DIR, rel);
    else if (u.host === "beleg") p = insideDir(store.belege, rel);
    if (!p || !fs.existsSync(p)) return new Response("Nicht gefunden", { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
  leser = new Leser({
    store, decodeImage, renderPdf, onChange: broadcast,
    ocrFactory: () => OCR.createTesseractJs({ cachePath: path.join(app.getPath("userData"), "ocr-cache") })
  });
  handy = new HandyServer({
    onFile: (buf, name, batch) => leser.addFile(buf, name, { quelle: "handy", batch }),
    statusFor: id => { const d = store.S.docs[id]; return d ? { status: d.status, typ: d.typ } : { status: "gelöscht" }; }
  });
  // Belege, die beim letzten Beenden noch nicht fertig gelesen waren, erneut einreihen
  for (const d of Object.values(store.S.docs)) if (d.status === "wartet" || d.status === "liest") leser.enqueue(d.id);
  createWindow();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => { handy?.stop(); store?.save(true); leser?.close().catch(() => {}); app.quit(); });

// ---------------- Schnittstelle zur Oberfläche ----------------
ipcMain.handle("state:get", () => ({ S: store.S, pending: leser.pending(), version: app.getVersion(), datenOrdner: store.dir }));
ipcMain.handle("state:set", (_e, p, value) => { store.set(p, value); return true; });
ipcMain.handle("state:replaceSettings", (_e, settings) => { store.S.settings = settings; store.save(); return true; });

ipcMain.handle("docs:importPaths", (_e, paths) => {
  const batch = "i" + Date.now().toString(36); let n = 0;
  for (const p of paths || []) {
    if (!/\.(jpe?g|png|pdf)$/i.test(p)) continue;
    leser.addFile(fs.readFileSync(p), path.basename(p), { quelle: "import", batch }); n++;
  }
  return n;
});
ipcMain.handle("docs:importDialog", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Belege auswählen", properties: ["openFile", "multiSelections"], filters: [{ name: "Fotos und PDF", extensions: ["jpg", "jpeg", "png", "pdf"] }] });
  if (r.canceled) return 0;
  const batch = "i" + Date.now().toString(36);
  for (const p of r.filePaths) leser.addFile(fs.readFileSync(p), path.basename(p), { quelle: "import", batch });
  return r.filePaths.length;
});
ipcMain.handle("doc:reread", (_e, id, typ) => leser.reread(id, typ));
ipcMain.handle("doc:remove", (_e, id) => leser.remove(id));
ipcMain.handle("pdf:result", (_e, req, pages, error) => {
  const r = pdfRequests.get(req); if (!r) return; pdfRequests.delete(req);
  if (error) r.reject(new Error(error));
  else r.resolve(pages.map(p => ip.gray(p.w, p.h, new Uint8Array(p.d))));
});

ipcMain.handle("handy:start", async () => {
  const info = await handy.start();
  info.qr = info.urls[0] ? await QRCode.toDataURL(info.urls[0], { margin: 1, width: 320, errorCorrectionLevel: "M" }) : null;
  return info;
});
ipcMain.handle("handy:stop", () => { handy.stop(); return true; });

ipcMain.handle("report:pdf", async (_e, jahr) => {
  const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  const r = await dialog.showSaveDialog(win, { title: "Bericht speichern", defaultPath: path.join(app.getPath("documents"), `Kassenpruefungsbericht_${jahr}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, pdf);
  shell.openPath(r.filePath);
  return r.filePath;
});

ipcMain.handle("data:backup", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Ordner für die Sicherung wählen (z. B. USB-Stick)", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled) return null;
  const target = path.join(r.filePaths[0], `SOLIDAGO-Sicherung_${store.S.settings.jahr}_${new Date().toISOString().slice(0, 10)}`);
  store.backupTo(target);
  return target;
});
ipcMain.handle("data:restore", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Sicherungsordner wählen (SOLIDAGO-Sicherung_…)", properties: ["openDirectory"] });
  if (r.canceled) return false;
  store.restoreFrom(r.filePaths[0]);
  broadcast(); return true;
});
ipcMain.handle("data:reset", (_e, keepClients) => { store.reset(!!keepClients); leser.queue = []; broadcast(); return true; });
ipcMain.handle("data:replace", (_e, S) => { store.reset(false); store.S = S; store.save(true); broadcast(); return true; });
ipcMain.handle("data:openFolder", () => shell.openPath(store.dir));
