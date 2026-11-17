"use strict";
// Sichere Brücke zwischen Oberfläche und Hauptprozess (nur diese Funktionen sind erlaubt)
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("state:get"),
  set: (path, value) => ipcRenderer.invoke("state:set", path, value),
  replaceSettings: s => ipcRenderer.invoke("state:replaceSettings", s),
  onState: cb => ipcRenderer.on("state", (_e, msg) => cb(msg)),
  importFiles: files => ipcRenderer.invoke("docs:importPaths", files.map(f => webUtils.getPathForFile(f)).filter(Boolean)),
  importDialog: () => ipcRenderer.invoke("docs:importDialog"),
  reread: (id, typ) => ipcRenderer.invoke("doc:reread", id, typ),
  removeDoc: id => ipcRenderer.invoke("doc:remove", id),
  onPdfRender: cb => ipcRenderer.on("pdf:render", (_e, msg) => cb(msg)),
  pdfResult: (req, pages, error) => ipcRenderer.invoke("pdf:result", req, pages, error),
  handyStart: () => ipcRenderer.invoke("handy:start"),
  handyStop: () => ipcRenderer.invoke("handy:stop"),
  reportPdf: jahr => ipcRenderer.invoke("report:pdf", jahr),
  backup: () => ipcRenderer.invoke("data:backup"),
  restore: () => ipcRenderer.invoke("data:restore"),
  reset: keep => ipcRenderer.invoke("data:reset", keep),
  replaceAll: S => ipcRenderer.invoke("data:replace", S),
  openFolder: () => ipcRenderer.invoke("data:openFolder"),
  belegUrl: file => `app://beleg/${encodeURIComponent(file)}`
});
