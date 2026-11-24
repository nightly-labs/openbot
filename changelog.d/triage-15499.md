### Fixed

- The `$` skill picker now shows a skill whose `SKILL.md` was saved as "UTF-8 with BOM", as some Windows editors do. Before, OpenBot left out such a skill from your user skills folder without a message, and showed "SKILL.md must begin with YAML frontmatter." for such a skill in a workspace folder, although the file had the header.
