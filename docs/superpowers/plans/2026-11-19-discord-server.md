# Zorvolabs Discord server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Zorvolabs Discord server described in the spec through the `zorvolabs` bot, and add the workflow that posts published releases to `#activity`.

**Architecture:** Small Node scripts outside the repository, in `~/.claude/channels/discord/setup/`, call the Discord REST API with the bot token. Every area has a `check` (reads the server and lists every difference from the spec) and an idempotent `apply` (finds things by name, creates what is missing, patches what differs). Each task runs check (fails), apply, check (passes). The one repository change, `.github/workflows/discord-release.yml` with its test, goes on a branch and a pull request.

**Tech Stack:** Node 26 (`fetch`, ES modules, no dependencies), Discord API v10, `gh`, `jq`, Vitest, `actionlint`.

**Spec:** `docs/superpowers/specs/2026-11-19-discord-server-design.md`

## Global Constraints

- Guild `1572906859394760804`; repository `zakyirsyaad/zorvo`; maintainer's Discord user `933427452439564330`.
- The bot token is read from `~/.claude/channels/discord/.env` (`DISCORD_BOT_TOKEN=`). It is never printed, logged, passed on a command line or written anywhere else.
- Webhook URLs are secrets: never printed; they reach `gh` only through stdin.
- Names, tags, rules, guidelines and the `#welcome` text are copied verbatim from the spec. Public copy is English, has no em dash, and every list item is sentence case.
- Nothing is deleted except the two empty default categories (Text Channels, Voice Channels). `#general` and voice General are moved and renamed.
- Every `apply` is idempotent: running it twice makes no second channel, role, rule, webhook or message.
- Steps marked (maintainer) are done by the maintainer; the executor stops there, says exactly what to click, and waits.

## Review Focus

1. A second `apply` run after a partial failure (a 429, a network error halfway through channels): expected no duplicates and the remaining items created. Owning test: Task 3 step "run apply twice".
2. Discord rate limits (HTTP 429 with `retry_after`): expected a wait and retry, never a crash that leaves half a category. Owning test: Task 1 `api.test.mjs` 429 case.
3. An API error body that echoes the request (Discord includes field errors): expected the error message to never contain the token or a webhook URL. Owning test: Task 1 `api.test.mjs` redaction case.
4. The `#welcome` message over Discord's 2,000-character limit: expected the check to catch it before posting. Owning test: Task 5 length assertion.
5. A draft or prerelease reaching `#activity`: expected nothing posted. Owning test: Task 8 workflow test.

---

## File Structure

Outside the repository, `~/.claude/channels/discord/setup/` (`$SETUP` below):

| File | Responsibility |
|---|---|
| `lib/api.mjs` | `discord(method, path, body?)`: token, base URL, 429 retry, errors without secrets |
| `lib/spec.mjs` | Every value the spec pins, as data: names, permission bits, tags, guidelines, rules, welcome text, AutoMod rules |
| `lib/find.mjs` | `snapshot()` reads guild, channels, roles; `byName(list, name, type?)` |
| `check.mjs` | `node check.mjs <area>` prints one line per difference, exits 1 if any |
| `apply.mjs` | `node apply.mjs <area>` makes the server match the spec for that area |
| `areas/<area>.mjs` | One module per area exporting `check(snap)` and `apply(snap)` |
| `test/*.test.mjs` | `node --test` tests for `lib/` |

Areas: `settings`, `roles`, `channels`, `community`, `content`, `automod`, `feed`, `invite`, `hardening`.

In the repository, on branch `chore/discord-release-feed`:

| File | Responsibility |
|---|---|
| `.github/workflows/discord-release.yml` | Post a published, non-prerelease release to Discord |
| `scripts/discord-release-workflow.test.mjs` | Pin the workflow's trigger, permissions and secret |
| `docs/superpowers/specs/2026-11-19-discord-server-design.md` | The spec (already written) |
| `docs/superpowers/plans/2026-11-19-discord-server.md` | This plan |

---

### Task 1: API client and snapshot

**Files:**
- Create: `$SETUP/lib/api.mjs`, `$SETUP/lib/find.mjs`, `$SETUP/check.mjs`, `$SETUP/apply.mjs`
- Test: `$SETUP/test/api.test.mjs`

