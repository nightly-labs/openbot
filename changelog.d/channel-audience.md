### Added

- Channel messages on desktop and web can address a leading set of selected members, or all current channel members with `@all`. Each accepted member gets an independent task from one shared message. Saved acceptance receipts prevent duplicate tasks after a lost response. Unconfirmed requests keep their original input and can be checked or retried explicitly.

- Remote hosts must advertise the new optional audience capability. Older hosts and the current native mobile sender retain plural drafts with an explicit unsupported message instead of sending only to the first member. Existing single-member and lead routing remain available.

- Keep changed attachments and reply targets when a channel audience confirmation arrives. Persist explicit host refusal before releasing an unconfirmed request for correction. Keep late responses in their original channel scope. A partial group Stop retains each peer state and retries only the failed root operation.
