### Fixed

- A workflow condition with a rule in a language other than English now takes its branch. Before, the model could answer in the language of the rule, and the run stopped with "The model did not answer yes or no.". The condition now asks for an English answer, and it also accepts "true" and "false".
