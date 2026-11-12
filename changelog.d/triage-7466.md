### Fixed

- A WhatsApp message that you send while OpenBot is away now gets an answer when OpenBot connects
  again. This includes the time when the computer sleeps, when OpenBot is closed, or when the
  connection stops. Before, OpenBot ignored each such message that was older than 1 minute, with no
  reaction and no reply. Messages up to 20 minutes old get an answer. A number that you link for the
  first time still does not answer its old chats. For a number on a joined server, the server must
  also be on the new version. (#7466)
