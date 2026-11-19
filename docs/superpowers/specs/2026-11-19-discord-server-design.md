# Zorvolabs Discord server design

Date: 2026-11-19. Status: design approved in chat, written spec awaiting review.

## Goal

Turn the Zorvolabs Discord server (guild `1572906859394760804`) from Discord's default layout into one server with two parts:

- a public community for Zorvo users, in English;
- a private space for the team.

Success: a new member lands in a clear `#welcome`, can ask for help, report a bug or suggest an idea in a forum, and sees the repository's activity without anyone posting it by hand. Team channels stay invisible to the public.

## Starting point (read through the bot on 2026-11-19)

- 4 members, verification level none, Community off, no rules channel, no description.
- Channels: category Text Channels with `#general`, category Voice Channels with voice `General`.
- Roles: `@everyone`, `zorvolabs` (this Claude Code channel bot, Administrator), `Jockie Music (2)` (music bot, Administrator).
- The Zorvo repository `zakyirsyaad/zorvo` is public. Latest release v0.13.0.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Purpose | One server, public part and private team part | Chosen in chat |
| Size | Lean: 8 public channels, 2 team channels, add more when there is content for them | 4 members; empty channels make a server look dead |
| Public language | English only | Zorvo is open source and used outside Indonesia; the team channel may use Indonesian |
| Reports | Forums for help, bugs and ideas; valid bugs move to GitHub Issues | Discord threads with tags keep each report in one place |
| GitHub feed | One public channel, `#activity` | The repository is public; visible activity shows the project is alive |
| `zorvolabs` bot | Used only to set the server up, then loses Administrator | It is wired to a Claude Code session on the maintainer's Mac |
| Jockie Music | Stays, keeps Administrator | The maintainer's choice. Accepted risk: Administrator ignores channel denies, so Jockie can read the TEAM category |
| Team role holders | Only the maintainer (`933427452439564330`) for now | Chosen in chat |
| Founder role | A label for the maintainer only, no permissions | Shows new members who is behind Zorvo; permissions stay with Team |
| Member role | Given to every community member through one required Onboarding question; no permissions | Chosen in chat; members get an identity, and the answers show who the community is |
| Role colours | From the Tailwind palette (as shown on shadcn's colors page) | Chosen in chat; the brand itself has no accent colour |

## Channels

```
START HERE      everyone can read and react; only Team can write
  #welcome        rules channel: what Zorvo is, rules, links
  #announcements  announcement channel: news written by the team, followable by other servers
  #activity       GitHub feed: releases, pull requests, reviews, issues, check suites

COMMUNITY
  #general        the existing #general, moved here
  Lounge          voice, renamed from General

SUPPORT         forums, one thread per topic
  #help
  #bugs
  #ideas

TEAM            only the Team role can see it
  #team           team chat, Indonesian allowed
  #mod-updates    Community's required updates channel, plus moderation notes
```

The existing `#general` and voice `General` are moved and renamed, never deleted, so their history and IDs stay. The default categories Text Channels and Voice Channels are deleted once empty.

### Forums

`#help`
- Post guidelines: "Say which agent you use, your Zorvo version (Settings, About) and your macOS version. Never paste an API key or token."
- Tags, free for anyone: Setup, Agents, Sign-in, Private mode.
- Tags, Team only (moderated): Solved.

`#bugs`
- Post guidelines: "One bug per post. Include your Zorvo version, macOS version, the agent, the steps that cause it, what you expected and what happened. Screenshots help. Never paste an API key or token."
- Tags, Team only: Confirmed, Needs info, Fixed, Moved to GitHub.
- When a bug moves to GitHub, the team links the issue in the thread, applies Moved to GitHub and leaves the thread open, so the reporter can follow it from Discord.

`#ideas`
- Post guidelines: "One idea per post. Describe the problem you want solved, not only the feature."
- Tags, Team only: Under review, Planned, Not planned, Shipped.

Discord forums have no form templates; the post guidelines text is what a poster sees.

## Roles and permissions

Roles, top to bottom: `zorvolabs` (managed), `Jockie Music (2)` (managed), Founder, Team, Contributor, Member, `@everyone`.

| Role | Holders | Colour | Shown apart | Permissions |
|---|---|---|---|---|
| Founder | The maintainer only | amber-600 `#D97706` | Yes | None. The server owner already has every permission, and moderation comes from Team. A label, not a permission set. |
| Team | Granted by hand; the maintainer too | blue-500 `#3B82F6` | Yes | View the TEAM category; Manage Messages, Manage Threads, Timeout Members, Kick Members, View Audit Log, Mention @everyone. No Administrator. |
| Contributor | Granted by hand to people with a merged pull request | green-600 `#16A34A` | Yes | None. Colour and a member list group, as recognition. |
| Member | Everyone who answers the Onboarding question; given by the bot to members who joined before it | cyan-600 `#0891B2` | No, so Founder and Team stay the groups that stand out | None. What members can do stays with `@everyone` and rules screening. |

Role names are drawn on Discord's dark (`#313338`) and light (`#FFFFFF`) themes alike, so each colour is picked for at least 3:1 on both, measured: amber-600 3.97 and 3.19, blue-500 3.44 and 3.68, green-600 3.84 and 3.30, cyan-600 3.43 and 3.68. No single colour reaches 4.5:1 on both backgrounds (it would need a relative luminance at once below 0.18 and above 0.32), so 3:1 on both is the ceiling. The name next to the colour still reads at full contrast in the member list and on messages, since Discord draws the message text itself in the theme's text colour. A role icon needs boost level 2 and is out of scope.

Server-wide `@everyone`: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Add Reactions, Read Message History, Connect, Speak, Use Voice Activity. Off: Mention @everyone/@here/all roles, Manage Channels, Manage Roles, Manage Webhooks, Create Private Threads.

Per-category overwrites:

| Category | `@everyone` | Team |
|---|---|---|
| START HERE | Deny Send Messages, Create Public Threads, Use Application Commands (so no bot posts there at a member's request) | Allow Send Messages |
| COMMUNITY | Inherit | Inherit |
| SUPPORT | Inherit (can create posts and reply) | Inherit; Manage Threads applies moderated tags |
| TEAM | Deny View Channel | Allow View Channel |

Channels sync to their category's permissions; no channel gets its own overwrite, so the table above is the whole permission model.

## Community and onboarding

Community settings:

| Setting | Value |
|---|---|
| Verification level | Medium (verified email, Discord account older than 5 minutes) |
| Explicit content filter | All members |
| Default notifications | Only @mentions |
| Rules channel | `#welcome` |
| Community updates channel | `#mod-updates` |
| Primary language | English |
| Description | Zorvo is a free, open-source Mac app that runs coding agents such as Claude Code, Codex and Qwen Code in one chat. |

Onboarding:
- Default channels: `#welcome`, `#announcements`, `#activity`, `#general`, Lounge, `#help`, `#bugs`, `#ideas`. Discord requires at least 7 default channels, at least 5 of which members can post in. Here the 5 are `#general`, Lounge and the three forums, exactly the minimum: removing any of them from the defaults breaks Onboarding.
- One required, single-choice question shown on join: "What brings you to Zorvolabs?" with the answers "I use Zorvo", "I'm trying Zorvo out", "I want to contribute" and "Just looking around", so someone who only wants to join has an honest answer too. Every answer gives the Member role; Discord assigns it, so no bot is involved. The answers show the team, in Onboarding's own stats, who the community is.
- Rules screening on, with the rules below. A member cannot post until they accept.

Rules (shown in screening and in `#welcome`):
1. Be kind. Critique the work, not the person.
2. Use English in public channels.
3. Questions go in #help, bugs in #bugs, ideas in #ideas.
4. Never post API keys, tokens or passwords, even when asking for help with a sign-in.
5. No spam or unsolicited promotion.
6. Follow Discord's Terms of Service.

### `#welcome` text

Posted by the bot during setup, then edited by the team when needed:

> **Welcome to Zorvolabs**
>
> Zorvo is a free, open-source Mac app that runs coding agents such as Claude Code, Codex and Qwen Code in one chat. You pick the agents; Zorvo installs them, keeps your sessions, and shows what each agent changed.
>
> **Get Zorvo:** https://github.com/zakyirsyaad/zorvo/releases/latest
> **Website:** https://zorvolabs.xyz
> **Source code:** https://github.com/zakyirsyaad/zorvo
>
> **Where to go**
> #help when something does not work the way you expect
> #bugs when Zorvo does something wrong
> #ideas when you want Zorvo to do something new
> #activity for releases and what is happening in the repository
>
> **Rules**
> (the six rules above)

## AutoMod

| Rule | Trigger | Action | Exempt |
|---|---|---|---|
| Spam | Discord's spam preset | Block message | Team |
| Mention spam | More than 5 mentions in a message | Block message | Team |
| Secrets | Regex list below | Block message, show "This looks like an API key or token, so it was not posted. Remove it and send again." | None |
| Invites | Regex `discord(?:\.gg\|(?:app)?\.com/invite)/\S+` | Block message | Team |

Secret patterns, one AutoMod regex each (Rust regex syntax, each under Discord's 260-character limit, 8 of the 10 allowed):

```
\bsk-ant-[A-Za-z0-9_-]{20,}
\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}
gh[pousr]_[A-Za-z0-9]{36}
github_pat_[A-Za-z0-9_]{22,}
AKIA[0-9A-Z]{16}
AIza[0-9A-Za-z_-]{35}
xox[abprs]-[A-Za-z0-9-]{10,}
[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}
```

They cover Anthropic, OpenAI, GitHub, AWS, Google, Slack and Discord bot tokens. Help threads about sign-in are where people are most likely to paste one, and this is the same idea as Zorvo's own secret guard in Private mode.

## GitHub feed in `#activity`

Two sources post to the one channel, each through its own Discord webhook so either can be revoked alone.

**Repository webhook to Discord's `/github` endpoint.** Events: Pull requests, Pull request reviews, Issues, Check suites. Releases is deliberately not ticked: GitHub sends a `release` event with action `created` for a draft, and `node scripts/sign-release.mjs` creates the draft before it is published. Pushes are not ticked because they are noise next to the pull requests that carry them.

**Workflow `.github/workflows/discord-release.yml`.** Posts one message per release.
- Trigger: `release: types: [released]`, which GitHub sends when a release is published and when a prerelease is later marked as a release, and only when `github.event.release.prerelease` is false. A draft or a prerelease posts nothing.
- `permissions: {}`. No checkout, no `pnpm install`, no project code. One step that builds a JSON body from the event with `jq` and sends it with `curl` to the webhook in the secret `DISCORD_RELEASES_WEBHOOK`.
- Message: an embed titled `Zorvo <tag>`, linking to the release page, with the release notes cut to 1,500 characters and a "Read the full notes" link when cut.
- Risk of the secret: any workflow in the repository can read a repository secret. If it leaks, the worst case is messages posted to `#activity`; the fix is deleting the webhook in Discord and making a new one. It does not touch `release.yml`, so `scripts/release-workflow.test.mjs` is unaffected.

Webhook URLs are secrets. The bot creates them through the Discord API and they go straight into `gh secret set` and `gh api` over stdin. They are never printed in a terminal, a log or the chat.

## Setup order

Done with the bot's Administrator permission through the Discord REST API, except steps marked (maintainer).

1. Guild settings: verification Medium, explicit content filter all members, default notifications only mentions.
2. Roles: create Founder, Team, Contributor and Member with their colours; give Founder and Team to `933427452439564330` and Member to every other human member. (maintainer) Drag the `zorvolabs` role to the top of Server Settings, Roles, once: every role starts at the same position and a bot cannot move roles at or above its own. Then the bot orders them Jockie, Founder, Team, Contributor, Member.
3. Categories and channels: create START HERE, COMMUNITY, SUPPORT, TEAM; create `#welcome`, `#announcements`, `#activity`, `#team`, `#mod-updates`; move and rename `#general` and voice General to Lounge; set the category overwrites and sync every channel; delete the two empty default categories.
4. Community: enable it with `#welcome` and `#mod-updates`, set language and description; convert `#announcements` to an announcement channel; create the three forums with tags and post guidelines.
5. Content: post the `#welcome` text. Set up Onboarding defaults and rules screening. (maintainer) If the API refuses rules screening, the maintainer pastes the prepared rules in Server Settings.
6. AutoMod: create the four rules.
7. Feed: create two webhooks on `#activity`; set the repository webhook with `gh api`; store `DISCORD_RELEASES_WEBHOOK` with `gh secret set`.
8. Workflow: add `discord-release.yml` on a branch and open a pull request. (maintainer) Merge it.
9. Invite: create a permanent invite to `#welcome` with no expiry and no use limit, for zorvolabs.xyz and the README. A vanity URL needs boost level 3, so it is out of scope.
10. Verify (below).

## Hardening after setup

1. Remove Administrator from the `zorvolabs` role and leave it no permissions. The bot is used through DMs only.
2. Set `dmPolicy` to `allowlist` in `~/.claude/channels/discord/access.json`. The maintainer is already the only allowed sender.
3. (maintainer) Turn off Public Bot in the Discord Developer Portal, so only the maintainer can add the bot to a server.
4. (maintainer) Reset the bot token, which was pasted into a chat transcript, and save the new one from a terminal.

## Verification

- Read the guild, channels, roles, overwrites, AutoMod rules, onboarding and webhooks back through the API and compare them with this document.
- Read `#welcome`, `#announcements`, `#activity` and the TEAM category as `@everyone` would, by computing effective permissions for a role with no grants.
- Post a message containing a fake key in a test thread, as a non-Team member if one is available, and confirm AutoMod blocks it.
- After the workflow merges, the next published release posts in `#activity`; a draft release posts nothing there.

## Not in scope

- Bots beyond `zorvolabs` and Jockie, including support bots that answer questions.
- Self-assignable roles, showcase, events and stage channels, per-agent channels.
- Moving bug reports to GitHub automatically.
- A vanity invite URL.
- Removing Jockie's Administrator (declined by the maintainer).

## Changes after review (2026-11-19)

- The two OpenAI and Anthropic key patterns start with `\b`. Without it they matched hyphenated words such as `fix/task-tabs-for-background-subagents`, so AutoMod blocked ordinary messages about branches and files.
- START HERE also denies `@everyone` Use Application Commands, so a member cannot make a bot (Jockie has Administrator) answer a slash command in a read-only channel.
- Member role added on request: cyan-600, no permissions, not shown apart, lowest human role, given through the Onboarding question above. The one human member who joined before it got it from the bot.
- From the PR review: the release workflow listens to `released` instead of `published`, so a prerelease later marked as a release is posted; it cuts long notes at a line break, leaves the description out when the notes are empty (Discord refuses an empty one), and lets curl retry a 429 or 5xx three times.
