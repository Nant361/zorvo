import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { appName, launchServices, modes, parseArguments, preparedRoot, removePreparedSnapshot, unregisterApplication } from "./snapshot.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const options = { signal: controller.signal, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 };
const hash = content => createHash("sha256").update(content).digest("hex");
const sourceNames = ["Probe.swift", "HiddenProbe.swift", "Fixture.tsx", "fixture.mjs", "Info.plist", "run.mjs", "report.mjs", "snapshot.mjs"];

let fixture;
let outputDirectory;
let executable;
let launched = false;
let registered = false;
let keepRegistration = false;

async function recordedProcess(root = outputDirectory) {
  try {
    const pid = Number(await readFile(path.join(root, "probe.pid"), "utf8"));
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const command = await run("ps", ["-ww", "-p", String(pid), "-o", "args="], { timeout: 3000 });
    const expected = path.join(root, appName, "Contents", "MacOS", "probe");
    const commands = [expected, await realpath(expected)];
    return commands.some(value => command.stdout.trim().startsWith(value + " ")) ? pid : null;
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code) || error.code === 1) return null;
    throw error;
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("This spike requires macOS and Xcode.");
  const cli = parseArguments(process.argv.slice(2));
  const { prepare, requestPermissions, direct, longHidden } = cli;
  const reuse = cli.reuse !== null;
  if (cli.clean) {
    const result = await removePreparedSnapshot(cli.clean, {
      isRunning: async root => (await recordedProcess(root)) !== null,
      unregister: app => unregisterApplication(app, run),
    });
    console.log(JSON.stringify(result));
    return;
  }
  await run("git", ["diff", "--quiet", "HEAD", "--", "run.mjs", "snapshot.mjs"], { ...options, cwd: directory });
  const { stdout: collectorCommit } = await run("git", ["rev-parse", "HEAD"], { ...options, cwd: directory });
  const collectorSources = Object.fromEntries(await Promise.all(["run.mjs", "snapshot.mjs"].map(async name => [
    name, hash(await readFile(path.join(directory, name))),
  ])));
  if (prepare) await mkdir(preparedRoot, { recursive: true });
  outputDirectory = reuse ? cli.reuse
    : await mkdtemp(path.join(prepare ? preparedRoot : os.tmpdir(), "zorvo-browser-wk-"));
  const app = path.join(outputDirectory, appName);
  const bin = path.join(app, "Contents", "MacOS");
  const bundleInfo = path.join(app, "Contents", "Info.plist");
  const manifestPath = path.join(outputDirectory, "build.json");
  executable = path.join(bin, "probe");
  let manifest;

  if (reuse) {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!modes.includes(manifest.mode) || manifest.arch !== process.arch || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "")) throw new Error("Invalid snapshot mode or architecture.");
    for (const name of sourceNames) {
      const expected = manifest.sources[name];
      if (hash(await readFile(path.join(outputDirectory, name))) !== expected) {
        throw new Error("Snapshot source is stale or modified: " + name);
      }
    }
    if (hash(await readFile(executable)) !== manifest.binarySha256 ||
      hash(await readFile(bundleInfo)) !== manifest.bundleInfoSha256 ||
      hash(await readFile(path.join(outputDirectory, "fixture.bundle.js"))) !== manifest.sources["fixture.bundle.js"]) {
      throw new Error("The prepared binary, plist or fixture bundle was modified.");
    }
    await run("codesign", ["--verify", "--strict", app], options);
  } else {
    const mode = cli.mode;
    const { stdout: commit } = await run("git", ["rev-parse", "HEAD"], { ...options, cwd: directory });
    try {
      await run("git", ["ls-files", "--error-unmatch", ...sourceNames], { ...options, cwd: directory });
      await run("git", ["diff", "--quiet", "HEAD", "--", ...sourceNames], { ...options, cwd: directory });
    } catch { throw new Error("Commit the probe sources before collecting evidence."); }
    await mkdir(bin, { recursive: true });
    const sources = {};
    for (const name of sourceNames) {
      const content = await readFile(path.join(directory, name));
      await writeFile(path.join(outputDirectory, name), content);
      sources[name] = hash(content);
    }
    const built = await build({
      configFile: false, logLevel: "warn",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [react()],
      resolve: { alias: ["react", "react/jsx-runtime", "react-dom/client"].map(name => ({
        find: new RegExp("^" + name + "$"), replacement: fileURLToPath(import.meta.resolve(name)),
      })) },
      build: {
        write: false, target: "safari15", reportCompressedSize: false,
        lib: { entry: path.join(outputDirectory, "Fixture.tsx"), name: "ZorvoFixture", formats: ["iife"] },
      },
    });
    const outputs = (Array.isArray(built) ? built : [built]).flatMap(result => result.output);
    const entry = outputs.find(output => output.type === "chunk" && output.isEntry);
    if (!entry) throw new Error("The React fixture build produced no entry script.");
    await writeFile(path.join(outputDirectory, "fixture.bundle.js"), entry.code);
    sources["fixture.bundle.js"] = hash(entry.code);

    await copyFile(path.join(outputDirectory, "Info.plist"), bundleInfo);
    const identifier = "xyz.zorvo.browser-spike." + mode + "." + path.basename(outputDirectory);
    await run("plutil", ["-replace", "CFBundleIdentifier", "-string", identifier, bundleInfo], options);
    await run("plutil", ["-insert", "CFBundleDisplayName", "-string", "Zorvo Browser Spike (" + mode + ")", bundleInfo], options);
    const usageStrings = [];
    if (["usage-strings", "camera-only"].includes(mode)) usageStrings.push("NSCameraUsageDescription");
    if (["usage-strings", "microphone-only"].includes(mode)) usageStrings.push("NSMicrophoneUsageDescription");
    for (const key of usageStrings) {
      await run("plutil", ["-insert", key, "-string", "This test verifies that device capture is denied.", bundleInfo], options);
    }
    const target = process.arch === "arm64" ? "arm64-apple-macosx12.0" : "x86_64-apple-macosx12.0";
    await run("xcrun", [
      "swiftc", "-target", target, "-swift-version", "5", "-parse-as-library", "-warnings-as-errors",
      path.join(outputDirectory, "Probe.swift"), path.join(outputDirectory, "HiddenProbe.swift"),
      "-o", executable, "-framework", "AppKit", "-framework", "WebKit", "-framework", "AVFoundation",
    ], options);
    await run("codesign", ["--force", "--sign", "-", app], options);
    manifest = {
      mode, identifier, sourceCommit: commit.trim(), arch: process.arch, target, sources, usageStrings,
      binarySha256: hash(await readFile(executable)), bundleInfoSha256: hash(await readFile(bundleInfo)),
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  if (longHidden && manifest.mode !== "zorvo") throw new Error("Long hidden measurements require the ordinary mode.");
  registered = true;
  await run(launchServices, ["-f", app], options);

  if (prepare) {
    keepRegistration = true;
    console.log("Prepared app: " + app);
    console.log("Reuse snapshot: " + outputDirectory);
  } else {
    if (await recordedProcess()) throw new Error("This snapshot's native probe is already running.");
    await rm(path.join(outputDirectory, "probe.pid"), { force: true });
    if (requestPermissions) {
      const resultPath = path.join(outputDirectory, "permission-setup.json");
      console.log("Permission setup: " + resultPath);
      launched = true;
      await run("open", ["-W", "-n", "--env", "ZORVO_BROWSER_SPIKE_REQUEST_PERMISSIONS=1", app,
        "--args", "1", resultPath, manifest.mode], options);
      console.log(await readFile(resultPath, "utf8"));
    } else {
      const { startFixture } = await import(pathToFileURL(path.join(outputDirectory, "fixture.mjs")).href);
      const { assessReport } = await import(pathToFileURL(path.join(outputDirectory, "report.mjs")).href);
      fixture = await startFixture({ script: await readFile(path.join(outputDirectory, "fixture.bundle.js"), "utf8") });
      const resultPath = path.join(outputDirectory, direct ? "results-direct.json" : longHidden ? "results-long-hidden.json" : "results.json");
      // A reused app must not leave an earlier result looking like a new collection.
      await rm(resultPath, { force: true });
      console.log("Results: " + resultPath);
      console.log("Mode: " + manifest.mode + ". Permission and background-React measurements run automatically.");
      launched = true;
      const environment = {
        ZORVO_BROWSER_SPIKE_LAUNCH: direct ? "direct" : "launchservices",
        ZORVO_BROWSER_SPIKE_LONG_HIDDEN: longHidden ? "1" : "0",
        ZORVO_BROWSER_SPIKE_REQUEST_PERMISSIONS: "0",
      };
      const runtimeOptions = { ...options, timeout: longHidden ? 540_000 : 180_000 };
      const child = direct
        ? await run(executable, [String(fixture.port), resultPath, manifest.mode],
          { ...runtimeOptions, env: { ...process.env, ...environment } })
        : await run("open", ["-W", "-n", ...Object.entries(environment).flatMap(([key, value]) => ["--env", key + "=" + value]),
          "--stdout", path.join(outputDirectory, "stdout.log"), "--stderr", path.join(outputDirectory, "stderr.log"), app,
          "--args", String(fixture.port), resultPath, manifest.mode], runtimeOptions);
      if (child.stdout) process.stdout.write(child.stdout);
      if (child.stderr) process.stderr.write(child.stderr);
      const report = JSON.parse(await readFile(resultPath, "utf8"));
      report.assessment = assessReport(report, manifest.mode);
      report.harness = {
        collectedAt: new Date().toISOString(), node: process.version, ...manifest,
        collectorCommit: collectorCommit.trim(), collectorSources,
        buildManifestSha256: hash(await readFile(manifestPath)),
        reusedBinary: reuse, launch: direct ? "Direct child of Node runner" : "LaunchServices via open -W -n",
      };
      await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
      console.log("Assessment: " + report.assessment.status);
      if (report.assessment.status !== "pass") process.exitCode = 2;
    }
  }
}

try {
  await main();
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (launched) {
    try {
      const pid = await recordedProcess();
      if (pid) process.kill(pid, "SIGTERM");
    } catch (error) { console.error("Test process cleanup failed. " + error.message); }
  }
  if (registered && !keepRegistration) {
    try { await unregisterApplication(path.join(outputDirectory, appName), run); }
    catch (error) { console.error("LaunchServices cleanup failed. " + error.message); process.exitCode = 1; }
  }
  if (fixture) {
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
  }
}
