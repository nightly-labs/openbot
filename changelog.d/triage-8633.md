### Fixed

- In a website editor, an agent's click on a link or button could go to the item next to it, and
  the click still showed as done. This happened when the page moved its text as the pointer came
  near, for example to show a block toolbar. Now OpenBot stops that click before the page gets it,
  finds the item again, and clicks it. On a joined server, the server must also have this version.
