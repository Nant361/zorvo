import { lstat, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const modes = ["zorvo", "usage-strings", "camera-only", "microphone-only"];
export const appName = "Zorvo Browser Spike.app";
export const preparedRoot = path.join(os.homedir(), "Library", "Application Support", "Zorvo Browser Spike");
export const launchServices = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export function parseArguments(args) {
  const options = { mode: "zorvo", prepare: false, reuse: null, clean: null, direct: false, longHidden: false, requestPermissions: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error("Duplicate option: " + flag);
    seen.add(flag);
    if (["--reuse", "--clean"].includes(flag)) {
      const directory = args[++index];
      if (!directory || directory.startsWith("--")) throw new Error("A snapshot directory is required.");
      options[flag.slice(2)] = path.resolve(directory);
    } else if (flag === "--prepare") options.prepare = true;
    else if (flag === "--direct") options.direct = true;
    else if (flag === "--long-hidden") options.longHidden = true;
    else if (flag === "--request-permissions") options.requestPermissions = true;
    else if (modes.slice(1).map(mode => "--" + mode).includes(flag)) {
      if (options.mode !== "zorvo") throw new Error("Choose one usage-declaration mode.");
      options.mode = flag.slice(2);
    } else throw new Error("Unknown option: " + flag);
  }
  if ((options.clean && args.length !== 2) ||
    (options.reuse && (options.prepare || options.mode !== "zorvo")) ||
    (options.prepare && (options.direct || options.longHidden || options.requestPermissions)) ||
    (options.requestPermissions && (!options.reuse || options.direct || options.longHidden))) {
    throw new Error("Incompatible snapshot options.");
  }
  return options;
}

export async function removePreparedSnapshot(directory, { unregister, isRunning, root = preparedRoot }) {
  // A cleanup request can delete only one real snapshot directly below our own root.
  const location = path.resolve(directory);
  if ((await lstat(location)).isSymbolicLink()) throw new Error("Refusing a symlink snapshot.");
  const resolved = await realpath(location);
  const rootPath = await realpath(root);
  const name = path.basename(resolved);
  if (path.dirname(resolved) !== rootPath || !/^zorvo-browser-wk-[A-Za-z0-9_-]{6,}$/.test(name)) {
    throw new Error("Refusing a directory outside the prepared snapshot root.");
  }
  for (const relative of ["build.json", appName, path.join(appName, "Contents"), path.join(appName, "Contents", "MacOS"), path.join(appName, "Contents", "MacOS", "probe")]) {
    if ((await lstat(path.join(resolved, relative))).isSymbolicLink()) throw new Error("Refusing linked snapshot contents.");
  }
  const manifest = JSON.parse(await readFile(path.join(resolved, "build.json"), "utf8"));
  const identifier = "xyz.zorvo.browser-spike." + manifest.mode + "." + name;
  if (!modes.includes(manifest.mode) || manifest.identifier !== identifier || !/^[a-f0-9]{64}$/.test(manifest.binarySha256 ?? "")) {
    throw new Error("Refusing a directory without a valid browser-spike manifest.");
  }
  if (await isRunning(resolved)) throw new Error("The snapshot's native probe is still running.");
  await unregister(path.join(resolved, appName));
  await rm(resolved, { recursive: true });
  return { identifier, removed: true };
}
