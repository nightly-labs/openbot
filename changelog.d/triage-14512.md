### Fixed

- An agent with backup models set to switch without asking now continues an unfinished task on its backup model when a dropped connection or a timeout stops the task after it started work. Before, the task stopped with an error, and you had to send the message again.
