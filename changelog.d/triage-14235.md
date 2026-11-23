### Fixed

- A page in the agent browser that stops answering, for example because its script never ends, no
  longer blocks the tab. Before, the agent could not read the page, and Reload, Back, Forward and a
  new address also failed, so only closing the tab helped. Now Reload and the other navigation
  controls, in the Browser panel and for the agent, stop the stuck page and load the new one. When
  the agent cannot read a stuck page, it now learns that the page does not answer and that a reload
  fixes it, so it can tell you. On a joined server, the server must also be on the new version.
