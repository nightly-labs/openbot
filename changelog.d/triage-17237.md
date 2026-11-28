### Fixed

- OpenBot no longer freezes for seconds at a time after a start when it has long chats. The background clean-up of old chat events now works in short steps of about 25 ms, rests between them, starts 1 minute after the app opens, and does not clean up a chat again within 5 hours after a restart. A server must be on this version to get the fix.
