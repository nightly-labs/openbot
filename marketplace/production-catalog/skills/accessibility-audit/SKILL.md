---
name: "Accessibility Audit"
description: "Audit a page in the browser for keyboard path, focus, names and roles, contrast, headings, forms and errors, images and motion. Each finding has a severity (blocker, serious, minor), a WCAG 2.2 success criterion number and evidence. Use before a release or when a user reports a barrier."
---

# Accessibility Audit

## When to use

- Before a release, after a redesign, or when a person reports a barrier.
- Not a legal conformance statement. Not for writing alt text (use Alt Text).

## Inputs

1. **The page or flow.** A site address, or an open tab. Call `openbot_browser.list_tabs` first. Use a test
   account for pages behind a sign-in. If there is none, ask for one; never use a real customer account.
2. **The main task** on the page, such as "sign up" or "pay an invoice". If it is not clear, ask once with
   `ask_user`.
3. Without a live page, audit screenshots for contrast and target size only. Mark the rest "not tested".

## Steps

1. Open the page. Record the address, the title and the time. Take a screenshot.
2. **Keyboard path.** From the top, press Tab through the main task with `openbot_browser.press`. Write the
   order. Check that every control is reached, that you can leave every widget, and that Enter or Space works.
3. **Focus.** Screenshot each stop. Is the focus visible and not hidden behind a sticky bar?
4. **Names and roles.** Read `openbot_browser.snapshot`. Every control needs a role and a name that matches
   its visible label. Note icon buttons with no name and clickable elements that are not buttons or links.
5. **Contrast.** Read computed colors with `openbot_browser.evaluate` for body text, small text, placeholder,
   buttons, focus rings and icons. Compute the ratio. Text needs 4.5:1, large text 3:1, controls and focus 3:1.
6. **Headings and landmarks.** List the heading levels in order. Check the page title, the language, and a way
   to skip repeated blocks.
7. **Forms and errors.** Submit a form empty and with one wrong value. Are errors named in text, tied to their
   field, and announced? Are labels visible?
8. **Images.** Check the alt text of informative, decorative and linked images.
9. **Motion and layout.** Set reduced motion and a 320 px width with `openbot_browser.set_environment`. Check
   that motion stops or reduces, and that content reflows without sideways scroll. Check target size.
10. Rate each finding. Retest each blocker once.

## Rubric

- **Blocker:** a person cannot finish the main task. Example: keyboard trap, unnamed submit button.
- **Serious:** the task is possible with great difficulty, or a Level A or AA criterion fails on the main path.
- **Minor:** a failure off the main path, or a best practice with no criterion.
- Map each finding to one WCAG 2.2 criterion: 1.1.1 non-text content, 1.3.1 info and relationships, 1.4.3
  contrast, 1.4.10 reflow, 1.4.11 non-text contrast, 2.1.1 keyboard, 2.1.2 no keyboard trap, 2.4.3 focus order,
  2.4.7 focus visible, 2.4.11 focus not obscured, 2.5.8 target size, 3.3.1 error identification, 3.3.2 labels
  or instructions, 4.1.2 name, role, value, 4.1.3 status messages, or another one by its number. Write
  "best practice" when no criterion applies.

## Output

```
Accessibility audit — <address> — <date and time> — task: <main task>
Result: <n> blockers, <n> serious, <n> minor. This is not a conformance statement.

| # | Severity | WCAG | Where | Finding | Evidence | Fix |
| 1 | Blocker | 2.1.2 | Date picker | Tab cannot leave the picker | Screenshot 3; focus stays on day 14 | Close on Escape; return focus to the field |
| 2 | Serious | 1.4.3 | Help text | Grey text 3.5:1 | #8a8a8a on #ffffff | Use #6b6b6b (5.3:1) |

Keyboard order: <list>
Not tested: screen reader output, <other items and why>
```

Attach the screenshots with `attach_files_to_response`.

## Approvals and stop conditions

- Never edit the site, file issues or send the report to others without the user's yes.
- Do not submit forms that send real messages, payments or invitations. Mark them "not tested".

## Common failures

- A finding with no evidence: no screenshot, no value, no element.
- A blocker that is only a best practice.
- Claiming screen-reader results. The snapshot is not a screen reader.
- Stopping at the first page of a multi-step flow.
