---
name: "Build Spec"
description: "Turn a design frame into a spec a developer can build from: components, layout and spacing, tokens and where values drift from the design system, states, motion, content rules and open questions. Works from an installed Figma plugin, a signed-in Figma tab, or a screenshot."
---

# Build Spec

## When to use

- When a design is ready and a developer needs to build it without guessing.
- When the user wants to know where a frame does not follow the design system.
- Not for judging whether the design is good. Use Interface Critique for that.

## Inputs

1. **The frame.** In this order:
   - An installed Figma plugin. Find it with `tool_search` in the `openbot` tools. Read the frame, its
     components, styles and variables.
   - A signed-in Figma tab in `openbot_browser`. Call `openbot_browser.list_tabs` first. Read values from the
     inspect panel.
   - A screenshot or export. Values from an image are estimates. Mark them "est."
   - If no Figma plugin is installed and Figma would help, suggest one with `suggest_marketplace_app`.
2. **The design system.** Figma styles and variables, a tokens file in the user's repository, or a pasted list.
   If there is none, report raw values and write "no system to compare".
3. **Target.** Web or mobile, and the component library in use. If it is not clear, ask once with `ask_user`.

## Steps

1. Name the frame, its size, and the date and version you read.
2. List the components. For each one, give the system component name and variant, or "custom".
3. Describe the layout: grid or stack, direction, gaps, padding, alignment, and how it behaves at narrower
   and wider widths. If the frame shows one width only, write the behavior as an open question.
4. List the tokens used: color, type, radius, spacing, shadow. Give the token name and value.
5. Find drift: each value that matches no token, or is close to a token but not equal. Give the value, the
   nearest token, and the place.
6. List the states for each interactive element: default, hover, focus, active, disabled, loading, empty,
   error, success. Mark each state "shown" or "missing".
7. Describe motion: what moves, duration, easing, and the reduced-motion behavior. Write "none shown" if none.
8. Write content rules: text limits, truncation, number and date formats, and what happens with long or
   missing text.
9. List open questions. Each names who can answer it.

## Checks

- Every value has a source: a style, a variable, the inspect panel, or "est." from an image.
- Every interactive element has all its states, or the missing ones are open questions.
- Drift lists only real differences. Do not guess a token for a value.
- A developer could build the screen from the spec without opening the design.

## Output

```
Build spec — <frame name> — <date> — source: <Figma plugin, Figma tab, or image>

Components
- <name> — <system component / variant or "custom">
Layout
- <region>: <stack or grid>, gap <n>, padding <n>, <resize behavior>
Tokens
| Kind | Token | Value | Used in |
Drift
| Place | Value | Nearest token | Note |
| Card padding | 18 px | space-4 (16 px) | Use space-4 or add a token |
States
| Element | Default | Hover | Focus | Disabled | Loading | Empty | Error |
Motion: <items or "none shown">
Content rules: <limits and formats>
Open questions
1. <question> — ask: <designer, owner>
```

## Approvals and stop conditions

- Never edit the Figma file, leave comments, change tokens, or write code unless the user asks.
- Stop and ask if you cannot open the frame. Do not build a spec from memory or a different frame.

## Common failures

- Values read from a screenshot reported as exact.
- A spec with only the default state.
- Calling a value drift when it is a token you did not find.
- No resize behavior, so the developer guesses.
- Copying every layer instead of the components a developer needs.
