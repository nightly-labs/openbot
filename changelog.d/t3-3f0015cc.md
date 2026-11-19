### Added

- A schedule trigger in a workflow now gives the time of its run to the next steps, in UTC and in the time zone of the trigger. A model step can now calculate its time window, such as "the 24 hours before this run". Before, the trigger gave no text. A manual run of a schedule trigger gives the time that it started. A joined server must also be on the new version for its runs to get the time.
