# Renderer workload during scripted scroll

This standalone fixture renders Zorvo's `ChatCanvas` with its full stylesheet
and folds local `agent_message_chunk` updates through `applyAcpUpdate` every
50 ms. It uses no agent process or model requests.

Each run has four 20-second rounds. OpenCode and the restricted configurations
run idle, streaming, streaming, idle. The default WK configuration reverses
that order. The page contains 480 rows and moves its scroll position at
1,200 CSS pixels per second using `requestAnimationFrame`. The CSS viewport is
240 by 340 pixels. The report records its actual client width because native
scrollbars consume different widths in Chromium and WebKit.

## Run the fixture

From the repository root, start the temporary loopback server.

```sh
node experiments/browser-wk/scroll/serve.mjs
```

The command builds an optimized bundle in an OS temporary directory and prints
a unique URL for each configuration. It also records source and compiled-asset
hashes in `manifest.json`. Open the `opencode` URL in OpenCode's existing
browser pane and press **Start measurement**.

Build the native host in a temporary directory.

```sh
scroll_root="$(mktemp -d -t zorvo-scroll-host)"
mkdir -p "$scroll_root/ScrollHost.app/Contents/MacOS"
cp experiments/browser-wk/Info.plist "$scroll_root/ScrollHost.app/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string xyz.zorvo.scroll-spike "$scroll_root/ScrollHost.app/Contents/Info.plist"
xcrun swiftc -swift-version 5 -parse-as-library -warnings-as-errors \
  experiments/browser-wk/scroll/ScrollHost.swift \
  -o "$scroll_root/ScrollHost.app/Contents/MacOS/probe" -framework AppKit -framework WebKit
codesign --force --sign - "$scroll_root/ScrollHost.app"
open -n "$scroll_root/ScrollHost.app" --args '<wk URL>'
```

Use each printed URL with its matching configuration.

| URL label | Native host flags | Chat layout |
| --- | --- | --- |
| `opencode` | Open in OpenCode | ChatCanvas and document in the browser page |
| `wk` | No flags | ChatCanvas and document in one default WK view |
| `restricted` | `--restricted` | ChatCanvas and document in one restricted WK view |
| `wk-split` | `--restricted --split` | Restricted document beside a separate default WK chat view |

Press **Start measurement** and keep the selected app in front until it says
**Measurements saved**. Run configurations sequentially on the same display.
Close each test window afterward. The native host accepts only its loopback
origin. The separate-view bridge checks the requesting view, main frame,
origin and operation and accepts only begin/end workload commands.

The per-view restriction requires macOS 13 or newer. This test does not change
the system Lockdown Mode setting. Applying that restriction to the document
and chat together also changes the chat's JavaScript execution. The separate
layout models the intended separation between Zorvo's UI and browser page.

Once the selected runs finish, validate and summarize them.

```sh
node experiments/browser-wk/scroll/summarize.mjs '<results directory>' opencode wk wk-split
```

The summary records the summary source commit and its hashes as evidence,
not a pin against later checkout edits. CI validates the saved structure and
calculations without requiring a new recording after a script edit.
The summary includes raw-file hashes, per-round frame-interval counts, the median,
nearest-rank p95/p99 values, counts above 33.34 ms, and counts and percentages
above 1.5 times each round's own median. It rejects hidden, interrupted or
incomplete runs, missing scrolling, incorrect layout labels and streaming
rounds without enough chunks or rendered reply text. Preserve the result
directory for full ordered frame samples. Stop the server with Ctrl+C when
finished. Its listener and connections close on SIGINT/SIGTERM.

## Measurement scope

These numbers measure scripted scrolling and renderer scheduling. The chat
workload is local and the host is standalone. Physical trackpad latency,
momentum, menu/resize behavior, the full ACP process and full-app CPU/RAM need
integrated tests. The OpenCode run shares its page with the synthetic chat,
while the split WK run uses sibling native views. This comparison describes
those configurations and does not establish engine parity.

The recorded runs use macOS 27.0.1, arm64, and OpenCode 2.3.2. Their source and
bundle hashes are included in the committed results. Earlier exploratory runs
with incomplete CSS or interrupted native wheel input are excluded.

The [recorded summary](../results/2026-11-20-scroll.json) includes all twelve
rounds with their full frame-interval distributions.

| Configuration | RAF rate | Median interval | Idle / streaming p95 | Intervals >1.5× median, rounds 1–4 | Total / samples |
| --- | --- | --- | --- | --- | --- |
| OpenCode 2.3.2 | about 120/s | 8.3 ms | 9.2–9.3 / 9.2–9.3 ms | 0, 1, 0, 4 | 5 / 9,596 (0.052%) |
| Default WK view | about 60/s | 17 ms | 19 / 19 ms | 3, 0, 2, 1 | 6 / 4,796 (0.125%) |
| Restricted page with separate chat | about 60/s | 17 ms | 18 / 18 ms | 0, 1, 5, 0 | 6 / 4,796 (0.125%) |

The p95 intervals mainly show different callback scheduling rates, not the
amount of work per frame or a browser running twice as slowly. All three
hosts have few long intervals relative to their own median. These counts
are delayed callbacks, not a precise number of missed display refreshes.
WebKit's default script animation ran near 60 frames/s on this 120 Hz
display; raising that default has no known public API. Native scrolling is
a separate path and remains unmeasured.

The split run used the earlier per-view Lockdown configuration. It is
historical renderer evidence, not a benchmark of the now selected capture
policy. That policy uses ordinary JavaScript settings and disables only
screen capture before view creation.

Each round moved 24,000 CSS pixels. Every streaming round rendered reply text.
The difference in chunk counts reflects timer scheduling in these hosts.
