import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(os.tmpdir(), "zorvo-scroll-"));
const outDir = path.join(scratch, "public");
await build({ root, configFile: false, plugins: [react(), tailwind()], build: { outDir, target: "safari15", reportCompressedSize: false } });
const sessions = new Map(["opencode", "wk", "restricted", "wk-split"].map(name => [randomUUID(), name]));
const hashes = {};
for (const name of ["ScrollHost.swift", "scroll.tsx", "style.css", "index.html", "serve.mjs"]) {
  hashes[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
const assets = {};
for (const name of await readdir(path.join(outDir, "assets"))) {
  assets[name] = createHash("sha256").update(await readFile(path.join(outDir, "assets", name))).digest("hex");
}
await writeFile(path.join(scratch, "manifest.json"), JSON.stringify({
  collectedAt: new Date().toISOString(), architecture: process.arch, node: process.version,
  sources: hashes, assets,
}, null, 2) + "\n");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const host = "127.0.0.1:" + server.address().port;
    if (req.headers.host !== host) { res.writeHead(403).end(); return; }
    if (req.method === "POST") {
      const session = sessions.get(url.pathname.slice("/result/".length));
      if (!url.pathname.startsWith("/result/") || !session || req.headers.origin !== "http://" + host || req.headers["content-type"] !== "application/json") { res.writeHead(403).end(); return; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 500_000) { res.writeHead(413).end(); return; } }
      const data = JSON.parse(body);
      if (!Array.isArray(data) || data.length !== 4) { res.writeHead(400).end(); return; }
      await writeFile(path.join(scratch, session + ".json"), JSON.stringify(data), { flag: "wx" });
      res.writeHead(201).end(); return;
    }
    const file = path.resolve(outDir, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (req.method !== "GET" || !file.startsWith(outDir + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch { res.writeHead(400).end(); }
});
server.listen(0, "127.0.0.1", () => {
  console.log("RESULTS", scratch);
  for (const [id, name] of sessions) console.log(name, `http://127.0.0.1:${server.address().port}/?run=${id}${name === "wk" ? "&order=reverse" : ""}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
