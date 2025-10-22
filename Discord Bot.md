
# Discord Bot

Framework: discord.js

Hosting: [Oracle Cloud](https://www.oracle.com/cloud/free/)

Onboarding new people, sending out announcements (or mass DMs if needed), replacing the calendar bot, as part of the verification for NT members, sending the pinned messages in department channels so the entire EC could edit it anytime (add a discord account based verification to determine if the user is an EC member or not). Maybe also pinging Daniel and Shounak whenever someone submits a form. Hours request from

Based on hours and volunteers backend

- Command to show hours tracking  
  - Requires a more developed backend that organizes hours by member  
    - Probably comprised of a ton of Volunteer objects that have properties of Event objects (basically each event that people volunteered at)  
  - Hours leaderboard

**Hours Command: /hours \[@user\] \[events\]**  
Parameters:  
\- @user: Defaults to the message sender if value not specified, otherwise includes a ping with a user ID  
\- events (int): Defaults to the value of 10, is the number of past events   
Fetches:   
1\. Parse the volunteer database to find the UUID of the volunteer based on their Discord user ID  
2\. Parse the volunteer database to find their recent events  
Example Response:

- DM functionality  
  - Pushing individual messages (tasks, awards, hour confirmation, etc.)  
  - Automated reminders for missing hour requirements  
  - Reminders for news announcements (opt out)  
  - Personalized reminders for events (opt in)  
- Track reactions on the \#nt-news messages

Based on leadership structure backend

- Option to show which people to contact

Request Hours Command: /requesthours

Contact Command: /contact \[department\] \[event\]  
Parameters:  
\- department: Defaults to departments the sender is in (based on roles)  
\- event: optional, shows the people associated with the event  
Fetches:  
Example Response:

Based on events backend

- Command for upcoming (volunteering) events  
- Get meeting information and links through the bot  
- Backend for tracking contacts with libraries

Events Command: /events \[department\]  
Parameters:  
\- department: Default to all upcoming events, department to retrieve the events from  
Fetches: Retrieves the upcoming events in a certain department  
Example Response:  
Upcoming Events for \[department\]:

- \[dept ID\].\[course ID\] \[course name\] at \[library\] on \[date\&time\]  
- Continue list…

No backend required (other than text fields)

- Command to run for new members that has information to help new people after verification (basically the thing that we kept copy pasting initially)  
- Managing new joins and sending them a tailored message

API integration

- Google Calendar linkage to provide more tailored updates and pings to people  
- Email functionality  
  - Sending reminders to program hosts about upcoming programs 48 hours ahead of time  
  - Sending automated reminder

Calendar Command: /calendar  
Parameters: None  
Example Response:  
Here is the link to the calendar: \[link\]

Verify user command: **/verifyuser \[@user\]** \[name\] \[grade\] \[school\] \[region\] \[robotics team\] \[invite source\]  
Parameters: The parameters are used to assign roles and add to the verification log sheet via the Google Sheets API. Additional parameters are optional but a warning will be shown if they are not entered. If the user has the combined unverified role it will ask the verifier if they know if the person has an IRL connection to an existing server member. This command should only run for users with a certain role. If a user without that role or Administrator permissions in the server attempts to run the command it should return an error message.
Example response:

Additional functionality can include DMming members about needing to log hours (along with the email from Google Apps Script)

Linking the discord bot code to an API to use Google Apps Script would be really helpful.