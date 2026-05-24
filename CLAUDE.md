# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Run bot using .env (dev machine)
npm run start-prod     # Run bot using prod.env (prod server or dev machine targeting prod)
npm run deploy-prod    # Deploy slash commands using prod.env

node deploy-commands.js          # Deploy slash commands to GUILD_ID (instant)
node deploy-commands.js --global # Deploy globally (propagates up to 1 hour)
node list-all-commands.js        # List commands currently registered with Discord
node delete-command.js           # Remove a specific command
node get-role-ids.js             # Print all role IDs from the guild
node generate-broadcast-list.js <input.csv>  # Build data/broadcast-list.csv from a CSV (skips first 6 rows, reads column B)
```

There is no test suite (`npm test` is a placeholder). Lint config is in `eslint.config.js` (tabs for indent, Stroustrup braces, trailing commas required, semicolons required).

At runtime the process accepts a typed `stop` command on stdin to trigger a graceful shutdown that saves the member cache before exiting.

### Env files
- `.env` — development values loaded by `require('dotenv').config({ path: path.join(__dirname, '.env') })` in `index.js`. Loading from `__dirname` is intentional so the bot works regardless of CWD; do not change to plain `dotenv.config()`.
- `prod.env` — production values. `start-prod` / `deploy-prod` load it via Node's `--env-file` flag (not dotenv). This exists so the dev machine can deploy/start against production.
- `credentials.json` — Google service-account key, read directly by `utils/sheets.js`. Not in repo.

## Architecture

### Entry flow
`index.js` builds the `Client`, then dynamically loads every `.js` under `commands/*/` into `client.commands` and every `.js` under `events/` as a Discord event listener. Each command file must export `{ data, execute }` (and optionally `cooldown`, `autocomplete`, `continueVerification`). Folder grouping under `commands/` (admin/events/general/hours) is organizational only — `deploy-commands.js` walks the same structure.

### Two InteractionCreate listeners
`events/interactionCreate.js` AND `events/modalSubmit.js` both register `Events.InteractionCreate`. `modalSubmit.js` early-returns on anything that isn't a modal submit; `interactionCreate.js` handles buttons, autocomplete, and chat-input commands. When touching interaction routing, update the correct file — don't merge them unless you understand that both currently fire for every interaction.

### Verification state machine
`/verifyuser` can branch into asynchronous user prompts (single-name confirmation button, nickname conflict modal). State for the in-flight verification lives on `client.verificationPending` (a `Map` keyed by target user ID) and contains the resolved role objects, channel IDs, `targetMember`, `conflictingMember`, and a `timeoutId` for auto-expiry. Three files coordinate through this map:
- `commands/admin/verifyuser.js` — writes the pending entry, exposes `continueVerification()` for resumption.
- `events/interactionCreate.js` — handles the `single_name_continue_*`, `cancel_verification_*`, and `resolve_nickname_conflict_*` button IDs; clears the timeout and either calls `continueVerification` or opens the nickname modal.
- `events/modalSubmit.js` — consumes `nickname_conflict_*` submissions, applies roles/nicknames, deletes the pending entry.

Always clear `timeoutId` and delete the `verificationPending` entry on every terminal branch, or the next run for that user will see a stale session.

### Google Sheets access (`utils/sheets.js`)
Singleton `SheetsManager` wrapped around `googleapis`. Every API call goes through `safeApiCall(fn, opName)` which returns `null` on error instead of throwing — callers must null-check. When adding a new sheet operation, follow this pattern so a transient Sheets failure can't crash the bot. Sheet IDs come from env vars (`VOLUNTEERS_SHEET_ID`, `EVENTS_SHEET_ID`, `LEADERSHIP_SHEET_ID`, `VERIFICATION_SHEET_ID`); tab names are embedded in each method (e.g., `'Signup Sheet'`, `'Tracker'`, `'Hour Verification'`, `'Membership Status'`, `'#nextech-verify'`). The events `Signup Sheet` is **column-oriented** — each column is one event, rows 1–11 are fields. Name matching in `getMembershipStatus` uses case-insensitive + apostrophe-normalized + subsequence fuzzy matching to bridge the volunteer sheet (source of Discord IDs) with the membership status sheet.

### Member cache (`utils/memberCache.js`)
Singleton persisted to `data/member-cache.json`. Populated by `events/ready.js` via `guild.members.fetch({ force: true })` on startup and every 15 min. Bots are excluded. `gracefulExit` and the `uncaughtException` handler in `index.js` both call `memberCache.save()` so in-memory state survives restarts. `checkLeftUsers` in `sheets.js` refuses to run if `guild.members.cache.size === 0` to avoid false positives — preserve that guard.

### Calendar sync (`utils/calendarSync.js`)
`startCalendarSync(client, minutes)` polls `CALENDAR_ICAL_URL` and reconciles iCal VEVENTs containing "Info Session" with Discord `GuildScheduledEvent`s in a stage channel. UID→Discord-event-ID mapping persists to `data/event-mapping.json`.

### Hour approval sync (`utils/hourApprovalSync.js`)
When `HOUR_APPROVAL_ENABLED=true`, `startHourApprovalSync(client, minutes)` polls the **Hour Verification** tab on `EVENTS_SHEET_ID` for pending verdicts (`empty`, `Pending`, `Unverified`) within `HOUR_APPROVAL_LOOKBACK_DAYS` (default 30). For each new row, it DMs the department approver from the Leadership sheet (`getContacts`) with Approve/Decline buttons. Row numbers already notified are tracked in `data/hour-approval-notified.json`. In-flight button sessions live on `client.hourApprovalPending` (keyed by sheet row number) with a `timeoutId` — clear via `clearHourApprovalSession` on every terminal branch (same discipline as `verificationPending`). Button handlers are in `utils/hourApprovalSync.js` (`handleHourApprovalButton`, routed from `events/interactionCreate.js`): `hour_approve_*`, `hour_change_*` (modal in `events/modalSubmit.js` via `handleHourApprovalModal`), `hour_decline_*`. Approve/Change/Decline write **Approved**, **Changed**, or **Denied** into the row cell under the assigned confirmer's header column (`setConfirmerHourStatus` in `utils/sheets.js`). Assigned confirmer is read from column F by default; header map is built from rows 1–2. **Change** also updates column B (hours).

### Health check
`index.js` has a Healthchecks.io URL and a `HEALTH_CHECK_INTERVAL` constant. Set to `0` currently, which disables pings — set to a positive millisecond value to re-enable.

### Role name conventions (relied on across commands)
Roles are matched by case-insensitive substring on `.name`, not by ID, except for the handful wired through env vars (`NT_MEMBER_ROLE_ID`, `NT_UNVERIFIED_ROLE_ID`, `COMBINED_UNVERIFIED_ROLE_ID`, `EC_ROLE_ID`, `VERIFICATION_TEAM_ROLE_ID`). Expected names: `NT Member`, `NT Enrolled`, `NT Unenrolled`, `NT Board of Advisors`, `NT Unverified` / `NexTech Unverified`, `Combined Unverified`, `Server Member`, `Online Member`, `Verification Team`, `NT Executive Committee`. Region roles must match `Name (CC #)` (e.g. `Ontario (CA 1)`); country roles must match `Name (CC)` (e.g. `Canada (CA)`). `/createregion` relies on this format for auto-numbering.

### Intents and partials
`GuildMembers` and `MessageContent` are privileged — must be enabled in the Discord developer portal. `Partials.Channel` is required so DMs (`messageCreate` DM forwarding) arrive.
