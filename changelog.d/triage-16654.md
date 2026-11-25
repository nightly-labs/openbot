### Fixed

- When an agent script on a site stops OpenBot from filling a saved login, the agent now learns which tab holds the script: a tab of another agent, a tab that you opened, or one of its own tabs. It can then ask you to close that tab in the Browser panel, instead of reloading the page again and again with no result. When no other tab holds the script, the agent reloads the page and tries again. The saved-login card now also says to close the other tabs of the site. A joined server must also be on the new version.
