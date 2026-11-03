---
name: "Prototype Build"
description: "Turn an idea into the smallest clickable static prototype, click through it in the browser, and return screenshots of the click path and a short video. Publishes to a public site only after the user says publish. Can open a draft pull request instead when the user asks."
---

# Prototype Build

## When to use

- When the user wants to click an idea, not read about it.
- Not for production code or a design review (use Interface Critique).

## Inputs

1. **The idea.** From the user, a scope document, a sketch, a screenshot, or a Figma frame (an installed Figma
   plugin, found with `tool_search` in the `openbot` tools, or a signed-in Figma tab in `openbot_browser`).
2. **The click path.** The 2 to 5 steps a person must be able to do. If it is not clear, ask one question with
   `ask_user`: "What is the one thing a person should be able to do in this prototype?"
3. **Content.** Use the user's words when given. Else use plain sample content, labeled as sample.

## Steps

1. Write the click path as numbered steps. Build only the screens these steps need.
2. Build in a new workspace folder `prototypes/<short-name>/` with vanilla HTML, CSS and JavaScript, as the
   built-in site hosting skill says. No framework, no library for one component, no outside scripts.
   Put the start screen in `index.html`. Use semantic HTML, real buttons and links, and visible focus.
3. For a new idea, use Distinctive Frontend Design for the visual direction. Reuse the user's brand when given.
4. Keep inside the hosting limits from the start: at most 20 files, 2 MB in total, 1 MB per file. Allowed
   types: HTML, CSS, JavaScript, JSON, SVG, WebP, PNG, JPEG, ICO, WOFF2, TXT and web manifests.
5. Preview it. The browser opens web addresses, not file paths. Start a local static file server for the folder
   in the workspace shell (for example the one built into Python), bound to 127.0.0.1. Open the exact address
   that the command prints in `openbot_browser`. Stop the server when you are done.
6. Start `openbot_browser.recording_start`. Do the click path as a user: click and type, do not call scripts.
   Take one screenshot per step. Stop with `openbot_browser.recording_stop`.
7. Check the mobile width with `openbot_browser.set_environment`. Fix what breaks, then repeat step 6.
8. Send the result and ask whether to publish.

## Checks

- Every click-path step works by click or keyboard, and its screenshot shows the result.
- Parts that only look real are labeled "not built".
- The folder fits the hosting limits and has no keys, `.env` files, archives or source maps.

## Output

```
Prototype: <name> — folder: prototypes/<short-name>/ — status: local only, not published

Click path
1. <step> — works — screenshot 1
2. <step> — works — screenshot 2
Not built: <parts that only look real>
Sample content: <what is sample>
Size: <n> files, <size>

Publish to a public site address? It expires after 30 days.
```

Attach the screenshots and the video with `attach_files_to_response`.

## Publish and pull request paths

- Call `openbot.publish_site` only after the user says publish. A request to build or preview is not a yes.
- The site is public. Tell the user before you publish. Remove private data first.
- The user can have 10 active sites. Call `openbot.list_sites` before a retry. To update a published
  prototype, use `openbot.replace_site` after the user says so; it keeps the address.
- When the user asks for the prototype in their repository instead: make a branch, commit, push, and open a
  draft pull request with `gh`. Never merge it and never mark it ready.

## Approvals and stop conditions

- Never publish, replace, delete a site, share a link, merge, or add a dependency without the user's yes.
- If the idea needs a server, payments or real sign-in, say that the prototype only pretends to do it.

## Common failures

- Building every screen instead of the click path.
- A framework or a build step for three screens.
- Publishing because the user said "show me".
- Sample content that looks like real customer data.
