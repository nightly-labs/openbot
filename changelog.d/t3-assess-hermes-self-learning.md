### Added

- Agents now learn skills by themselves. After a correction or a method that worked, the background
  memory review saves what the agent learned as a new skill, or adds it to one of the agent's own
  skills. The chat shows "Created skill" or "Revised skill".
- Server settings > General > Agents > Skill learning: choose Automatic (the default), Ask first, or
  Off. With Ask first, the agent offers to save the skill; click Save on the offer, or answer yes.
  Save writes the skill in the background, so it costs a small part of a full agent reply. The offer
  and Save also work on a joined server and in the web client.
- With Automatic, an agent now fixes its own skill while it works: when you correct how it follows the skill, or a
  step fails and it finds the fix, it saves a new revision and starts to use it. The chat shows
  "Revised skill". Ask the agent to undo the change, and it goes back to the revision before.

### Changed

- When you correct how an agent does a task, it applies the correction at once and does not stop to
  save a memory. The background review keeps the lesson, so the reply comes sooner and costs fewer
  tokens.

### Fixed

- An agent can now create or revise a skill when its description has a colon, such as "Use when:
  ...". Before, the save failed and the agent had to try again.
- A skill can now have a name with no Latin letter, such as a name in Japanese. Before, the save
  failed.
