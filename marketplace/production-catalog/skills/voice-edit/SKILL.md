---
name: "Voice Edit"
description: "Edit a draft so that it sounds human and sounds like the user. Learns the voice from 1 to 3 samples of the user's own writing, removes filler and stock phrases, keeps every fact, number and claim, and adds no new facts. Returns the edited text and a change log with the reason for each change."
---

# Voice Edit

## When to use

- A draft (email, post, page, announcement) reads stiff, generic, or machine-written.
- The user wants text to match their own voice.
- Not for research or fact checks. Unsupported claims are flagged, not fixed. Use Evidence Brief to check them.

## Inputs

1. **The draft.** Paste path: text or a file the user gives. Tool path: a document in a signed-in tab in
   `openbot_browser`, or an installed plugin found with `tool_search` (Notion, Atlassian). Read only.
2. **Voice samples.** 1 to 3 pieces that the user wrote, of 150 words or more in total. The user can paste them or
   point to their published pages or sent mail in a signed-in tab. If there are none, ask once with `ask_user`:
   "Paste 1 to 3 samples of your writing, or should I use a plain neutral voice?"
3. **Audience and channel**, if the draft does not make them clear.

## Steps

1. Read the samples. Write short voice notes: sentence length, person (I, we, you), contractions, formality,
   punctuation habits, words the user uses often, and words they never use. Offer to `remember` the notes.
2. Read the draft. List every fact, number, name, date, link and claim. This list must survive the edit.
3. Edit, one change type at a time: cut filler, replace stock phrases, shorten long sentences, make the actor
   clear, match the voice notes.
4. Check the fact list against the edited text. Every item is present and unchanged in meaning.
5. Flag claims that look unsupported (a superlative, a number with no source, a promise). Leave them as they are.
6. Write the change log. Group repeated changes of one type into one row.

## Rubric

Each change has one reason from this list:

- **Filler:** words that add nothing ("really", "in order to", "it is important to note that").
- **Stock phrase:** a phrase that many machine or template texts use ("I hope this message finds you well",
  "in today's fast-paced world", "unlock the full potential").
- **Wordy:** the same meaning in fewer words.
- **Hidden actor:** passive voice that hides who does what.
- **Off-voice:** does not match the voice notes.
- **Clarity:** the order or the reference was unclear.
- **Grammar:** a real error.

Rules: no new facts, examples, numbers or quotes. No change of meaning. Keep the user's technical terms and names.
If the edit changes length by more than 30%, say so.

## Output

````
Voice notes: short sentences, "we", contractions, no exclamation marks, says "customers" not "users".

Edited text
```
<edited text>
```

Change log
| # | Original | Change | Reason |
| 1 | "We are excited to announce that we have launched" | "We launched" | Stock phrase |
| 2 | "Reports can be exported by admins" | "Admins can export reports" | Hidden actor |

Flags (not changed)
- "the fastest tool on the market": no source in the draft. Confirm or remove.

Length: 412 to 296 words (-28%).
````

## Approvals and stop conditions

- Do not overwrite the source document, post, or send. Give the edited text. Replace it in the document only on
  the user's yes.
- Do not use someone else's writing as a voice sample without saying whose it is.
- Stop and ask if a change would need a fact you do not have.

## Common failures

- Removing a number or a qualifier ("in most cases") to make a sentence shorter.
- Adding a vivid example that the user never gave.
- Replacing one stock phrase with another.
- A change log that says "improved flow" instead of a reason from the list.
- Removing the user's own habits (a favorite word, short fragments) because a general style rule says so.
