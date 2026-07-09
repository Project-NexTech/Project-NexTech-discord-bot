# Project NexTech Discord Bot

A comprehensive Discord bot built with Discord.js v14 for managing the Project NexTech community server. This bot handles member verification, volunteer hours tracking, event management, calendar synchronization, and various administrative tasks.

## Table of Contents

- [Features](#features)
- [Commands](#commands)
  - [Admin Commands](#admin-commands)
  - [General Commands](#general-commands)
  - [Events Commands](#events-commands)
  - [Hours Commands](#hours-commands)
- [Setup](#setup)
- [Configuration](#configuration)
- [Google Sheets Integration](#google-sheets-integration)
- [Automated Features](#automated-features)
- [Project Structure](#project-structure)

## Features

### Core Functionality
- **Member Verification System** - Automated onboarding with verification forms and admin approval
- **Google Sheets Integration** - Real-time sync with membership data, hours tracking, events, and contacts
- **Calendar Synchronization** - Automatic Discord event creation from iCal feeds
- **Volunteer Hours Tracking** - Track and display volunteer hours with leaderboards
- **Event Management** - View and filter upcoming events by department
- **Contact Directory** - Quick access to leadership contact information
- **Role Management** - Automated role assignment based on membership status
- **Region & Country Roles** - Create and manage geographic roles with proper formatting
- **Member Cache System** - Persistent caching for improved performance
- **DM Forwarding** - Forward direct messages to verification team
- **Broadcast System** - Send announcements to all members via DM

### Security & Permissions
- Role-based access control for sensitive commands
- Cooldown system to prevent command spam
- Permission checks for administrative functions
- Ephemeral responses for privacy-sensitive information

## Commands

### Admin Commands

#### `/broadcast`
Send a direct message to filtered groups of members.

**Permissions:** NT Executive Committee or Verification Team  
**Cooldown:** 5 minutes  
**Options:**
- `message` (required) - The message to broadcast
- `recipients` (required) - Choose who receives the message:
  - **All NT Members** - Everyone with NT Member role
  - **Enrolled** - Members with NT Enrolled role
  - **Unenrolled** - Members with NT Unenrolled role
  - **Unverified** - Members with unverified roles
  - **Paused** - Members marked as Paused/Not a Member in Membership Status sheet
  - **Custom CSV** - Members from a CSV file (see generate-broadcast-list.js)
- `csv_url` (optional) - URL or file path to CSV when using Custom CSV option
- `confirm` (required) - Must be set to `True` to confirm sending

**Features:**
- Sends embeds with sender information
- Tracks success/failure counts
- Reports delivery statistics
- Rate-limited to 250 messages per minute with automatic retry
- Supports filtering by role or Google Sheets data
- CSV support with automatic parsing (skips first 6 rows, reads column B)
- Handles HTTP/HTTPS URL downloads and local file paths

---

#### `/createregion`
Create a new region role with proper formatting, ordering, and optional member assignment.

**Permissions:** NT Executive Committee only  
**Cooldown:** None  
**Options:**
- `region_name` (required) - Name of the region (e.g., "Ontario")
- `country_code` (required) - Two-letter country code (e.g., "CA")
- `country_name` (required) - Full country name (e.g., "Canada")
- `members` (optional) - Comma-separated member IDs to add to roles

**Features:**
- **Automatic Role Naming:** Creates roles in the format:
  - Region: `RegionName (CC #)` (e.g., "Ontario (CA 1)")
  - Country: `CountryName (CC)` (e.g., "Canada (CA)")
- **Auto-Numbering:** Automatically assigns the next sequential number for regions within the same country
- **Smart Country Role Handling:** 
  - Checks if country role already exists
  - Creates new country role if needed
  - Uses existing country role if available
- **Automatic Role Positioning:** Places roles in the correct hierarchy:
  - Country roles above region roles
  - Maintains consistent ordering
  - Places above base roles, below administrative roles
- **Batch Member Assignment:** Optionally adds multiple members to both country and region roles
- **Validation:** Checks for existing roles and validates member IDs before creation
- **Interactive Confirmation:** Shows preview with confirmation buttons before creating roles
- **Error Handling:** Reports which members were successfully added and which failed

**Example Usage:**
```
/createregion region_name:Ontario country_code:CA country_name:Canada
/createregion region_name:Texas country_code:US country_name:United States members:123456789,987654321
```

---

#### `/createprojectgroup`
Create a Discord channel for a project group and grant access to its members.

**Permissions:** NT Executive Committee only  
**Cooldown:** None  
**Options:**
- `name` (required) - Display name for the channel (automatically slugified to meet Discord naming rules)
- `code` (required) - Project group code, must match a tab name in the Project Group Tracker sheet

**Features:**
- Looks up the matching tab in the Project Group Tracker by code
- Reads member names from cells F3 (Group Lead(s)) and E4 (Members, top-left of merged E4:F5)
- Resolves names to Discord IDs via the Verification sheet using fuzzy matching, reading both the
  `#verify-here` and `#nextech-verify` tabs
- Skips members whose verification row is shaded red (they left the server), since a permission
  overwrite for them would be useless
- Shows an ephemeral confirmation preview before creating anything, including any names that could
  not be matched and any matched members who left the server
- Creates the channel in the Project Groups category (inherits category permissions)
- Adds per-user View Channel + Send Messages overwrites for all matched members still in the server
- Sends a creation summary to staff chat

---

#### `/syncroles`
Synchronize NT Enrolled/Unenrolled roles based on membership status from Google Sheets.

**Permissions:** NT Executive Committee or Administrator  
**Cooldown:** 60 seconds

**Functionality:**
- Fetches membership status from Google Sheets
- Assigns "NT Enrolled" role to active members (Member, New Member, Paused)
- Assigns "NT Unenrolled" role to inactive members (Not a Member)
- Skips users with "NT Board of Advisors" role
- Provides detailed statistics of role changes

---

#### `/verifyuser`
Manually verify a new member and assign appropriate roles.

**Permissions:** Verification Team, EC, Leadership, or Administrator  
**Cooldown:** 10 seconds  
**Options:**
- `user` (required) - The user to verify
- `name` (required) - Full name of the user
- `irl_connection` (required) - Whether they have IRL connection to existing member
- `grade` (optional) - Grade level (7th-12th, college years)
- `school` (optional) - School name
- `region` (optional) - Region with autocomplete
- `robotics_team` (optional) - Robotics team number or name
- `invite_source` (optional) - How they found Project NexTech

**Features:**
- **Automatic Nickname Conflict Detection & Resolution:**
  - Detects members with the same first name
  - Auto-resolves when last initials are different (adds last initial to both users)
  - Triggers manual modal when last initials match (requires custom nicknames)
  - Only verifies users with unverified roles to prevent accidental re-verification
- Autocomplete for region selection
- Logs verification to Google Sheets
- Removes unverified roles (NT Unverified/Combined Unverified)
- Assigns NT Member role
- Assigns Server Member/Online Member roles based on IRL connection
- Assigns NT Unenrolled role by default
- Assigns region and country roles automatically
- Updates nickname to `[ɴᴛ] FirstName` or `[ɴᴛ] FirstName L.` format
- Sends verification details to staff chat channel
- Posts welcome message in NT chat channel
- Warns about missing optional fields

**Nickname Conflict Resolution:**
- **No Conflict:** Sets nickname to `[ɴᴛ] FirstName`
- **Different Last Initials:** Auto-resolves by setting both users to `[ɴᴛ] FirstName L.`
- **Same Last Initials:** Opens interactive modal for manual nickname entry for both users

### General Commands

#### `/verify`
Self-verification form for new members to gain access to the server.

**Permissions:** NT Unverified or Combined Unverified role required  
**Cooldown:** 10 seconds

**Features:**
- Opens a modal with verification form
- Collects: full name, grade, school, region, robotics team, referral source
- Submits to verification channel for admin review
- Pings Verification Team role
- Sends confirmation to user

---

#### `/calendar`
Get the link to the Project NexTech Google Calendar.

**Cooldown:** 3 seconds

**Features:**
- Displays calendar URL in embedded format
- Quick access to all events and meetings

---

#### `/contact`
View contact information for **all** leadership.

**Cooldown:** 5 seconds  
**Options:** None — lists every leadership contact.

**Features:**
- Fetches all contacts from the Leadership Google Sheet (`getContacts`)
- Displays name, role, Discord mention, and email
- Renders chunked embeds to respect Discord's 25-field-per-embed limit (`createContactsEmbed`)

### Events Commands

#### `/events`
View upcoming events filtered by department.

**Cooldown:** 1 second  
**Options:**
- `department` (required) - Choose from:
  - Engineering
  - Mentoring
  - Programming
  - Physics/Math
  - Natural Sciences
  - All

**Features:**
- Fetches events from Google Sheets
- Displays comprehensive event information:
  - Date and day of week
  - Status (with "NO SIGNUPS" warnings)
  - Course selection
  - Region
  - Time
  - Hours (credit)
  - Location
  - Notes
- Highlights undecided events with ⚠️
- Department-based filtering
- Pagination for large event lists (13 events per page)
- Interactive navigation buttons

---

#### `/infosessions`
Display all upcoming Project NexTech Info Session events from Discord.

**Cooldown:** 5 seconds

**Features:**
- Fetches Discord scheduled events
- Filters for "Project NexTech Info Session" events only
- Shows only future events (ignores past sessions)
- Displays for each session:
  - Full date and time (Discord timestamp)
  - Relative time until start (e.g., "in 2 days")
  - Direct link to Discord event
  - Presentation slides link
- Sessions sorted chronologically (earliest first)
- Visual separators between multiple sessions
- Shows total count in footer
- Encourages members to mark "Interested" on events

### Hours Commands

#### `/hours`
View volunteer hours for yourself or another member.

**Cooldown:** 5 seconds  
**Options:**
- `user` (optional) - User to check hours for (defaults to yourself)
- `requests` (optional) - Number of recent requests to display (1-10)

**Features:**

**Default Behavior (no `requests` parameter):**
- Displays total volunteer hours summary
- Shows user's profile picture
- Fetches data from "Tracker" sheet
- Formatted with timestamps

**With `requests` parameter:**
- Displays recent hour verification requests
- Shows the most recent N requests (sorted by submission order)
- Fetches data from "Hour Verification" sheet
- For each request, displays:
  - Request number (row in sheet)
  - Hours requested
  - Approval status (✅ Approved, ⏳ Unverified, ❓ Other)
  - Department
  - Date
  - Type of task
  - Description of task
- Special handling:
  - **Denied requests:** Shows status but hides hours details
  - **Missing requests:** Shows placeholder for positions without data
  - Shows total count if more requests exist than displayed
- Data pulled from Google Sheets columns:
  - Column A: Name (for matching)
  - Column B: Hours
  - Column C: Verdict (Approved/Denied/Unverified)
  - Column D: Department
  - Column E: Date
  - Column H: Type of task
  - Column I: Description

**Examples:**
```
/hours                          → Shows your total hours
/hours user:@John              → Shows John's total hours
/hours requests:5              → Shows your last 5 verification requests
/hours user:@John requests:3   → Shows John's last 3 requests
```

---

#### `/leaderboard`
View the volunteer hours leaderboard.

**Cooldown:** 10 seconds  
**Options:**
- `limit` (optional) - Number of top volunteers (5-25, default: 10)

**Features:**
- Shows top volunteers by total hours
- Medal emojis for top 3 (🥇 🥈 🥉)
- Sorted by hours descending
- Only includes members with hours > 0

---

#### `/requesthours`
Get the link to the volunteer hours request form.

### Automated Hour Approval (optional)

When enabled, the bot polls the **Hour Verification** sheet and DMs department leadership to approve or deny pending requests.

**Environment variables:**
- `HOUR_APPROVAL_ENABLED=true` — Turn on polling and DMs
- `HOUR_APPROVAL_POLL_MINUTES=5` — How often to scan for new rows (default: 5)
- `HOUR_APPROVAL_LOOKBACK_DAYS=30` — Only notify for requests dated within the last N days
- `HOUR_APPROVAL_SESSION_HOURS=168` — How long Approve/Change/Deny buttons stay active (default: 7 days)
- `HOUR_VERIFICATION_NOTES_COLUMN` — 0-based index of the Note column (default: `46`, i.e. column **AU**; auto-detected from the `Note` header in row 2)

**Flow:**
1. Volunteer submits hours (Google Form → Hour Verification row with `Unverified` verdict in column C)
2. Bot resolves the approver(s) from column F of that row — a single name, a comma-separated list, or a group label like `Anyone on EC/BD` (which expands to **all** EC/BD leadership contacts with a Discord ID)
3. Each approver receives a separate DM with request details (Volunteer, Hours, Department, Date, Type, Link, Description) and **Approve** / **Change** / **Deny** buttons
4. **Approve** → Sets `Approved` in the column under that confirmer's header; all sibling DMs (other approvers for the same row) are cancelled
5. **Change** → Modal for revised hours → confirmer column set to `Changed`, and a `oldHours->newHours` note (e.g. `2->1.5`) written to the **Note** column (auto-detected from `Note` header in row 2, column AU by default). The bot does **not** write columns B or C directly — the `Changed` verdict plus note drive the sheet's own formulas.
6. **Deny** → Modal for a reason → confirmer column set to `Denied`, reason text written to the **Note** column; all sibling DMs cancelled

Only rows that newly appear **while the bot is running** are DMed. On startup the first scan records all currently-pending rows as a baseline (no DMs), so a restart never re-blasts the backlog. If buttons are never clicked, they expire after `HOUR_APPROVAL_SESSION_HOURS` and the DM is edited to link the exact sheet cell for manual action.

**Self-DM prevention:** Leaders and EC members are never sent approval DMs for their own submitted hours. If the resolved approver's name matches the volunteer's name (case-insensitive), the DM is skipped.

The assigned confirmer for each row is read from column F (configurable via `HOUR_VERIFICATION_CONFIRMER_FIELD_COLUMN`). Header rows (default: rows 1–2) must include a matching verdict column for each named confirmer. Group labels (`Anyone on the EC`, `Anyone on EC/BD`, etc.) expand to all matching contacts and write their verdict to column C.

**Requirements:**
- Leadership sheet must list Discord User IDs for department contacts
- Approver must allow DMs from server members
- Service account needs **write** access to the Events spreadsheet (Hour Verification tab)
- Notified row numbers **and** live DM button sessions persist in `data/hour-approval-state.json` (not committed to git), so a restart keeps pending DM buttons working and never re-DMs the backlog

**Cooldown:** 10 seconds

**Features:**
- Displays Google Form link as button
- Shows what information to include
- Formatted embed with instructions

## Setup

### Prerequisites
- Node.js 16.9.0 or higher
- npm or yarn
- Discord Bot Token
- Google Cloud Service Account with Sheets API access
- Google Sheets for data storage

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/Project-NexTech/Project-NexTech-discord-bot.git
cd Project-NexTech-discord-bot
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
Create a `.env` file in the root directory:
```env
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id

# Role IDs
NT_MEMBER_ROLE_ID=role_id
NT_UNVERIFIED_ROLE_ID=role_id
COMBINED_UNVERIFIED_ROLE_ID=role_id
EC_ROLE_ID=role_id
VERIFICATION_TEAM_ROLE_ID=role_id

# Channel IDs
INFO_SESSION_VOICE_CHANNEL_ID=channel_id
NT_CHAT_CHANNEL_ID=channel_id
STAFF_CHAT_CHANNEL_ID=channel_id
PROJECT_GROUPS_CATEGORY_ID=category_id

# Google Sheets IDs
VOLUNTEERS_SHEET_ID=sheet_id
EVENTS_SHEET_ID=sheet_id
LEADERSHIP_SHEET_ID=sheet_id
VERIFICATION_SHEET_ID=sheet_id
PROJECT_GROUP_TRACKER_SHEET_ID=sheet_id

# URLs
CALENDAR_URL=your_calendar_url
CALENDAR_ICAL_URL=your_ical_url
HOURS_FORM_URL=your_hours_form_url
INFO_SESSION_BANNER_URL=path_or_url_to_banner

# Feature Flags
CHECK_LEFT_USERS_ENABLED=false
HOUR_APPROVAL_ENABLED=false
HOUR_APPROVAL_POLL_MINUTES=5
HOUR_APPROVAL_LOOKBACK_DAYS=30
HOUR_APPROVAL_SESSION_HOURS=168

# Apps Script webhook endpoint (member onboarding + reimbursement requests)
ONBOARD_PORT=25599
ONBOARD_SECRET=your_shared_secret
BD_ROLE_ID=role_id
REIMBURSEMENT_THREAD_ID=thread_id
```

4. **Set up Google Sheets credentials:**
- Create a service account in Google Cloud Console
- Enable Google Sheets API
- Download the credentials JSON file
- Rename it to `credentials.json` and place it in the project root
- Share your Google Sheets with the service account email

5. **Deploy commands:**
```bash
# Deploy to your guild (instant)
node deploy-commands.js

# Deploy globally (takes up to 1 hour)
node deploy-commands.js --global
```

6. **Start the bot:**
```bash
node index.js
```

## Configuration

### Google Sheets Structure

The bot expects the following sheets:

#### Volunteers Sheet (`VOLUNTEERS_SHEET_ID`)
- **Tab:** `Limited Data`
- **Columns:** Name (A), Email 1 (B), Email 2 (C), Discord User ID (E)

#### Events Sheet (`EVENTS_SHEET_ID`)
- **Tab:** `Signup Sheet`
  - Columns-based structure (each column = one event)
  - Row 1: Date
  - Row 2: Day of Week
  - Row 3: Comment
  - Row 4: Status
  - Row 5: Course Selection
  - Row 6: Region
  - Row 7: Supervisor
  - Row 8: Depart Time
  - Row 9: Credit (hours)
  - Row 10: Location
  - Row 11: Note

- **Tab:** `Tracker`
  - Column A: Name
  - Column K: Total Hours

- **Tab:** `Hour Verification`
  - Column A: Name
  - Column B: Hours (updated by sheet formulas, not the bot)
  - Column C: Verdict (updated by sheet formulas, not the bot)
  - Column D: Department
  - Column E: Date (used for lookback filtering)
  - Column F: Assigned confirmer name (must match a header column, or a group label)
  - Column G: Link (optional URL shown in approval DM embed)
  - Column H: Type of task
  - Column I: Description
  - Confirmer columns (headers in rows 1–2): each named confirmer has a column; per-row cells use `Approved`, `Changed`, or `Denied`
  - Note column (AU / index 46 by default, auto-detected from `Note` header in row 2): written by the bot for Change (`oldHours->newHours`) and Deny (reason text)

- **Tab:** `Membership Status`
  - Column A: Name (starts at row 10)
  - Column B: Status (Member, New Member, Paused, Not a Member, Unknown)

#### Leadership Sheet (`LEADERSHIP_SHEET_ID`)
- **Tab:** `Sheet1`
- **Columns:** Name (A), Department (B), Email (C), Discord Username (D), Discord User ID (E), Role/Note (F)

#### Verification Sheet (`VERIFICATION_SHEET_ID`)
- **Tab:** `#nextech-verify`
- **Columns:** Discord ID (A), Name (B), Grade (F), School (G), Region (H), Robotics Team (I), Invite Source (J)

#### Project Group Tracker (`PROJECT_GROUP_TRACKER_SHEET_ID`)
- **Tabs:** One tab per project group; the tab title is the group's code
- **Cells (per tab):**
  - `F3` - Group Lead(s), comma-separated names
  - `E4` - Members (top-left of the merged E4:F5 region), comma-separated names

### Role Naming Conventions

The bot expects the following role names (case-insensitive):
- `NT Member`
- `NT Enrolled`
- `NT Unenrolled`
- `NT Board of Advisors`
- `NT Unverified` or `NexTech Unverified`
- `Combined Unverified`
- `Server Member`
- `Online Member`
- `Verification Team`
- `NT Executive Committee`

Region roles should follow the pattern: `Region Name (CC #)` (e.g., "San Diego (US 1)")
Country roles should follow the pattern: `Country Name (CC)` (e.g., "United States (US)")

## Google Sheets Integration

The bot integrates with Google Sheets for:

### Data Reading
- **Volunteer hours** - Fetches total hours and links Discord IDs to names
- **Events** - Retrieves upcoming events with all details
- **Membership status** - Syncs member enrollment status
- **Contacts** - Gets leadership contact information
- **Leaderboard** - Ranks members by volunteer hours

### Data Writing
- **User verification** - Logs new member verification data
- **Left users tracking** - Marks users who left the server (red background)
- **Hour verification** - Updates the assigned confirmer's verdict column (and column B hours when changed) when leadership approves via DM

### Authentication
Uses Google Service Account authentication with OAuth 2.0. The service account must have:
- Read access to all data sheets
- Write access to verification sheet
- Spreadsheets API scope: `https://www.googleapis.com/auth/spreadsheets`

## Automated Features

### Member Cache System
- **Purpose:** Improves performance for commands that need to check member data frequently
- **Persistence:** Cache saved to `data/member-cache.json` on disk
- **Auto-Refresh:** Updates every 15 minutes to keep data fresh
- **Smart Logging:** Only logs cache updates when member count changes or on initial load
- **Benefits:**
  - Faster nickname conflict detection in `/verifyuser`
  - Improved `/broadcast` command performance
  - Reduces API calls to Discord
  - Survives bot restarts (loads from disk on startup)
  - Minimal console noise during periodic refreshes
- **Data Stored:** User ID, username, display name, roles, join date
- **Exclusions:** Bot accounts are not cached

### Calendar Synchronization
- **Frequency:** Every 5 minutes
- **Function:** Creates Discord scheduled events from iCal feed
- **Target:** Info Session events only
- **Features:**
  - Automatically creates stage channel events
  - Updates existing events if times change
  - Deletes Discord events removed from calendar
  - Skips past events (> 1 hour ago)
  - Adds custom banner image
  - Persists mapping in `data/event-mapping.json`

### Left Users Checker
- **Frequency:** Every 6 hours (if enabled)
- **Function:** Checks verification sheet for users who left the server
- **Action:** Marks their row with red background color
- **Configuration:** Set `CHECK_LEFT_USERS_ENABLED=true` in `.env`

### Welcome Messages
- **Trigger:** User receives unverified role (from Discord onboarding)
- **Action:** Sends welcome message to verify ping channel
- **Content:** Instructions to run `/verify` command
- **Skips:** Users already verified via `/verifyuser`

### Verification Announcements
- **Trigger:** User successfully verified via `/verifyuser` command
- **Staff Notification:** Sends detailed verification embed to staff chat channel
- **Public Welcome:** Posts welcome message in NT chat channel with instructions
- **Content:** Directs new members to announcements, role selection, and info sessions

### Nickname Conflict Management
- **Detection:** Automatically checks for existing members with same first name
- **Auto-Resolution:** When last initials differ, adds last initial to both users' nicknames
- **Manual Resolution:** When last initials match, prompts staff to set custom nicknames via interactive modal
- **Prevention:** Ensures unique, identifiable nicknames across all verified members

### DM Forwarding
- **Trigger:** Bot receives direct message
- **Action:** Forwards to verification channel
- **Includes:** Message content, attachments, embeds, stickers
- **Notifies:** Pings Verification Team role
- **Purpose:** Allows users to contact verification team privately

### Cooldown System
- Prevents command spam
- Customizable per command
- Shows countdown timer in Discord timestamp format
- Resets after cooldown expires

### Apps Script Webhook Endpoint (`utils/memberEndpoint.js`)
A lightweight HTTP server (no Express) that Google Apps Script triggers POST to for events the bot needs to react to instantly rather than by polling a sheet. Started from `index.js` after login, gated on `ONBOARD_PORT`/`ONBOARD_SECRET` — both must be set or the endpoint is disabled.

- **Auth:** every route requires `Authorization: Bearer <ONBOARD_SECRET>` (constant-time comparison).
- **Body cap:** 8 KB for `/members/add`, 16 KB for the JSON routes.
- **Routes:**
  - `POST /members/add` — triggers a role sync; body ignored.
  - `POST /members/report` — posts an onboarding summary embed to `STAFF_CHAT_CHANNEL_ID`.
  - `POST /reimbursement/submit` — posts a reimbursement request embed to the thread configured via `REIMBURSEMENT_THREAD_ID`, pinging `EC_ROLE_ID` and `BD_ROLE_ID` (see below).
- **Responses:** `200 { ok: true }` on success; `4xx`/`5xx` `{ ok: false, error: "..." }` on failure (400 malformed JSON/missing required field, 401 bad/missing token, 413 body too large, 500 bot-side failure e.g. misconfigured thread).

#### Reimbursement Request Notifications
When the Reimbursement Request Google Form is submitted, an Apps Script trigger attached to the form POSTs the response to `/reimbursement/submit` (see `utils/reimbursementNotify.js`). The bot posts an embed to `REIMBURSEMENT_THREAD_ID`, pinging `EC_ROLE_ID` and `BD_ROLE_ID`, with:

- Requester name, amount, date of purchase, type of purchase, method of receipt, evidence link (or `none`), and additional details (or `None provided`)
- **Discord mention resolution:** the submitted `discordUsername` is looked up against the member cache (case-insensitive exact match, tolerant of a leading `@` or legacy `#1234` discriminator). If a match is found, the embed shows a clickable `@mention` with the raw submitted text in parentheses; otherwise it falls back to plain unlinked text (e.g. typo, or the member joined too recently to be cached yet)

Expected JSON payload from the Apps Script trigger:
```json
{
  "name": "Jane Doe",
  "discordUsername": "janedoe",
  "amount": "42.50",
  "evidenceLink": "https://drive.google.com/example",
  "purchaseDate": "2026-06-30",
  "purchaseType": "Supplies",
  "receiptMethod": "E-transfer",
  "details": "Poster board for info session"
}
```
Only `name` is required (400 if missing/empty) — the Google Form enforces the rest as required questions, so the bot applies no fallback defaults for them.

The Apps Script itself (which reads the Form response and POSTs it here) is not part of this repo's runtime — see `docs/apps-script-reimbursement-trigger.gs` for the script to paste into the Form's Script Editor.

## TODO

### `/syncprojectgroup` (planned)
A command to re-sync the permission overwrites on an existing project group channel against the
current state of the Project Group Tracker sheet. Useful when group membership changes after the
channel was originally created. Should accept a `channel` argument and a `code` argument, re-read
cells F3 and E4 from the matching tab, resolve names, diff against the channel's existing
overwrites, and add/remove as needed. Should follow the same ephemeral confirmation pattern as
`/createprojectgroup`.

## Project Structure

```
Project-NexTech-discord-bot/
├── commands/
│   ├── admin/
│   │   ├── broadcast.js        # Broadcast messages to filtered member groups
│   │   ├── createprojectgroup.js  # Create project group channels with member access
│   │   ├── createregion.js     # Create region/country roles
│   │   ├── syncroles.js        # Sync enrollment roles from Sheets
│   │   └── verifyuser.js       # Manually verify new members
│   ├── events/
│   │   ├── events.js           # View upcoming events
│   │   └── infosessions.js     # Display upcoming info session events
│   ├── general/
│   │   ├── calendar.js         # Get calendar link
│   │   ├── contact.js          # View all leadership contacts
│   │   └── verify.js           # Self-verification form
│   └── hours/
│       ├── hours.js            # View volunteer hours
│       ├── leaderboard.js      # Hours leaderboard
│       └── requesthours.js     # Get hours request form
├── events/
│   ├── ready.js                # Bot startup and initialization
│   ├── interactionCreate.js   # Handle commands, autocomplete, and buttons
│   ├── modalSubmit.js          # Handle verification modal
│   ├── messageCreate.js        # Forward DMs to verification
│   └── guildMemberUpdate.js    # Welcome new unverified members
├── utils/
│   ├── sheets.js               # Google Sheets API integration
│   ├── calendarSync.js         # Calendar synchronization
│   ├── hourApprovalSync.js     # Hour verification approval DMs
│   ├── memberCache.js          # Persistent member cache system
│   ├── memberEndpoint.js       # HTTP server for Apps Script webhooks (onboarding, reimbursement)
│   ├── reimbursementNotify.js  # Builds/posts the reimbursement request Discord embed
│   └── helpers.js              # Utility functions and embed builders
├── data/
│   ├── member-cache.json       # Cached member data (auto-generated)
│   ├── event-mapping.json      # Calendar event ID mapping (auto-generated)
│   └── broadcast-list.csv      # Custom broadcast recipient list (optional)
├── index.js                    # Main bot entry point
├── deploy-commands.js          # Command deployment script
├── generate-broadcast-list.js  # Generate CSV for custom broadcast (utility)
├── delete-command.js           # Remove commands (utility)
├── list-all-commands.js        # List deployed commands (utility)
├── get-role-ids.js             # Retrieve role IDs (utility)
├── check-broadcast.js          # Test broadcast functionality (utility)
├── credentials.json            # Google Service Account credentials (not in repo)
├── credentials.example.json    # Example credentials file
├── package.json                # Node.js dependencies
├── .env                        # Environment variables (not in repo)
└── README.md                   # This file
```

### Key Files

- **index.js** - Initializes Discord client, loads commands and events
- **deploy-commands.js** - Registers slash commands with Discord API
- **utils/sheets.js** - Handles all Google Sheets operations
- **utils/calendarSync.js** - Syncs iCal events to Discord scheduled events
- **utils/hourApprovalSync.js** - Polls Hour Verification sheet and sends approval DMs to leadership
- **utils/memberCache.js** - Persistent member data caching system
- **utils/memberEndpoint.js** - HTTP server for Apps Script webhooks (member onboarding, reimbursement requests)
- **utils/reimbursementNotify.js** - Posts the reimbursement request embed to Discord when the webhook fires
- **utils/helpers.js** - Reusable functions and embed builders
- **events/interactionCreate.js** - Handles slash commands, autocomplete, and button interactions (including nickname conflict resolution)

## Dependencies

- **discord.js** (^14.16.1) - Discord API wrapper
- **googleapis** (^144.0.0) - Google Sheets API
- **node-ical** (^0.22.1) - iCal parser for calendar sync
- **dotenv** (^16.4.5) - Environment variable management
- **node-fetch** (^2.7.0) - HTTP requests
- **undici** (^7.16.0) - HTTP/1.1 client
- **eslint** (^9.36.0) - Code linting

## Utility Scripts

### Deploy Commands
```bash
node deploy-commands.js        # Guild deployment (instant)
node deploy-commands.js -g     # Global deployment (1 hour)
```

### List Commands
```bash
node list-all-commands.js      # Show all registered commands
```

### Delete Command
```bash
node delete-command.js         # Remove a specific command
```

### Get Role IDs
```bash
node get-role-ids.js           # List all server role IDs
```

### Check Broadcast
```bash
node check-broadcast.js        # Test broadcast functionality
```

### Generate Broadcast List
```bash
node generate-broadcast-list.js input.csv  # Process CSV for custom broadcast
```
**Purpose:** Extracts names from column B of a CSV file (skipping first 6 rows) and saves to `data/broadcast-list.csv` for use with the `/broadcast` command's Custom CSV option.

## Troubleshooting

### Bot not responding to commands
- Check if commands are deployed: `node list-all-commands.js`
- Verify bot has proper permissions in Discord
- Check console for error messages

### Google Sheets errors
- Verify service account has access to all sheets
- Check that `credentials.json` is in the root directory
- Ensure sheet IDs in `.env` are correct
- Verify sheet tab names match expectations

### Calendar sync not working
- Verify `CALENDAR_ICAL_URL` is accessible
- Check that stage channel ID is correct
- Ensure bot has permission to manage events
- Review console logs for sync errors

### Roles not being assigned
- Check role names match expected patterns
- Verify bot role is above managed roles in hierarchy
- Check bot has "Manage Roles" permission

## Contributing

This bot is developed for Project NexTech's internal use. For questions or issues, contact the Project NexTech development team.

## License

GPL-3.0 License

## Author

Project NexTech Development Team (Daniel) + Claude Sonnet 4.5 and a few other AI models

---
**Last Updated:** June 30, 2026
