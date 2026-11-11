### Fixed

- A scheduled channel routine with nothing new to report now ends quietly: the channel gets no
  message and no notification. Before, the agent got the error "Use this tool only in a routine run",
  and it often posted a "no change" message in the channel. A Test run still shows the answer, and a
  member that works on a part of the run gives its result to the owner of the request, as before.
