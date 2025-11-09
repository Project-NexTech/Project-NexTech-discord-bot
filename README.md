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
Send a direct message to all NT Members.

**Permissions:** NT Executive Committee only  
**Cooldown:** 5 minutes  
**Options:**
- `message` (required) - The message to broadcast
- `confirm` (required) - Must be set to `True` to confirm sending

**Features:**
- Sends embeds with sender information
- Tracks success/failure counts
- Reports delivery statistics
- Rate-limited to avoid API limits

---

#### `/syncroles`
Synchronize NT Enrolled/Unenrolled roles based on membership status from Google Sheets.

**Permissions:** NT Executive Committee or Administrator  
**Cooldown:** 60 seconds

**Functionality:**
- Fetches membership status from Google Sheets
- Assigns "NT Enrolled" role to active members (Member, New Member, Paused)
- Assigns "NT Unenrolled" role to inactive members (Not a Member)
- Skips users with "NT Board Member" role
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
View contact information for department leadership.

**Cooldown:** 5 seconds  
**Options:**
- `department` (required) - Choose from:
  - Engineering
  - Mentoring
  - Programming
  - Physics/Math
  - Natural Sciences
  - Marketing
  - Logistics
  - Policy/Intl
  - EC (not sure?)

**Features:**
- Fetches contacts from Google Sheets
- Displays name, role, Discord mention, email
- Formatted in clean embeds

---

#### `/contactforevent`
Get contact information for leadership of an upcoming event.

**Cooldown:** 5 seconds

**Features:**
- Shows dropdown of upcoming events
- Select an event to view department contacts
- Displays event details and department leadership info
- Interactive select menu with 60-second timeout

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
- Fetches data from "Member Hours Tracker" sheet
- Formatted with timestamps

**With `requests` parameter:**
- Displays recent hour verification requests
- Shows the most recent N requests (sorted by submission order)
- Fetches data from "Hour Verification" sheet
- For each request, displays:
  - Request number (row in sheet)
  - Hours requested
  - Approval status (✅ Approved, ⏳ Pending, ❓ Other)
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
  - Column C: Verdict (Approved/Denied/Pending)
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

# Google Sheets IDs
VOLUNTEERS_SHEET_ID=sheet_id
EVENTS_SHEET_ID=sheet_id
LEADERSHIP_SHEET_ID=sheet_id
VERIFICATION_SHEET_ID=sheet_id

# URLs
CALENDAR_URL=your_calendar_url
CALENDAR_ICAL_URL=your_ical_url
HOURS_FORM_URL=your_hours_form_url
INFO_SESSION_BANNER_URL=path_or_url_to_banner

# Feature Flags
CHECK_LEFT_USERS_ENABLED=false
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
- **Tab:** `San Diego Signups`
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

- **Tab:** `Member Hours Tracker`
  - Column A: Name
  - Column K: Total Hours

- **Tab:** `Membership Status`
  - Column A: Name (starts at row 10)
  - Column B: Status (Member, New Member, Paused, Not a Member, Unknown)

#### Leadership Sheet (`LEADERSHIP_SHEET_ID`)
- **Tab:** `Sheet1`
- **Columns:** Name (A), Department (B), Email (C), Discord Username (D), Discord User ID (E), Role/Note (F)

#### Verification Sheet (`VERIFICATION_SHEET_ID`)
- **Tab:** `#nextech-verify`
- **Columns:** Discord ID (A), Name (B), Grade (F), School (G), Region (H), Robotics Team (I), Invite Source (J)

### Role Naming Conventions

The bot expects the following role names (case-insensitive):
- `NT Member`
- `NT Enrolled`
- `NT Unenrolled`
- `NT Board Member`
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

### Authentication
Uses Google Service Account authentication with OAuth 2.0. The service account must have:
- Read access to all data sheets
- Write access to verification sheet
- Spreadsheets API scope: `https://www.googleapis.com/auth/spreadsheets`

## Automated Features

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
  - Persists mapping in `event-mapping.json`

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

## Project Structure

```
Project-NexTech-discord-bot/
├── commands/
│   ├── admin/
│   │   ├── broadcast.js        # Broadcast messages to all members
│   │   ├── syncroles.js        # Sync enrollment roles from Sheets
│   │   └── verifyuser.js       # Manually verify new members
│   ├── events/
│   │   └── events.js           # View upcoming events
│   ├── general/
│   │   ├── calendar.js         # Get calendar link
│   │   ├── contact.js          # View department contacts
│   │   ├── contactforevent.js  # Get event contacts
│   │   └── verify.js           # Self-verification form
│   └── hours/
│       ├── hours.js            # View volunteer hours
│       ├── leaderboard.js      # Hours leaderboard
│       └── requesthours.js     # Get hours request form
├── events/
│   ├── ready.js                # Bot startup and initialization
│   ├── interactionCreate.js   # Handle commands and autocomplete
│   ├── modalSubmit.js          # Handle verification modal
│   ├── messageCreate.js        # Forward DMs to verification
│   └── guildMemberUpdate.js    # Welcome new unverified members
├── utils/
│   ├── sheets.js               # Google Sheets API integration
│   ├── calendarSync.js         # Calendar synchronization
│   └── helpers.js              # Utility functions and embed builders
├── index.js                    # Main bot entry point
├── deploy-commands.js          # Command deployment script
├── delete-command.js           # Remove commands (utility)
├── list-all-commands.js        # List deployed commands (utility)
├── get-role-ids.js             # Retrieve role IDs (utility)
├── check-broadcast.js          # Test broadcast functionality (utility)
├── credentials.json            # Google Service Account credentials (not in repo)
├── credentials.example.json    # Example credentials file
├── event-mapping.json          # Calendar event ID mapping
├── package.json                # Node.js dependencies
├── .env                        # Environment variables (not in repo)
└── README.md                   # This file
```

### Key Files

- **index.js** - Initializes Discord client, loads commands and events
- **deploy-commands.js** - Registers slash commands with Discord API
- **utils/sheets.js** - Handles all Google Sheets operations
- **utils/calendarSync.js** - Syncs iCal events to Discord scheduled events
- **utils/helpers.js** - Reusable functions and embed creators

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

Project NexTech Development Team + Claude Sonnet 4.5

---

**Version:** 1.0.0  
**Last Updated:** October 31, 2025
