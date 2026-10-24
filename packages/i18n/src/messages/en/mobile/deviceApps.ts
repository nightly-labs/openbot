import { defineMessages } from "../../../message";

export const messages = defineMessages("mobile.deviceApps", {
  "mobile.deviceApps.title": "Connected apps",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Let your agents use these apps on this iPhone. When you turn on an app, the iPhone asks for its permission. While an app is off, OpenBot asks the first time an agent uses it.",
  "mobile.deviceApps.writes": "Adding items",
  "mobile.deviceApps.writesFooter":
    "Until you choose Always, OpenBot asks before an agent adds an event or a reminder.",
  "mobile.deviceApps.app.calendar": "Calendar",
  "mobile.deviceApps.app.reminders": "Reminders",
  "mobile.deviceApps.app.contacts": "Contacts",
  "mobile.deviceApps.app.location": "Location",
  "mobile.deviceApps.app.denied": "{app} (denied)",
  "mobile.deviceApps.write.calendar": "Add events without asking",
  "mobile.deviceApps.write.reminders": "Add reminders without asking",
  "mobile.deviceApps.osDenied": "Allow {app} in iPhone Settings",
  "mobile.deviceApps.consent.heading": "Allow {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "An agent wants to read events in your Calendar.",
  "mobile.deviceApps.consent.calendarAddEvent": "An agent wants to add this event to your Calendar: {title}",
  "mobile.deviceApps.consent.remindersList": "An agent wants to read your Reminders.",
  "mobile.deviceApps.consent.remindersAdd": "An agent wants to add this reminder: {title}",
  "mobile.deviceApps.consent.contactsFind": "An agent wants to look up people in your Contacts.",
  "mobile.deviceApps.consent.locationCurrent": "An agent wants to know where you are, to about 100 meters.",
  "mobile.deviceApps.consent.privacy": "What the agent reads goes to its computer and can reach its model provider.",
  "mobile.deviceApps.consent.once": "Allow once",
  "mobile.deviceApps.consent.always": "Always allow",
  "mobile.deviceApps.consent.deny": "Deny",
});
