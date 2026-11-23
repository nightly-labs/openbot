### Fixed

- A workflow schedule that an agent sets for you now runs at the time that you asked for. Before, on a
  server, it could run in the server's own time zone, for example one hour late. The schedule uses the
  time zone in Server Settings > Timezone. When that setting is Automatic, it uses the time zone of
  the device that you sent the request from. The trigger card shows the next run in the time zone of
  the schedule, and shows the short name of that time zone when it is not yours. This needs the server
  on the new version too. To correct a schedule that an agent made before this change, ask the agent
  to set the time again.
