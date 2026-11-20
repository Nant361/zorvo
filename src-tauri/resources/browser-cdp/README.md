# Chromium debug adapter

A separate, **inactive proposal** for job 3 from the browser engine note.
The maintainer has not decided to add this engine. This branch is based on
`main` independently of the WebKit panel PR: it contains the Chromium worker,
its Rust supervisor and focused tests only. It has no browser-panel UI, agent
tool registration, Tauri command registration or release resource-bundle entry.
The runtime status and installer are plain async Rust helpers, with filesystem
work in blocking tasks. Future IPC wrappers must be authenticated, asynchronous
and registered together with their approved integration.
An installed application cannot select this engine or install Lighthouse.

The worker opens an installed Chrome, Chromium or Brave in its own window and
private temporary profile. It does not inspect the in-app WebKit document or
share its cookies. Before any app-facing integration, the maintainer must decide
job 3 and approve its permissions, uploads, UI and packaging separately.

No CEF bundle or main-process entitlement is added. Regular CDP operations
use Chrome's inherited pipes (descriptors 3/4), with no debug TCP listener.
A future Rust caller must supply an explicit authorization callback bound to
its original authenticated request and current session grant. There is no
default authorizer. The supervisor checks it before allocating a worker and
again after taking that worker's lock; Zorvo's process wrapper owns the child
lifetime. Closing stdin or sending SIGTERM closes Chrome, rejects pending protocol commands and removes the temporary profile/captures.
The Rust supervisor creates the private worker directory and retains its lease.
After a deadline, invalid reply or forced termination, Rust removes that exact
directory itself, including profiles, traces and staged upload copies. Startup
and worker creation sweep only owned, recognizably named directories whose lease
is no longer held. Live leases, symlinked roots and unrelated paths are preserved.

## Protocol

Run `node main.mjs` with trusted environment. The parent supplies an existing
canonical, owner-only `zorvo-browser-debug-<32 hex digits>` directory; the worker
does not choose a location. The parent creates a dedicated
process group for the worker; on a hard timeout it signals that owned group,
so Chromium and audit descendants cannot outlive a force-killed worker.
Normal `shutdown`, EOF and SIGTERM perform graceful cleanup first:

`lighthouse-runner.mjs` loads the pinned CLI with inherited process groups,
overriding chrome-launcher's Unix detachment through the Node built-in spawn
boundary. Installed dependency files remain intact. Audit timeout/abort also
ends the recorded descendant tree before removing its temporary files.

- `ZORVO_BROWSER_ROOT`: the immutable canonical session workspace.
- `ZORVO_BROWSER_DIRECTORY`: exact private directory allocated by the supervisor.
- `ZORVO_BROWSER_CHROME`: optional installed executable; otherwise the adapter
  checks the usual Chrome, Brave and Chromium application paths.
- `ZORVO_LIGHTHOUSE_PATH`: installed pinned runtime's `lighthouse/cli/index.js`.

One JSON object per line:

```json
{"id":1,"sessionId":"session","args":{"engine":"chromium","operation":"tabs.open","url":"https://example.com/"}}
```

Replies echo the id and contain `result` or `error`. `catalog` returns all 45
initial operations and strict parameter schemas. The canonical parameter names
are `tabID`, `frameID`, `requestID`, `fileID`, `beforeID`, `afterID`, `objectID`;
the corresponding `Id` aliases are accepted. `tabs.open`, `tabs.list`,
`tabs.focus` and `tabs.close` include `tabs` and `activeTabId` state.

Tab refs are native DOM node identities scoped to the worker and cleared on
navigation. Internal element operations use an isolated content world. Explicit
`evaluate` runs in the page's world; its expression travels as protocol data
rather than being interpolated into an internal helper. Page console data and
network responses remain untrusted page output.

## File transfer

Browser access alone must not approve workspace uploads. No upload card or
agent-facing adapter is shipped in this proposal. Before exposing upload tools,
the future Rust integration must strip agent-supplied `approval`, call private
`upload.info` with `tabID`, `ref` and `paths`, and show the receiving origin and
canonical files on an inline Allow once card. Only that trusted adapter may
attach `approval:{url,paths}` to `files.upload`/`files.drop`. The worker reads the
receiving frame from native DOM metadata, rechecks the origin/files and stages bounded private copies. Changes
require a new permission. A consent token is never exposed as an agent tool.

Only canonical regular workspace files are read. Browser downloads are denied;
completed downloads never become captures and cannot be read through `files.get`.
Explicit screenshots and recordings remain available. Total staged bytes are capped
at 5 MiB per transfer, captures at 5 MiB each, 40 retained files per
session, 12 tabs, and 20 uploads. Network lists, headers, console and response
bodies have output limits; credential headers are omitted. Trace/CPU sampling
automatically stops after 30 seconds. Uncompressed recording data is capped at
36 MiB. The adapter denies capture, location, notifications and clipboard reads,
intercepts file choosers, and never attaches to an existing browser/profile.

## Lighthouse

The optional runtime's package and integrity lock live in `lighthouse-runtime/`.
Copy them into app data and run `npm ci --ignore-scripts` there. Lighthouse
13.6.0 requires Node 22.19 or newer; Zorvo's Node 26 satisfies that. Audits run
with the same installed browser in a fresh unauthenticated profile, so they do
not represent a logged-in tab's cookies or storage. The operation returns real
Lighthouse category scores and the retained report, or an explicit failure.
The Lighthouse CLI additionally starts its own short-lived Chrome through a
loopback-only DevTools port selected by chrome-launcher. This endpoint exists
only during an explicit audit and is closed with that audit's browser.

## Tests

```sh
node --test src-tauri/resources/browser-cdp/runtime.test.mjs
node src-tauri/resources/browser-cdp/smoke.mjs
ZORVO_LIGHTHOUSE_PATH='<runtime>/node_modules/lighthouse/cli/index.js' node src-tauri/resources/browser-cdp/smoke.mjs
```

The explicit smoke run starts a synthetic loopback server, a separate headless
Chrome profile and the actual worker; it tests navigation, accessibility refs,
inputs, dialogs, upload consent/drop, redacted network data, captures, trace,
CPU, heap and optionally the real Lighthouse CLI. Its small attachment response
checks actual download denial, absence from capture lists and rejection by
`files.get`. No model/API request is made.
