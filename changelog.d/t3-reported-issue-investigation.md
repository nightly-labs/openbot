### Added

- Webhook routines accept Standard Webhooks requests, such as Composio, Svix, Clerk, and Resend send.
  To use the signing secret that the sender made, select **Use the sender's secret** in the routine
  editor or on the chat card. Filters can read the complete request, for example
  `/metadata/trigger_slug` for a Composio trigger.

### Changed

- Agents ask for a password for a script or a local service, such as an IMAP or Proton Mail Bridge
  password, with the secure key request. They do not ask for it in chat.
