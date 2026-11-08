### Changed

- In a channel, a greeting, a question about the channel or an unclear message goes to the lead, which
  can ask what you mean. Before, the Coordinator could answer it itself and stop the task.
- Channel members do the work they get themselves. They give work to another member only when you
  ask for that member or for help, or when a part clearly needs another member's role.
- A channel that you opened recently shows its messages at once when you open it again, without
  Loading.
- A stopped task in a channel shows its owner and the start of the request, so you can tell several
  stopped tasks apart.
- When channel members pass a task between them too many times, the card names them and says that
  the task stopped to prevent a loop. Before, it said "The automatic assignment limit was reached",
  in English only.
- With the Natural response style, a channel member's progress note, such as "I'll check the shared
  folder first", and its answer show as separate messages, as in an agent chat. Each message shows
  once, when it is complete. Before, the text grew in the channel while the member wrote it.
- Channel members no longer start a message with their own name, such as "Research: ..." or
  "Launch check: ...". The chat already shows the name above each message.
- In a channel, the activity line folds away when the work stops. Before, it went at once and the
  messages above jumped.
- A new message in a channel slides in, as in an agent chat. Before, channel messages appeared in
  one frame. With the Natural response style, the message enters with all of its text. Its words do
  not fade in one by one, so a complete answer does not look as if it still arrives.
- When the lead gives parts of one request to several channel members, the desktop app shows one
  row, such as "Assigned to Chief, Builder and Launch". Before, it showed one row for each member.
- A channel member answers in the channel while it works in its own chat, as in a side thread.
  Before, the channel waited until the chat turn ended, and the chat waited for channel work. An
  agent still does one channel task at a time. Agents whose provider runs one turn at a time keep
  the old order.
- When one channel member stops while others work, its face shrinks out of the activity line and
  the other faces close the gap. The line keeps its label until all work stops.

### Fixed

- A channel message that starts with a quote and then an @mention now goes to the mentioned member.
  Before, the mention was ignored and the lead chose who answers.
- A channel message that starts with several typed names, such as "@Ana @Ben", now goes to each of
  them. Before, only the first name counted.
- A channel member that you name in a message, such as "thanks @Ana", now answers. Before, routing
  could decide that the message needed no answer.
- Channel members no longer get the narration of a turn that already has an answer. This makes
  channel turns use fewer tokens.
- Work in another channel no longer makes the open channel read its messages again on each update.
- The "New" line in a channel no longer moves to each answer that comes while you read the channel.
  It stays where it was when you opened the channel, as in an agent chat.
- A message that you send in a channel shows once. Before, it could show twice for a moment after
  you pressed Enter.
