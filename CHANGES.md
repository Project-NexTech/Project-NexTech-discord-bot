# Changes Summary

## Recent Updates

### Modified Commands

#### `/requesthours` Command (Updated)

**Previous Behavior:**

- Opened an interactive modal form with 4 fields
- Submitted data to Google Sheets
- Sent notifications to hours review channel

**New Behavior:**

- Shows a button with a link to a Google Form
- No longer uses modal or Google Sheets integration
- Users fill out the external Google Form instead

**Configuration Required:**

- Add `HOURS_FORM_URL` to your `.env` file with your Google Form URL

### New Commands

#### `/verify` Command

**Purpose:** Self-verification for new members

**Who Can Use:**

- Members with the "NT Unverified" role OR "Combined Unverified" role (both configurable)

**How It Works:**

1. User runs `/verify` command
2. Modal form opens with 5 fields:
   - Full Name
   - Grade Level
   - School Name
   - Region/Location
   - Robotics Team & How They Found Us (combined field)
3. Submission is sent to a configured verification channel
4. Verification team is pinged
5. User receives confirmation message

**Configuration Required:**

- `NT_UNVERIFIED_ROLE_ID` - First unverified role ID
- `COMBINED_UNVERIFIED_ROLE_ID` - Second unverified role ID
- `VERIFICATION_CHANNEL_ID` - Channel where submissions are posted
- `VERIFICATION_TEAM_ROLE_ID` - Role to ping when submissions arrive

### New Features

#### Automatic Onboarding Ping

**Purpose:** Welcome new members after Discord onboarding

**How It Works:**

1. Member joins server and completes Discord's onboarding
2. Discord assigns one of the two unverified roles (NT Unverified or Combined Unverified)
3. Bot detects the role assignment
4. Bot sends welcome message with instructions to run `/verify`
5. Message appears in configured welcome channel

**Configuration Required:**

- `NT_UNVERIFIED_ROLE_ID` - NT Unverified role ID (same as for `/verify` command)
- `COMBINED_UNVERIFIED_ROLE_ID` - Combined Unverified role ID (same as for `/verify` command)
- `VERIFY_PING_CHANNEL_ID` - Channel where welcome messages are sent

**Note:** These are the same role IDs used for the `/verify` command - no separate onboarding roles needed!

**Event Handler:** `guildMemberUpdate.js`

## New Files Created

1. **`commands/general/verify.js`** - New self-verification command
2. **`events/guildMemberUpdate.js`** - Detects role changes for onboarding
3. **`CHANGES.md`** - This file

## Modified Files

1. **`commands/hours/requesthours.js`** - Changed from modal to button with external link
2. **`events/modalSubmit.js`** - Removed hours request handling, added verification handling
3. **`.env.example`** - Added new configuration variables
4. **`index.js`** - Added `GuildMembers` intent
5. **`README.md`** - Updated documentation

## Configuration Changes

### New Environment Variables

Add these to your `.env` file:

```env
# Hours Request Google Form
HOURS_FORM_URL=https://forms.google.com/your_form_id

# Role IDs for Verification System
# These roles can run /verify and trigger welcome pings when assigned via onboarding
NT_UNVERIFIED_ROLE_ID=000000000000000000
COMBINED_UNVERIFIED_ROLE_ID=000000000000000000
VERIFICATION_TEAM_ROLE_ID=000000000000000000

# Channel IDs
VERIFICATION_CHANNEL_ID=000000000000000000
VERIFY_PING_CHANNEL_ID=000000000000000000
```

### Removed Environment Variables

- `HOURS_REVIEW_CHANNEL_ID` - No longer needed since hours requests use Google Forms
- `ONBOARDING_ROLE_1_ID` and `ONBOARDING_ROLE_2_ID` - Use NT_UNVERIFIED_ROLE_ID and COMBINED_UNVERIFIED_ROLE_ID instead

## Setup Instructions for New Features

### Setting Up `/verify` Command and Onboarding Pings

1. **Get Role IDs:**
   - Right-click the "NT Unverified" role → Copy ID
   - Right-click the "Combined Unverified" role → Copy ID
   - Right-click the "Verification Team" role → Copy ID
   - Add to `.env` file

2. **Get Channel IDs:**
   - Right-click your verification submissions channel → Copy ID
   - Right-click your welcome/ping channel → Copy ID
   - Add to `.env` file

3. **Configure Discord Onboarding:**
   - Server Settings → Onboarding
   - Set up questions and configure it to assign either "NT Unverified" or "Combined Unverified" role
   - These roles will trigger the welcome ping automatically

4. **Enable Developer Mode:**
   - Settings → Advanced → Developer Mode (if not already enabled)

5. **Test the Flow:**
   - Create a test account
   - Join server
   - Complete onboarding (should receive one of the unverified roles)
   - Verify welcome message appears
   - Run `/verify` command
   - Check verification submission appears in review channel

### Setting Up Hours Request Form

1. **Create Google Form:**
   - Go to Google Forms
   - Create form with fields for:
     - Event name
     - Event date
     - Hours worked
     - Description
   - Get the form URL

2. **Configure Bot:**
   - Add form URL to `.env` as `HOURS_FORM_URL`

3. **Test:**
   - Run `/requesthours` command
   - Click button
   - Verify form opens correctly

## Required Discord Permissions

Make sure your bot has these intents enabled in Discord Developer Portal:

- ✅ `GUILDS` (already required)
- ✅ `GUILD_MEMBERS` **(newly required)**

## Migration Steps

If you're updating from the previous version:

1. **Update dependencies:**

   ```bash
   npm install
   ```

2. **Update `.env` file:**

   - Add all new environment variables listed above
   - Update with your actual IDs

3. **Redeploy commands:**

   ```bash
   node deploy-commands.js
   ```

4. **Restart bot:**

   ```bash
   node index.js
   ```

5. **Verify new features:**
   - Test `/verify` command as an unverified member
   - Test `/requesthours` command (verify form link works)
   - Test onboarding flow with a test account

## Breaking Changes

⚠️ **Hours Request Workflow Changed:**

- Old: Modal form → Google Sheets → Channel notification
- New: Button → External Google Form
- **Action Required:** Create Google Form and configure URL

## Behavioral Changes

### `/requesthours`

- No longer validates input
- No longer logs to Google Sheets directly
- No longer sends channel notifications
- Now provides a cleaner external form experience

### Modal Submission Handler

- No longer handles `hoursRequestModal`
- Now handles `verificationModal`
- Sends verification submissions to configured channel

## Notes

- The `sheetsManager.logHoursRequest()` method in `utils/sheets.js` is no longer used by any commands (but can remain for backwards compatibility)
- All verification data is now posted to Discord channels rather than Google Sheets
- The `/verifyuser` admin command still works as before for team-led verification

## Support

If you encounter issues:

1. Check all environment variables are set correctly
2. Verify role and channel IDs are accurate (18-digit numbers)
3. Confirm `GUILD_MEMBERS` intent is enabled in Developer Portal
4. Check bot has permissions in verification channels
5. Review console logs for error messages
