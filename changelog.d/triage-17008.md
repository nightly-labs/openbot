### Fixed

- An OpenCode agent gets the tools of an app again after the app's connection breaks, for a signed-in app and for an app that runs on this computer. Before, the agent said that the tools did not exist while the app's test said "ready", and only a restart helped. Now, when you turn the app off and on in Marketplace, Apps, the agent connects to the app again from its next message. For a signed-in app, a test that says "ready" also does this. For an agent on a server, the server must also be on this version.
