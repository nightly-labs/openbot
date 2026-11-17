### Fixed

- A list of workflows, workflow runs, routines, threads, browser proxies or CRM records now opens
  when one saved row has a value that this version does not know, and the other routines still run
  on time. Before, that one row stopped the whole list or the routine timer. OpenBot now leaves the
  row out, keeps it unchanged in the database, and writes a warning to the log. On a joined server,
  the server must also be on this version.
