### Fixed

- When Cursor's server stopped accepting the sign-in of its running process, every Cursor agent answered only "Please sign in to continue" until you restarted OpenBot, also when Cursor was still signed in. Now the turn fails with a clear message, OpenBot starts Cursor again, and your next message works. If Cursor is really signed out, Cursor asks you to sign in.
