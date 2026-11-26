### Fixed

- A Grok turn no longer ends with "Grok stopped responding" while Grok tries again after an empty model reply. Before, when the model gave only reasoning and no answer, Grok tried again up to 15 times, and OpenBot ended a long turn, such as a daily research routine, after 12 minutes. Now the chat shows "Retry n of 15" and the turn stays open until Grok answers or stops. On a joined server, the server must also be on this version.
