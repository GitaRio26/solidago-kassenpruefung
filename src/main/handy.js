"use strict";
// Kleiner Upload-Server im Heimnetz für das Handy (nur aktiv, solange das Fenster „Belege vom Handy“ offen ist).
const http = require("http");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 60 * 1024 * 1024;

// private IPv4-Adressen dieses PCs (WLAN/LAN), WLAN zuerst
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|vbox/i.test(name)) continue;
      out.push({ name, address: a.address, wlan: /wi-?fi|wlan|wireless|drahtlos/i.test(name) });
    }
  }
  return out.sort((a, b) => b.wlan - a.wlan || (a.address.startsWith("192.168.") ? -1 : 1));
}

class HandyServer {
  constructor({ onFile, statusFor }) { this.onFile = onFile; this.statusFor = statusFor; this.server = null; }
  get running() { return !!this.server; }

  async start() {
    if (this.server) return this.info();
    this.token = crypto.randomBytes(12).toString("base64url");
    this.batch = "h" + Date.now().toString(36);
    this.received = [];
    this.server = http.createServer((req, res) => this.handle(req, res).catch(e => { console.error(e); send(res, 500, "Fehler"); }));
    await new Promise((resolve, reject) => {
      const tryPort = (ports) => {
        const p = ports.shift();
        this.server.once("error", e => (ports.length ? tryPort(ports) : reject(e)));
        this.server.listen(p, "0.0.0.0", () => { this.server.removeAllListeners("error"); resolve(); });
      };
      tryPort([47110, 47111, 47112, 0]);
    });
    this.port = this.server.address().port;
    return this.info();
  }
  info() {
    const addrs = lanAddresses();
    return { port: this.port, urls: addrs.map(a => `http://${a.address}:${this.port}/u/${this.token}`), addrs, batch: this.batch, received: this.received.length };
  }
  stop() { if (this.server) { this.server.close(); this.server.closeAllConnections?.(); } this.server = null; this.token = null; }

  async handle(req, res) {
    const url = new URL(req.url, "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "u" || !this.token || !safeEq(parts[1] || "", this.token)) return send(res, 403, "Dieser Link ist abgelaufen. Bitte am PC „Belege vom Handy“ öffnen und den QR-Code neu scannen.");
    if (req.method === "GET" && parts.length === 2) {
      const html = fs.readFileSync(path.join(__dirname, "upload.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && parts[2] === "status") {
      const list = this.received.map(r => ({ name: r.name, ...this.statusFor(r.id) }));
      return send(res, 200, JSON.stringify(list), "application/json");
    }
    if (req.method === "POST" && parts[2] === "upload") {
      const name = decodeURIComponent(url.searchParams.get("name") || "foto.jpg").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BYTES) return send(res, 413, "Datei zu groß"); chunks.push(c); }
      if (!size) return send(res, 400, "Leere Datei");
      const id = this.onFile(Buffer.concat(chunks), name, this.batch);
      this.received.push({ id, name });
      return send(res, 200, JSON.stringify({ ok: true, nr: this.received.length }), "application/json");
    }
    send(res, 404, "Nicht gefunden");
  }
}
function safeEq(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

module.exports = { HandyServer, lanAddresses };
