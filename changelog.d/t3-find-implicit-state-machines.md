### Fixed

- A removed server member stays removed when another admin changes their role at the same time. Before, the role change could make the member active again.
- A voice recording that started after the microphone stopped the previous one by itself now runs to the full time limit. Before, it could stop early.
- Stop now ends an agent turn after a short wait even when the agent does not answer the stop request. Before, the turn could stay open.
- On Windows, OpenBot works normally after another app cancels a sign-out or shutdown. Before, closing the window then quit OpenBot instead of keeping it in the background.
- When you select other text while an instruction for a selection is being sent, the new selection keeps its action bar. Before, the result of the first send could close the bar or show an error on it.
- An attachment download from a server that the server stops, or that arrives damaged, now fails at once. Before, it waited one minute for a timeout.
- A hosted server that you wake no longer goes back to "stopped" for a short time. Before, a status check that started before the wake could replace the "waking" state and send the start request again.
- A connection to a server now fails at once when the server disconnects during the connection handshake. Before, the app waited 30 seconds before it showed the error or tried again. Also, the app no longer starts new server connections while it quits.
- A hosted server that you join again no longer shows "Starting" for a long time. Before, a wake reply that arrived while the server was being removed left a start that never ended.
