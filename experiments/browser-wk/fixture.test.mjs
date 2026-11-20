import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { startFixture } from "./fixture.mjs";

test("the loopback fixture serves only its declared hosts, methods and synthetic values", async context => {
  const { server, port } = await startFixture({ script: "globalThis.fixtureLoaded = true;" });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const address = "http://127.0.0.1:" + port;
  for (const host of ["127.0.0.1", "localhost"]) {
    const response = await fetch(address, { headers: { host: host + ":" + port } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /WK browser spike/);
  }
  const seeded = await fetch(address + "/seed?value=alpha");
  assert.match(seeded.headers.get("set-cookie"), /^session=alpha; HttpOnly;/);
  const observed = await fetch(address + "/who", { headers: { cookie: "session=alpha" } });
  assert.match(await observed.text(), /data-cookie="session=alpha"/);
  const script = await fetch(address + "/fixture.js");
  assert.equal(await script.text(), "globalThis.fixtureLoaded = true;");
  const firstTick = await fetch(address + "/tick");
  const nextTick = await fetch(address + "/tick");
  assert.deepEqual(await firstTick.json(), { tick: 1 });
  assert.deepEqual(await nextTick.json(), { tick: 2 });
  const invalid = await fetch(address + "/seed?value=other");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("set-cookie"), null);
  const missing = await fetch(address + "/unrelated");
  assert.equal(missing.status, 404);
  const post = await fetch(address, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  const forbidden = await new Promise((resolve, reject) => {
    http.get(address, { headers: { host: "different.example:" + port } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
  assert.equal(forbidden, 403);
});
