# Browser development

The native Browser inspector uses system WebKit. Chromium debug uses an installed
Chrome, Brave or Chromium in a separate temporary profile and window. It does not
inspect the same document as the WebKit panel. No CEF runtime, helper apps or new
main-process entitlements are bundled.

The user requested implementing the feature before the remaining engine gate
matrix is accepted. This feature is therefore submitted for review with those
limits stated. The engine note and PR #256 remain the record of accepted
direction and standalone observations; they do not certify older OS or Intel
runtime behavior of this integration.

## Entry points

- `src-tauri/src/browser/`: main-thread native views, per-session non-persistent
  stores, guarded capture policy, named script world, document-scoped refs and
  bounded operations. Every tab has its own configuration and shares only its
  session's data store. Navigation accepts HTTP(S), with credentials and external
  schemes refused. Script events are untrusted events; some sites ignore them.
- `browser_commands.rs`: authenticated pending agent calls, session browser
  grants, one-time file receipts and manual UI actions. The original request is
  read from the backend's pending table; agent-supplied approvals are discarded.
  The request and grant generation are checked again at engine dispatch.
- `browser_debug.rs` and `resources/browser-cdp/`: JSONL process supervision and
  the 45-operation Chromium adapter. A worker has its own process group. Close,
  cancellation deadlines and app exit end its owned processes. The optional
  Lighthouse installation has an exact version and npm integrity lockfile; only
  an explicit install click downloads it. Audits use a fresh profile and a
  temporary loopback endpoint; regular diagnostics use a CDP pipe.
- `useBrowser*` and `components/browser/`: normal Inspector tab, retained view
  placement, overlay hiding, address normalization, tools and permission dialogs.
  Navigation from UI never starts an ACP agent or a loopback HTTP server. Address
  search submits to Google. The compact toolbar shows navigation, the address,
  element selection and its menu. Tab management, engine choices and diagnostic
  views are available from that menu. The main Tauri CSP remains unchanged.

Site information reads the current native view's TLS properties and its session's
cookie store; cookie names and values never cross IPC. Clear is a manual action
bound to the displayed URL. It removes cookies applicable to the host on all
paths (including shared parent-domain cookies), and clears that origin's local
and session storage, IndexedDB, CacheStorage and service-worker registrations.
Blocked deletion reports a partial result. Shared HTTP network caches are left
alone because WebKit's grouped data records can include other hosts. Agent access
reflects the existing session grant; the information panel grants no permissions.

An overlapping browser menu captures one native PNG and decodes it before hiding
the view beneath the HTML panel. Closing the menu restores the retained native
view and releases that still image. No capture loop or per-scroll IPC is used.

The manual element picker uses the fixed named-world helper, with no messages on
hover or scroll. A trusted main-frame click returns bounded, quoted page context
to the composer without sending a message. Its native view, document token and
arm nonce are checked before accepting the selection. Cancellation is bound to
the requesting UI's ID, so a late cleanup cannot cancel a replacement picker.
Navigation, leaving the page and Escape cancel selection. Iframe selection is
not currently supported by this manual picker.

## Operation groups

Both engines support tabs/navigation, frames, wait, snapshot, find, evaluate,
screenshot, click, hover, drag, fill, forms, select, check, key, scroll, dialogs and
console. WebKit reads a bounded control snapshot and DOM text; it does not claim
to expose closed shadow roots or trusted native input. Chromium adds full request
inspection, approved workspace files, performance traces, CPU and heap operations,
and Lighthouse. `browser_guide` returns the operation names and parameter schemas.
Unsupported engine operations fail explicitly. Debug, Network, Console, Files
and Performance views opened from the browser menu show actual operation results.

Local HTML preview uses the existing artifact store and Review/Output flow.
The Chromium adapter also has a bounded workspace image/text/PDF preview. Downloads
and page device permissions are denied. Console and explicit evaluate output
remain page-controlled data.

## Checks

```sh
pnpm lint
pnpm vitest run src/test/browser.test.ts src/test/browser-panel.test.tsx src/test/browser-picker.test.tsx src/test/browser-agent-tools.test.tsx
node --test src-tauri/resources/browser-cdp/runtime.test.mjs
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

The explicit Chromium smoke command is documented in its README. It exercises
the real installed browser, all operation families and optionally pinned
Lighthouse against a synthetic loopback fixture; it uses no model API.

For a native integration smoke, run `node src-tauri/src/browser/smoke-fixture.mjs`,
then launch a debug binary with `ZORVO_BROWSER_SMOKE_URL` set to the printed
loopback URL and `ZORVO_BROWSER_SMOKE_OUTPUT` to a temporary JSON file. This opt-in
debug path closes its test sessions and exits. It covers native snapshots, form
events, hidden interaction, cross-origin frame access, session cookie isolation
and stale reference rejection. A successful synthetic smoke is not evidence of
trackpad parity with OpenCode, the full real-site matrix or older-OS behavior.
