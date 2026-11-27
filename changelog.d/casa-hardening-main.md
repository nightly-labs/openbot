### Security

- When you sign out of your account in the desktop app or on a server, the account service now also stops the credential of each server that this computer registered. Before, only the copy on the computer was deleted, and the account service still accepted that credential. When you sign in again, the server gets a new credential, and your team members keep their access.
- When you sign out in the web app, or your session ends, the browser now deletes your unsent message drafts and an open edit of a queued message. Before, they stayed in the browser after sign-out. The desktop app keeps your drafts as before.
- The account service now tells browsers to use only HTTPS on all of its answers, not only on its pages.
- Dependencies with known high-severity flaws are updated.
- Logs now also hide Google refresh tokens.
