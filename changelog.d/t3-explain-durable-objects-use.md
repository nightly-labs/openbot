### Fixed

- The account service no longer slows down as a server collects ended connections. Before, each new
  phone or browser connection to a server read every connection that server ever had, and removing
  members from a server read every connection of every server.
