### Fixed

- Agents no longer say that you stopped their work when OpenBot stopped it. Before, when OpenBot
  ended a turn by itself, for example after a long silence, a repeated failed step or a move to a
  backup model, the agent read the stop as yours and asked you for permission to continue. Now
  the agent's next message tells it that OpenBot stopped the turn and why.