**Interfaces:**
- Produces: `discord(method: string, path: string, body?: object, opts?: { reason?: string }) => Promise<any>` (sends `X-Audit-Log-Reason: Zorvolabs setup` by default); `GUILD_ID: string`; `class DiscordError extends Error { status: number }`; `snapshot() => Promise<{ guild, channels, roles }>`; `byName(list, name, type?) => object | undefined`; `check.mjs` and `apply.mjs` load `./areas/${area}.mjs` and call its `check(snap)` (returns `string[]`) or `apply(snap)`.

- [ ] **Step 1: Write the failing tests** in `test/api.test.mjs` with `node:test`, a stubbed global `fetch` and a temporary `.env` path passed through `DISCORD_ENV_FILE`:
  - `retries once after a 429 using retry_after`: first response 429 `{retry_after: 0.01}`, second 200 `{ok:true}`; result `{ok:true}`, fetch called twice.
  - `throws DiscordError with status and Discord message`: 403 `{message:"Missing Permissions", code:50013}`; error `.status === 403`, message contains `Missing Permissions`.
  - `never puts the token or a webhook URL in an error`: 400 whose body contains the token and `https://discord.com/api/webhooks/1/abc`; `String(error)` contains neither and contains `[redacted]`.
  - `sends Bot authorization`: header `Authorization` equals `Bot <token from file>`.
- [ ] **Step 2: Run** `node --test $SETUP/test/` and expect FAIL (module not found).
- [ ] **Step 3: Implement `lib/api.mjs`**: base `https://discord.com/api/v10`; token read once from `DISCORD_ENV_FILE` or `~/.claude/channels/discord/.env`; at most 3 retries on 429; redact the token and any `discord.com/api/webhooks/...` match in error text. Implement `lib/find.mjs` (`GET /guilds/{id}?with_counts=true`, `/guilds/{id}/channels`, `/guilds/{id}/roles`), and the two entry scripts.
- [ ] **Step 4: Run** `node --test $SETUP/test/` and expect PASS. Then `node -e "import('$SETUP/lib/find.mjs').then(m=>m.snapshot()).then(s=>console.log(s.guild.name, s.channels.length, s.roles.length))"` prints `Zorvolabs 4 3`.

### Task 2: Guild settings and roles

**Files:** Create `$SETUP/lib/spec.mjs` (settings and roles part), `$SETUP/areas/settings.mjs`, `$SETUP/areas/roles.mjs`

