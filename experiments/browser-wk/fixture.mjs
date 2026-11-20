import http from "node:http";

export async function startFixture({ script = "" } = {}) {
  const page = cookie => [
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>WK browser spike</title>',
    '<style>body{font:16px system-ui;margin:0}main{padding:12px}button,input{font:inherit}',
    '#interaction{height:78px;display:flex;gap:20px;align-items:center}',
    '#react-value{font-size:40px;font-variant-numeric:tabular-nums}',
    '#activity{margin-top:60px}iframe{height:200px}</style>',
    '<body data-cookie="' + cookie.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;") + '">',
    '<div id="root"></div><script src="/fixture.js"></script></body></html>',
  ].join("");
  let ticks = 0;
  const server = http.createServer((request, response) => {
    const port = server.address().port;
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" }).end(script);
      return;
    }
    if (url.pathname === "/tick") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ tick: ++ticks }));
      return;
    }
    if (!["/", "/seed", "/who"].includes(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === "/seed") {
      const value = url.searchParams.get("value");
      if (!["alpha", "beta"].includes(value)) {
        response.writeHead(400).end();
        return;
      }
      response.setHeader("Set-Cookie", "session=" + value + "; HttpOnly; Path=/; SameSite=Lax");
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page(request.headers.cookie ?? ""));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: server.address().port };
}
