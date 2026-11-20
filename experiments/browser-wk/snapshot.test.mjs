import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile, access, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appName, parseArguments, removePreparedSnapshot } from "./snapshot.mjs";

test("direct and long-hidden runs can reuse one prepared signed binary", () => {
  const options = parseArguments(["--reuse", "/tmp/example", "--direct", "--long-hidden"]);
  assert.equal(options.reuse, "/tmp/example");
  assert.equal(options.direct, true);
  assert.equal(options.longHidden, true);
  assert.equal(parseArguments(["--prepare", "--usage-strings"]).mode, "usage-strings");
  assert.equal(parseArguments(["--clean", "/tmp/example"]).clean, "/tmp/example");
});

test("ambiguous cleanup, permission setup and mode combinations fail", () => {
  for (const args of [["--clean"], ["--reuse"], ["--clean", "/tmp/example", "--direct"],
    ["--prepare", "--direct"], ["--request-permissions"], ["--reuse", "/tmp/example", "--request-permissions", "--direct"],
    ["--prepare", "--reuse", "/tmp/example"], ["--camera-only", "--microphone-only"], ["--direct", "--direct"], ["--unknown"]]) {
    assert.throws(() => parseArguments(args));
  }
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zorvo-clean-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "zorvo-browser-wk-abc123");
  await mkdir(path.join(directory, appName, "Contents", "MacOS"), { recursive: true });
  await writeFile(path.join(directory, appName, "Contents", "MacOS", "probe"), "fixture executable");
  const manifest = { mode: "zorvo", identifier: "xyz.zorvo.browser-spike.zorvo.zorvo-browser-wk-abc123", binarySha256: "a".repeat(64) };
  await writeFile(path.join(directory, "build.json"), JSON.stringify(manifest));
  return { root, directory, manifest };
}

test("prepared cleanup unregisters the exact app before deleting only that snapshot", async t => {
  const { root, directory } = await fixture(t);
  let calls = 0;
  const result = await removePreparedSnapshot(directory, {
    root, isRunning: async () => false,
    unregister: async app => { assert.equal(app, path.join(directory, appName)); await access(directory); calls++; },
  });
  assert.equal(calls, 1);
  assert.equal(result.removed, true);
  await assert.rejects(access(directory));
  await access(root);
});

test("a running snapshot or unregister error preserves every file", async t => {
  const { root, directory } = await fixture(t);
  for (const running of [true, false]) {
    await assert.rejects(removePreparedSnapshot(directory, {
      root, isRunning: async () => running,
      unregister: async () => { throw new Error("unregister failed"); },
    }), running ? /still running/ : /unregister failed/);
    assert.match(await readFile(path.join(directory, "build.json"), "utf8"), /xyz.zorvo/);
  }
});

test("outside roots, forged manifests and linked snapshots cannot be cleaned", async t => {
  const { root, directory, manifest } = await fixture(t);
  const options = { root, isRunning: async () => false, unregister: async () => { throw new Error("must not unregister"); } };
  await assert.rejects(removePreparedSnapshot(root, options), /outside/);
  const linked = path.join(root, "zorvo-browser-wk-link00");
  await symlink(directory, linked);
  await assert.rejects(removePreparedSnapshot(linked, options), /symlink/);
  await writeFile(path.join(directory, "build.json"), JSON.stringify({ ...manifest, identifier: "another.app" }));
  await assert.rejects(removePreparedSnapshot(directory, options), /valid browser-spike manifest/);
  await access(directory);
});