**Interfaces:**
- Produces in `lib/spec.mjs`: `P` (permission bits as BigInt: `ADD_REACTIONS 1n<<6n`, `VIEW_AUDIT_LOG 1n<<7n`, `KICK_MEMBERS 1n<<1n`, `VIEW_CHANNEL 1n<<10n`, `SEND_MESSAGES 1n<<11n`, `MANAGE_MESSAGES 1n<<13n`, `EMBED_LINKS 1n<<14n`, `ATTACH_FILES 1n<<15n`, `READ_MESSAGE_HISTORY 1n<<16n`, `MENTION_EVERYONE 1n<<17n`, `CONNECT 1n<<20n`, `SPEAK 1n<<21n`, `USE_VAD 1n<<25n`, `CHANGE_NICKNAME 1n<<26n`, `USE_APPLICATION_COMMANDS 1n<<31n`, `MANAGE_THREADS 1n<<34n`, `CREATE_PUBLIC_THREADS 1n<<35n`, `SEND_MESSAGES_IN_THREADS 1n<<38n`, `MODERATE_MEMBERS 1n<<40n`, `ADMINISTRATOR 1n<<3n`); `EVERYONE_PERMS` (the spec's server-wide list plus `CHANGE_NICKNAME` and `USE_APPLICATION_COMMANDS`); `ROLES`, in this order top to bottom: `founder: { name: "Founder", color: 0xD97706, hoist: true, perms: 0n }`, `team: { name: "Team", color: 0x3B82F6, hoist: true, perms }`, `contributor: { name: "Contributor", color: 0x16A34A, hoist: true, perms: 0n }` (Tailwind amber-600, blue-500, green-600); `SETTINGS = { verification_level: 2, explicit_content_filter: 2, default_message_notifications: 1 }`; `MAINTAINER_ID`.

- [ ] **Step 1:** Run `node $SETUP/check.mjs settings` and `node $SETUP/check.mjs roles`; expect FAIL listing verification 0, missing Founder, Team and Contributor, `@everyone` permissions differ, maintainer lacks Founder and Team.
- [ ] **Step 2:** Implement both areas. `settings.apply` patches `/guilds/{id}`; `roles.apply` creates or patches the three roles with their name, colour, hoist and permissions, orders them Founder above Team above Contributor with `PATCH /guilds/{id}/roles` (positions, all below the two bot roles), sets `@everyone` permissions to `EVERYONE_PERMS`, and gives the maintainer Founder and Team with `PUT /guilds/{id}/members/{MAINTAINER_ID}/roles/{roleId}`. `roles.check` also fails when the order is wrong or Founder has any permission bit.
- [ ] **Step 3:** Run both applies, then both checks; expect no output, exit 0.

### Task 3: Categories, channels and permissions

**Files:** Extend `$SETUP/lib/spec.mjs` with `CATEGORIES`; create `$SETUP/areas/channels.mjs`

**Interfaces:**
- Produces: `CATEGORIES`: ordered list of `{ name, overwrites: (ids) => [{id, type: 0, allow, deny}], channels: [{ name, type }] }` for START HERE (`welcome`, `announcements`, `activity`, all type 0 for now), COMMUNITY (`general` 0, `Lounge` 2), TEAM (`team` 0, `mod-updates` 0). SUPPORT is created here empty; its forums come in Task 4 because forums need Community. Overwrites exactly as the spec's per-category table. Every channel has `permission_overwrites` equal to its category's (synced).

- [ ] **Step 1:** `node $SETUP/check.mjs channels`; expect FAIL listing every missing category and channel and the leftover default categories.
- [ ] **Step 2:** Implement `channels.apply`: create missing categories in order; move the existing `general` and voice `General` (renamed `Lounge`) by id, never by creating new ones; create missing channels with their category's overwrites; set positions; delete Text Channels and Voice Channels only when they hold no channels.
- [ ] **Step 3:** Run apply, then check; expect exit 0.
- [ ] **Step 4: Run apply twice.** Run `node $SETUP/apply.mjs channels` again, then `snapshot()` and assert each channel name appears exactly once and the ids of `general` and `Lounge` equal the ones Task 1 printed.

### Task 4: Community, announcements and forums

**Files:** Extend `$SETUP/lib/spec.mjs` with `COMMUNITY` and `FORUMS`; create `$SETUP/areas/community.mjs`

**Interfaces:**
- Produces: `COMMUNITY = { preferred_locale: "en-US", description: <spec text> }`; `FORUMS`: `help`, `bugs`, `ideas`, each `{ name, topic: <post guidelines verbatim>, tags: [{ name, moderated }] }` with the spec's tags.

- [ ] **Step 1:** `node $SETUP/check.mjs community`; expect FAIL: `COMMUNITY` feature missing, rules and updates channels unset, `announcements` is type 0, forums missing.
- [ ] **Step 2:** Implement `community.apply`: `PATCH /guilds/{id}` with `features` = existing features plus `COMMUNITY`, `rules_channel_id` = `welcome`, `public_updates_channel_id` = `mod-updates`, locale and description; then `PATCH` `announcements` to type 5; then create each forum (type 15) in SUPPORT with `topic`, `available_tags` and the SUPPORT overwrites, or patch its tags and topic when it exists.
- [ ] **Step 3:** Run apply, then check; expect exit 0. Also confirm with `snapshot()` that each forum has exactly the spec's tags, with `moderated` true only on the Team-only ones.

### Task 5: `#welcome`, Onboarding and rules screening

**Files:** Extend `$SETUP/lib/spec.mjs` with `RULES` (six strings) and `WELCOME` (the spec's `#welcome` text with the rules inserted as a numbered list and channel names written as `<#id>` mentions); create `$SETUP/areas/content.mjs`

**Interfaces:**
- Produces: `RULES: string[]`; `welcomeText(ids) => string`.

- [ ] **Step 1: Write the failing test** `test/spec.test.mjs`: `welcomeText(fakeIds).length <= 2000`; it contains no `—` or `–`; every rule in `RULES` appears in it; it contains `https://github.com/zakyirsyaad/zorvo/releases/latest`.
- [ ] **Step 2:** Run `node --test $SETUP/test/` and `node $SETUP/check.mjs content`; expect FAIL (no `welcomeText`, no pinned message, onboarding off).
- [ ] **Step 3:** Implement `content.apply`: post `welcomeText` in `#welcome` only when no bot message exists there (else edit it), pin it; `PUT /guilds/{id}/onboarding` with `enabled: true`, `mode: 0`, `prompts: []`, `default_channel_ids` = the spec's eight (if Discord refuses them as too few channels members can post in, stop and report the error: the spec sits exactly at the minimum and the fix is a design decision); then `PATCH /guilds/{id}/member-verification` with `enabled: true` and one `TERMS` field holding `RULES`.
- [ ] **Step 4:** Run tests, apply and check; expect PASS. If the member-verification call fails, the check prints that one line: (maintainer) Server Settings, Safety Setup, Rules screening, paste the six rules from `lib/spec.mjs`. Wait for the maintainer, then run the check again.

### Task 6: AutoMod

**Files:** Extend `$SETUP/lib/spec.mjs` with `AUTOMOD`; create `$SETUP/areas/automod.mjs`

**Interfaces:**
- Produces: `AUTOMOD`: four rules named `Spam`, `Mention spam`, `Secrets`, `Invites`. Spam: `trigger_type: 3`. Mention spam: `trigger_type: 5`, `mention_total_limit: 5`. Secrets: `trigger_type: 1`, `regex_patterns` = the spec's eight patterns, block action `custom_message` = the spec's sentence (under 150 characters), no exempt roles. Invites: `trigger_type: 1`, the spec's invite regex. Spam, Mention spam and Invites exempt Team. All `event_type: 1`, action `type: 1`, `enabled: true`.

- [ ] **Step 1: Write the failing test** in `test/spec.test.mjs`: every secret pattern compiles as a JS `RegExp`; each is under 260 characters; each matches one sample (`sk-ant-` + 30 letters, `ghp_` + 36 letters, `AKIA` + 16 capitals, and so on) and none matches the plain sentence `my api key is in the env`; the custom message is under 150 characters.
- [ ] **Step 2:** Run tests and `node $SETUP/check.mjs automod`; expect FAIL.
- [ ] **Step 3:** Implement `automod.apply`: list `/guilds/{id}/auto-moderation/rules`, create or patch each by name.
- [ ] **Step 4:** Run tests, apply and check; expect PASS.

### Task 7: `#activity` feed

**Files:** Create `$SETUP/areas/feed.mjs`

**Interfaces:**
- Consumes: the `activity` channel from Task 3.
- Produces: two webhooks on `#activity` named `GitHub` and `Releases`; a repository hook on `zakyirsyaad/zorvo` whose URL ends in `/github` with events exactly `["check_suite","issues","pull_request","pull_request_review"]`; repository secret `DISCORD_RELEASES_WEBHOOK`.

- [ ] **Step 1:** `node $SETUP/check.mjs feed`; expect FAIL listing both webhooks, the hook and the secret missing (secrets are checked by name through `gh secret list -R zakyirsyaad/zorvo --json name`; hooks through `gh api repos/zakyirsyaad/zorvo/hooks`, comparing only the events and whether the URL's channel webhook id matches, never printing the URL).
- [ ] **Step 2:** Implement `feed.apply`: create missing webhooks; for the hook, run `gh api repos/zakyirsyaad/zorvo/hooks --method POST --input -` with the JSON on stdin (`config.content_type: "json"`); for the secret, `gh secret set DISCORD_RELEASES_WEBHOOK -R zakyirsyaad/zorvo` with the URL on stdin. Spawn `gh` with `stdio: ["pipe", "ignore", "inherit"]`.
- [ ] **Step 3:** Run apply, then check; expect exit 0. No test issue is needed: GitHub's hook delivery list (`gh api repos/zakyirsyaad/zorvo/hooks/{id}/deliveries`) shows the `ping` delivered with status 204.

### Task 8: Release workflow (repository)

**Files:**
- Create: `.github/workflows/discord-release.yml`
- Test: `scripts/discord-release-workflow.test.mjs`

**Interfaces:**
- Consumes: secret `DISCORD_RELEASES_WEBHOOK` from Task 7.

- [ ] **Step 1:** `git switch -c chore/discord-release-feed` from an up-to-date `main`.
- [ ] **Step 2: Write the failing test** `scripts/discord-release-workflow.test.mjs`, reading the YAML as text like `release-workflow.test.mjs` does (comment lines stripped):
  - `runs only when a release is published`: `on:` holds `release:` with `types: [published]` and nothing else.
  - `skips prereleases`: the job's `if:` contains `!github.event.release.prerelease`.
  - `has no permissions`: top level `permissions: {}`.
  - `uses one secret, the webhook`: the set of `secrets.X` names equals `["DISCORD_RELEASES_WEBHOOK"]`.
  - `runs no project code`: the text contains none of `actions/checkout`, `pnpm`, `npm `, `node `.
  - `passes event text through the environment, never inline`: no `${{ github.event.release.` inside a `run:` block.
- [ ] **Step 3:** Run `pnpm vitest run scripts/discord-release-workflow.test.mjs`; expect FAIL (file missing).
- [ ] **Step 4: Write the workflow:** one job `post` on `ubuntu-latest`; the tag, name, URL and body come in through `env:`; one `run:` step builds the payload with `jq -n` (embed title `Zorvo $TAG`, `url` the release page, `description` the body cut to 1,500 characters plus `\n\n[Read the full notes]($URL)` when cut) and posts it with `curl --fail-with-body -H 'Content-Type: application/json' --data @- "$WEBHOOK"`.
- [ ] **Step 5:** Run the test (expect PASS) and `actionlint .github/workflows/discord-release.yml` (expect no output).
- [ ] **Step 6: Commit** with explicit paths:

```bash
git add .github/workflows/discord-release.yml scripts/discord-release-workflow.test.mjs docs/superpowers/specs/2026-11-19-discord-server-design.md docs/superpowers/plans/2026-11-19-discord-server.md
git commit -m "ci: post published releases to the Zorvolabs Discord"
```

- [ ] **Step 7:** Push and open the pull request. (maintainer) Review and merge.

### Task 9: Invite and verification

**Files:** Create `$SETUP/areas/invite.mjs`

- [ ] **Step 1:** `node $SETUP/check.mjs invite`; expect FAIL (no permanent invite to `#welcome`).
- [ ] **Step 2:** Implement `invite.apply`: reuse a `#welcome` invite with `max_age: 0` and `max_uses: 0`, else create one (`unique: false`); print `https://discord.gg/<code>` (invites are public).
- [ ] **Step 3:** Run apply, then run every check in order: `for a in settings roles channels community content automod feed invite; do node $SETUP/check.mjs $a || exit 1; done`; expect exit 0.
- [ ] **Step 4:** Compute `@everyone`'s effective permissions per channel from the snapshot (guild base, then category overwrites) and assert: `VIEW_CHANNEL` off on `team` and `mod-updates`; `SEND_MESSAGES` off on `welcome`, `announcements`, `activity`; on everywhere in COMMUNITY and SUPPORT.
- [ ] **Step 5:** Give the maintainer the invite link and the Secrets check to try by hand: post `sk-ant-` plus 30 letters in a `#help` thread from a non-Team account if one exists; AutoMod should block it.

### Task 10: Hardening

**Files:** Create `$SETUP/areas/hardening.mjs` (check only; there is nothing the bot can apply to itself)

- [ ] **Step 1:** Implement `hardening.check`: fail while the `zorvolabs` role has `ADMINISTRATOR` or any other bit; read `~/.claude/channels/discord/access.json` and fail while `dmPolicy` is not `allowlist`.
- [ ] **Step 2:** (maintainer) Server Settings, Roles, `zorvolabs`: turn every permission off. A bot cannot lower its own highest role, so this is not scripted.
- [ ] **Step 3:** (maintainer) Run `/discord:access policy allowlist` in the Claude Code chat.
- [ ] **Step 4:** (maintainer) Developer Portal, the bot, turn off Public Bot; Bot, Reset Token; save the new token from a terminal into `~/.claude/channels/discord/.env`, then `/reload-plugins`.
- [ ] **Step 5:** `node $SETUP/check.mjs hardening`; expect exit 0. After step 4 the scripts read the new token from the same file, so this check also proves the new token works.
