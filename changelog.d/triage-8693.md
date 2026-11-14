### Fixed

- When an agent saved a new skill whose name differed from a saved skill only in its non-Latin
  text, such as "da Vinci 投放工作手册" and "da Vinci 回复格式与语气", OpenBot refused it with "A
  local skill with this name already exists. Revise it instead." That text was wrong, and revising
  would replace the other skill. Now the message names the saved skill and says to change the Latin
  letters or digits in the new name.
