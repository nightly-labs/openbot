### Changed

- A hidden agent keeps working. It gets messages, runs its routines and does channel work while it is
  out of the list, so you can hide a backup or cleanup agent and leave it to its work. It shows in
  "Needs you" when it waits for an answer or an approval, and by default it notifies only then. Agents
  that you hid before this version had their routines stopped: OpenBot turns those routines off one
  time at the update, and you turn on the ones that you want. Their queued messages run at the update.
  It works on this computer, on a joined server and in the web client. A joined server must also be on
  the new version; an older server shows a hidden agent as paused, as before.
