### Changed

- The OpenBot card in the Apple Watch Smart Stack and the OpenBot complications show only the server that you chose in the watch app. The card shows one agent: the agent that waits for you, else the agent with the newest update. The card keeps that agent until another agent has an update. When a new message arrives, the iPhone sends it to the watch at once, so the card and the complications change sooner. The card has the color and the picture of the agent, its state and its current line. An orange "+N" shows how many other agents wait for you, and a blue "+N" how many other chats have unread messages. A tap opens the agent.
- The OpenBot complications on the watch face show the OpenBot eyes. The eyes open wide when an agent waits for you, look to the side while agents work, and the circular complication shows the number of agents that wait, or in blue the number of chats with unread messages. The corner label is short: the number that waits, the number of unread chats, "Working" or "All clear".
- With more than one server, you can add an OpenBot card or complication for each server: choose "OpenBot · <server>" when you add it. "OpenBot" alone follows the server that you chose in the watch app. The card shows the server name after the state.

### Removed

- The one-line OpenBot complication at the top of some watch faces. Choose the circular or the corner OpenBot complication in its place.
