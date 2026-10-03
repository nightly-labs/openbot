### Fixed

- A phone or another peer that cannot see an agent (a custom ACP agent before protocol 5, or a
  Cursor agent on any protocol) now gets the channel list when one of the channels is led by that
  agent. Before, the whole list failed and the phone showed no channels. The channel shows with
  the members the peer can see and no lead.
- Saving such a channel from that peer, for example a rename, keeps the hidden members and the
  hidden lead. A lead the peer picks itself still wins.
