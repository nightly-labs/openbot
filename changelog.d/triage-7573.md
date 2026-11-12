### Fixed

- An agent that ends its turn in Portuguese with only an announcement, such as "Vou consultar o conector
  agora." or "Estou consultando o conector…", now continues and does the work, as it already did for
  English. English status lines such as "I'm checking the connector now." and "Let me query the
  connector." also continue now. Before, the turn ended with no result, and you had to send a new
  message. An answer that waits for you, names a later time, or would send something still stops.
