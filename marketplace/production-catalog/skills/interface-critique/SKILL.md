---
name: "Interface Critique"
description: "Review a screen and return ranked, concrete fixes across hierarchy, layout, type, color and contrast, copy, states and accessibility. Works from a screenshot, a page in the browser, or a Figma frame. Never edits files."
---

# Interface Critique

## When to use

- When the user wants to know what to fix on a screen or a short flow, and in what order.
- Before a design review, or after a build looks wrong.
- Not for a full accessibility audit (use Accessibility Audit) or a build spec (use Build Spec).

## Inputs

1. **The screen.** In this order:
   - A page in `openbot_browser`. Call `openbot_browser.list_tabs` first. Use an open tab or open the address.
   - A Figma frame: an installed Figma plugin (find it with `tool_search` in the `openbot` tools), or a
     signed-in Figma tab in `openbot_browser`.
   - A screenshot or exported image the user uploads.
2. **The user task.** What must a person do on this screen? If it is not clear, ask once with `ask_user`.
3. A static image shows layout, type and color. It does not show focus, keyboard or screen-reader behavior.
   Mark findings about those as "not tested".

## Steps

1. Write the task in one sentence. Write what the user must notice, decide and do, in order.
2. Take one screenshot of the screen as reviewed. For a live page, also check the mobile width with
   `openbot_browser.set_environment`.
3. Review each area: hierarchy, layout and spacing, type, color and contrast, copy, states (empty, loading,
   error, success, disabled), accessibility.
4. For each problem, write: where (region and element), what is wrong, why it matters for the task, and the
   concrete change. Give exact values or words where you can: "raise the label to 14 px", "rename Submit to
   Create invoice".
5. Measure contrast on a live page from computed colors. On an image, give it as an estimate.
6. Score each fix with the rubric. Rank. Keep the top 10; list the rest as one line each.

## Rubric

- **Impact 3:** blocks the task, misleads, or fails contrast. **2:** slows or confuses. **1:** polish.
- **Effort 1:** copy or one style value. **2:** one component. **3:** layout or flow change.
- Rank by impact, highest first. With equal impact, lower effort first.
- A finding with no task consequence is taste. Leave it out, or put it under "Optional" with that label.

## Output

```
Screen: <name or address> — Task: <one sentence> — Source: <tab, Figma frame, or image>

| # | Impact | Effort | Where | Problem | Why it matters | Change |
| 1 | 3 | 1 | Primary button, footer | Grey on grey, contrast about 2.1:1 | Users miss the main action | Use the primary color; reach 4.5:1 |
| 2 | 2 | 1 | Page title | "Dashboard" says nothing about the task | Users do not know where they are | "Unpaid invoices" |

Not tested: <keyboard, focus, screen reader, other states>
Optional: <taste items, labeled>
```

Attach the screenshot with `attach_files_to_response`.

## Approvals and stop conditions

- Never edit files, designs, comments or tickets. You give the list; the user decides.
- Do not leave comments in Figma or open issues unless the user asks.
- If the screen needs a sign-in you do not have, ask for a screenshot instead.

## Common failures

- Vague advice such as "improve hierarchy" with no element and no change.
- Ranking by what is easy to see instead of what blocks the task.
- Claiming keyboard or screen-reader results from a static image.
- Redesigning the product style when a small fix solves the problem.
- More than 10 ranked items, so the important ones get lost.
