### Fixed

- A ChatGPT agent that writes its last words as a short note and then ends its turn with an empty
  answer now shows that note as its answer. Before, the chat or thread showed no answer and no
  error. When the turn has no such note after its last step, the chat shows "ChatGPT ended the turn
  with no answer" (#8837). A joined server needs this version too.
