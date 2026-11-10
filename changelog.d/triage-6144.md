### Fixed

- An agent import keeps every skill of the export. Before, when two different skills had names that
  OpenBot saw as the same, such as "PPT 制作" and "PPT 审阅", only the last one stayed, and the import
  did not tell you. Now the second skill gets a number after its name, such as "PPT 审阅 2", and the
  import result tells you which skill has the new name.
