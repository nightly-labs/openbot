### Fixed

- A large attachment on a slow connection no longer stops at the same point with "The attachment upload timed out." Before, a file of about 14 MB on an upload of less than about 2 Mbit/s stopped after one minute, and each retry stopped again. Now the upload continues while the server reports that it receives the file, and it stops only when the server reports no progress for one minute.
