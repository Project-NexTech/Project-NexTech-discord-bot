# Project NexTech Discord Bot

A comprehensive Discord bot for managing volunteer hours, events, verification, and member engagement for Project NexTech.

## Features

### 📊 Hours Tracking

- **`/hours [@user] [events]`** - View volunteer hours for yourself or another member
- **`/leaderboard [limit]`** - View the top volunteers by hours
- **`/requesthours`** - Get a link to the Google Form for requesting volunteer hours

### 📅 Events Management

- **`/events [department]`** - View upcoming events, optionally filtered by department
- **`/calendar`** - Get the link to the organization calendar

### 📞 Contact Information

- **`/contact [department] [event]`** - View leadership contact information

### ✅ User Verification

- **`/verify`** - Self-verification form for new members (restricted to NT Unverified role)
- **`/verifyuser @user [details]`** - Admin command to verify members and assign roles (restricted to verification team)

## Technology Stack

- **Framework:** discord.js v14
- **Backend:** Google Sheets API via googleapis
- **Runtime:** Node.js 20+
- **Hosting:** Oracle Cloud (recommended)

## Setup Instructions

### Prerequisites

1. **Node.js 20+** installed on your system
2. **Discord Bot** created in the [Discord Developer Portal](https://discord.com/developers/applications)
3. **Google Cloud Project** with Sheets API enabled
4. **Google Service Account** with access to your Google Sheets

### Installation

1. **Clone the repository**

   ```bash
   git clone <your-repo-url>
   cd Project-NexTech-discord-bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure Discord Bot**

   Create a `config.json` file based on `config.example.json`:

   ```json
   {
     "token": "your_discord_bot_token",
     "clientId": "your_client_id",
     "guildId": "your_guild_id"
   }
   ```

   Or use environment variables by creating a `.env` file based on `.env.example`.

4. **Configure Google Sheets API**

   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select an existing one
   - Enable the Google Sheets API
   - Create a Service Account and download the JSON credentials
   - Rename the credentials file to `credentials.json` and place it in the project root
   - Share your Google Sheets with the service account email

5. **Set up Google Sheets**

   Create the following spreadsheets and share them with your service account:

   - **Private Volunteer Sheet** (`VOLUNTEERS_SHEET_ID`)
     - **"Limited Data" tab** - Columns: A (Name), B (Email 1), C (Email 2), E (Discord User ID)
       - Contains sensitive volunteer information (emails, Discord IDs)
       - Emails can be comma-separated for multiple addresses

   - **Public Events Sheet** (`EVENTS_SHEET_ID`)
     - **"San Diego Signups" tab** - Event information
       - Organized by columns (each column = one event)
       - Row 1: Date, Row 2: Day of week, Row 3: Comment, Row 4: Signups
       - Row 5: Course/Department, Row 6: Region, Row 8: Time, Row 9: Hours
       - Row 10: Location, Row 11: Additional note
       - Can also pull upcoming events from Google Calendar
     - **"Member Hours Tracker" tab** - Public volunteer hours
       - Columns: A (Name), K (Total Hours)

   - **Verification Log Sheet** (`VERIFICATION_SHEET_ID`)
     - Columns: Timestamp, Discord ID, Username, Name, Grade, School, Region, Robotics Team, Invite Source, Verified By, IRL Connection
     - Logs all verification submissions from `/verify` command

   Add the spreadsheet IDs to your `.env` file.

6. **Deploy slash commands**

   ```bash
   node deploy-commands.js
   ```

7. **Start the bot**

   ```bash
   node index.js
   ```

### Discord Bot Permissions

Your bot needs the following permissions:

- `Read Messages/View Channels`
- `Send Messages`
- `Embed Links`
- `Manage Roles` (for verification)
- `Read Message History`

Required intents:

- `GUILDS`
- `GUILD_MEMBERS` (enable in Developer Portal)

## Project Structure

```text
.
├── commands/
│   ├── admin/
│   │   └── verifyuser.js
│   ├── events/
│   │   └── events.js
│   ├── general/
│   │   ├── calendar.js
│   │   ├── contact.js
│   │   └── verify.js
│   └── hours/
│       ├── hours.js
│       ├── leaderboard.js
│       └── requesthours.js
├── events/
│   ├── guildMemberUpdate.js
│   ├── interactionCreate.js
│   ├── modalSubmit.js
│   └── ready.js
├── utils/
│   ├── helpers.js
│   └── sheets.js
├── .env.example
├── config.example.json
├── credentials.example.json
├── deploy-commands.js
├── index.js
├── package.json
└── README.md
```

## Configuration

### Environment Variables

All configuration can be done via `.env` file:

```env
# Bot Authentication
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id

# Google Sheets
VOLUNTEERS_SHEET_ID=spreadsheet_id
EVENTS_SHEET_ID=spreadsheet_id
LEADERSHIP_SHEET_ID=spreadsheet_id
VERIFICATION_SHEET_ID=spreadsheet_id
REQUESTS_SHEET_ID=spreadsheet_id

# URLs
CALENDAR_URL=your_calendar_url
HOURS_FORM_URL=your_hours_request_google_form_url

# Role IDs for Verification System
# These roles can run /verify and trigger welcome pings when assigned via onboarding
NT_UNVERIFIED_ROLE_ID=role_id
COMBINED_UNVERIFIED_ROLE_ID=role_id
VERIFICATION_TEAM_ROLE_ID=role_id

# Channel IDs
VERIFICATION_CHANNEL_ID=verification_submissions_channel_id
VERIFY_PING_CHANNEL_ID=welcome_ping_channel_id
```

## Commands Reference

### For All Members

| Command | Description | Parameters |
|---------|-------------|------------|
| `/hours` | View volunteer hours | `@user` (optional), `events` (optional, default: 10) |
| `/leaderboard` | View hours leaderboard | `limit` (optional, default: 10) |
| `/requesthours` | Get hours request form link | None (shows button with Google Form link) |
| `/events` | View upcoming events | `department` (optional) |
| `/calendar` | Get calendar link | None |
| `/contact` | View leadership contacts | `department` (optional), `event` (optional) |
| `/verify` | Submit self-verification | None (opens modal form, NT Unverified role required) |

### For Verification Team / Leadership

| Command | Description | Access |
|---------|-------------|--------|
| `/verifyuser` | Verify new members | Verification Team, EC, Leadership, Administrators |

## Google Sheets Integration

The bot automatically syncs with Google Sheets for:

- ✅ Volunteer hours tracking
- ✅ Event management
- ✅ Leadership directory
- ✅ Verification logs
- ✅ Hours requests

Make sure your sheets follow the column structure outlined in the setup instructions.

## Deployment

### Production Deployment (Oracle Cloud)

1. Set up an Oracle Cloud VM instance
2. Install Node.js and npm
3. Clone your repository
4. Install PM2: `npm install -g pm2`
5. Start the bot: `pm2 start index.js --name nextech-bot`
6. Save PM2 config: `pm2 save`
7. Set PM2 to start on boot: `pm2 startup`

### Alternative: Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "index.js"]
```

## Troubleshooting

### Bot doesn't respond to commands

- Verify slash commands are deployed: `node deploy-commands.js`
- Check bot has proper permissions in the server
- Ensure `GUILDS` intent is enabled

### Google Sheets errors

- Verify service account has access to all sheets
- Check spreadsheet IDs in `.env` are correct
- Ensure `credentials.json` is in the root directory

### Permission errors on `/verifyuser`

- User must have one of: Verification Team, EC, Leadership roles, or Administrator permission

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC

## Support

For issues or questions, contact the Technology Department leadership.

## Future Features

- [ ] Automated DM reminders for events
- [ ] Email integration via Google Apps Script
- [ ] Google Calendar API integration
- [ ] Reaction tracking for announcements
- [ ] Automated onboarding flows
- [ ] Event signup system
