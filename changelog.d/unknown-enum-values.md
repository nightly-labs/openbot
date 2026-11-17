### Fixed

- A list of workflow runs, workflow versions, routines, threads, browser proxies or CRM records now
  opens when one saved row has a value that this version does not know. Before, that one row stopped
  the whole list. OpenBot now leaves the row out, keeps it unchanged in the database, and writes a
  warning to the log. On a joined server, the server must also be on this version.
