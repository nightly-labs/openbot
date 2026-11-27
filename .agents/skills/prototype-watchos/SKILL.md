---
name: prototype-watchos
description: Build several different design directions (3 by default) for an Apple Watch app feature or issue as one self-contained HTML file with swatches, check that each design can be built with SwiftUI on watchOS, show them to the user, and let the user choose one. Use when the user writes `$prototype-watchos <feature>`, "prototype X on the watch", or asks for design variants, options, or directions for a screen of the watch app (`apps/mobile/targets/watch`) before implementation.
---

# Prototype (watchOS)

Make a small number of different, clickable directions for one feature of the
Apple Watch app (`apps/mobile/targets/watch`). The user opens one HTML file and
switches between the directions with swatches. The user chooses the
direction. Do not implement the feature in product code before the user
chooses.

This skill is the watch form of [prototype](../prototype/SKILL.md). It is
different in three points:

1. The designs are in one self-contained HTML file with swatches. Do not use
   Storybook, and do not put the prototype in the watch app or the iPhone app.
2. Each part of each design must have a SwiftUI part on watchOS that builds
   it. Check this before you show a design. Do not show a design that the
   watch app cannot build.
3. The HTML frame shows what watchOS adds: the screen shape, the safe areas,
   the clock, the navigation bar, the system fonts and the system controls.
   List each point where the HTML can look different from the real watch.

The usual call is short, for example `$prototype-watchos agent list`. Get the
missing details from the issue and the code. Ask only when you cannot
continue without the user.

## Inputs

- **Subject**: the text after `$prototype-watchos`, an issue number, or an
  issue URL.
- **Count**: 3 variants, unless the user gives a different number.
- **Style**: follow the current watch app and the watchOS Human Interface
  Guidelines, unless the user says otherwise (for example "go wild"). When
  the user sets the style aside, say which parts you changed. System chrome
  (clock, navigation bar, back button, page indicator, scroll behavior) stays
  native in all cases.

## Step 1 — Understand the subject

1. When the subject is an issue, read it: `gh issue view <n> --comments`.
   Otherwise search open issues: `gh issue list --search "<subject>" --state open`.
   Use a match only when it is clearly the same feature.
2. Read `apps/mobile/AGENTS.md` and `docs/architecture/watch-relay.md`.
3. Read the watch code for the feature in `apps/mobile/targets/watch/`:
   the screen (`AgentListView.swift`, `AgentPage.swift`, `QuestionViews.swift`,
   `ComposeViews.swift`, `StatusViews.swift`, and so on), the routes in
   `OpenBotWatchApp.swift`, and the state in `WatchSession.swift`. For a
   complication, read `apps/mobile/targets/watch-complication/`. Note:
   - what the user can do now, and with which control;
   - the data that the screen shows, and its source;
   - each state that the screen has (see [Data states](#data-states)).
4. Read the data contract: `packages/contracts/src/watch-protocol.ts`
   (`WatchSnapshot`, `WatchAgent`, `WatchWait`, `WatchCommand`, and the
   limits `WATCH_REPLY_LIMIT`, `WATCH_APPROVAL_LIMIT`, `WATCH_AGENT_LIMIT`).
   The iPhone builds the snapshot in
   `apps/mobile/src/features/watch/model/watch-snapshot.ts`, and the host builds
   it in `src/main/watch-relay-snapshot.ts`. A design can show only data that
   the contract has, or data that you add to the contract in Step 7 on both
   builders. Write each new field that a variant needs in your assumptions.
5. Read the minimum watchOS version: `deploymentTarget` in
   `apps/mobile/targets/watch/expo-target.config.js` (watchOS 10.0 when this
   skill was written). Each SwiftUI part that you use must be available in
   that version.
6. Take a reference screenshot of the place where the feature lives in the
   current watch app (Step 5 says how). Save it as `reference.png`.
7. Write down your assumptions in one short list. You show it to the user in
   Step 6.

## Step 2 — List what to reuse and what watchOS can build

List the parts that already exist in the watch app: `AgentAvatar`,
`AgentRow`, `StateCapsule`, `TextCard`, `ActionLabel`, `ConnectionNote`,
`agentBackground`, `armed(for:)`, the route enum `WatchRoute`, and the text keys
in `WatchText.swift`. A new screen must look like it belongs next to them.

Then make a **build table** for the feature. It has one row for each part
that any variant can show:

| Part in the design | SwiftUI on watchOS | Minimum watchOS | Source |
| --- | --- | --- | --- |
| Scrolling list of rows with section headers | `List` with `Section` | 6 | current `AgentListView.swift` |
| Full-screen pages that the Digital Crown scrolls | `TabView` with `.tabViewStyle(.verticalPage)` | 10 | Apple documentation |

Rules for the build table:

- Use only public SwiftUI, WatchKit, WidgetKit and AVFoundation APIs that the
  watch target links (`frameworks` in `expo-target.config.js`). Do not plan a
  new dependency or a framework that the target does not link.
- Confirm each part that the current watch code does not use already in the
  Apple documentation. The pages need JavaScript, so read their data instead:
  `curl -s https://developer.apple.com/tutorials/data/documentation/swiftui/<path>.json`
  gives `metadata.platforms` with `introducedAt` and `deprecatedAt` for
  watchOS. The path is the lowercase page path, for example `menu`,
  `tabviewstyle/verticalpage` or `toolbaritemplacement/bottombar`. A type
  with no watchOS entry does not exist on watchOS. Read the Human Interface
  Guidelines the same way
  (`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`)
  for layout, controls and typography. When you cannot confirm a part, do
  not use it, and say so.
- Check parts that look possible but are not:
  - There is no `Menu`, no hover, no right-click and no custom keyboard on
    watchOS. Text input is `TextField` or `TextFieldLink`: the system shows
    dictation, Scribble or a keyboard on its own screen.
  - `contextMenu` is deprecated on watchOS; use a button, `swipeActions` in a
    `List`, or a pushed screen.
  - A sheet covers the full screen. There are no detents, no popovers and no
    side-by-side panes. `NavigationSplitView` shows the list and the detail
    one after the other.
  - The navigation bar holds the title and at most the toolbar items of
    `.topBarLeading`, `.topBarTrailing` and `.bottomBar` (watchOS 10). Do not
    design a custom header bar.
  - The app cannot keep a socket open. Data comes by polling or from the
    iPhone (see `docs/architecture/watch-relay.md`), so a design cannot show a
    live value that changes each second. It can show a time label.
  - Text from the snapshot is plain text. Do not design rich text, tables or
    code blocks for an agent message.
  - Background effects are limited to colors, gradients, images and the
    system materials. Do not design a blur of arbitrary content behind a
    floating panel.
  - A control is 44 × 44 pt by default and never less than 28 × 28 pt. Text
    is 16 pt by default and never less than 12 pt. A watchOS app must work at
    140 percent text size (Human Interface Guidelines, Accessibility).
- When a variant needs a part that you cannot build, change the variant. Do
  not show it with a note.

## Step 3 — Choose the directions

Each direction must be a different answer to the problem, not a different
color. Change at least one of these between variants:

- Information hierarchy: what the user sees first on the small screen.
- Navigation: one list, list and pushed detail, vertical pages, a sheet.
- Interaction: tap, swipe action, Digital Crown, dictation, one-tap action.
- Density: one item for each screen, or many short rows.

Give each direction a letter, a short name, one sentence for its idea, and
one sentence for its main cost. Do not ask the user to approve the
directions. Build them.

## Step 4 — Build the HTML file

### File

Make one self-contained file:
`.openbot-build/prototypes/<feature>/prototype.html` (git ignores
`.openbot-build/`). Put the CSS and the JavaScript inline. Do not load fonts,
scripts, images or styles from the network, and do not import repository
code. Put pictures (agent avatars, the reference screenshot) in the file as
data URIs, or draw them with CSS.

Put the screenshots of Step 5 in the same folder.

### Watch frame

Draw the watch screen, not a phone or a browser page:

- **Size in points.** The frame has a size swatch. The default is the size
  of the simulator that you use for the reference screenshot. Measure each
  size that you offer from a simulator screenshot: its pixel size divided by
  2. Example: Apple Watch Series 11 (46 mm) gives 416 × 496 px, so
  208 × 248 pt. Also offer the smallest watch that the deployment target
  supports, because text wraps first there. Do not invent a size.
- **Screen shape.** Clip the screen with the rounded corners of the display.
  Content near a corner is cut off on the watch; keep it inside the safe area.
- **Safe area and system chrome.** Draw them as an overlay that the variant
  cannot change:
  - the clock at the top trailing corner;
  - the navigation title at the top leading corner, large on the root
    screen, and in the accent color when the app uses the default style;
  - the round back button on a pushed screen;
  - the page indicator for vertical pages;
  - the scroll behavior: the title shrinks and the content scrolls under the
    clock with a fade, as on watchOS.
  Put content only below the navigation bar and inside the horizontal safe
  area. Leave the bottom free of the rounded corners.
- **Colors.** Black background (watchOS apps have no light appearance). Use
  the system colors that watchOS uses for the parts in the build table: the
  gray of list row backgrounds, the secondary label gray, the accent color of
  the app (`colors.$accent` in `expo-target.config.js`), and the colors of
  agents from the fixtures. Write each color with its SwiftUI name in a CSS
  custom property, for example `--swiftui-secondary: …;`, so that Step 7 maps
  it back.
- **Typography.** Use the font sizes of the SwiftUI text styles that the
  variant uses (`.title3`, `.headline`, `.footnote`, `.caption2`), at the
  default text size of the chosen watch size. Use
  `font-family: "SF Compact", "SF Compact Text", -apple-system, system-ui`.
  Write the SwiftUI text style beside each size in the CSS.
- **Text size.** Add a text size swatch with the default size and at least one
  larger accessibility size, so that the user sees the wrapping.

### Swatches

Put the swatches beside the watch frame, not on it. One row for each axis:

- **Variant**: `Current` (the reference screenshot, when the feature exists),
  then `A`, `B`, `C`, with the letter and the short name.
- **Data**: one swatch for each state in [Data states](#data-states) that the
  feature can have.
- **Action**: only when the feature sends a command. `Succeeds`, `Fails`,
  `Slow`, with the real error text of the watch app.
- **Watch size**: the sizes from [Watch frame](#watch-frame).
- **Text size**: default and larger.
- **Always On**: only for a screen or complication that stays visible when
  the wrist is down. It shows the dimmed state.

A swatch change updates the frame at once. The URL hash keeps the selection
(for example `#b/offline/46mm`), so that a link opens one state. Each swatch is
a real `button` with a label, and the swatches work with the keyboard.

### Interaction

Make each variant clickable inside the frame: a tap on a row pushes the next
screen, the back button goes back, a swipe action shows its buttons, and the
mouse wheel scrolls as the Digital Crown does. Simulate dictation with a
prepared text. Do not make a control work in a way that watchOS cannot
copy, for example a hover state or a drag between two lists.

### Data states

Use the same fixtures in all variants, so that the user compares design, not
content. Build the fixtures in the shape of `WatchSnapshot` and `WatchAgent`,
with the real limits. Choose from:

| State | What the variant shows |
| --- | --- |
| Ready | Normal data |
| First run | No snapshot yet: the iPhone app has not sent data |
| Connecting | A snapshot from before, while the watch asks for new data |
| Stale | Data with its age, when no link answered for some time |
| Offline | The iPhone does not answer and the direct link fails |
| Signed out | The iPhone app signed out; the watch has no data |
| Empty | No agents on the server |
| Waiting | Agents that wait for an approval or an answer |
| Long | Long agent and server names, a reply at `WATCH_REPLY_LIMIT`, many agents up to `WATCH_AGENT_LIMIT`, other languages |
| Many servers | Agents from two or more servers |

Use the real text of the watch app for each state: the English strings in
`packages/i18n/src/messages/en/mobile/watch.ts` and the keys in
`WatchText.swift`. Draft new copy as literals in one `COPY` object in the
script.

### Other rules

- Do not change product code, the contracts, the i18n catalog, the watch
  target or the iPhone app for a prototype.
- Do not add dependencies or tests for a prototype.

## Step 5 — Check and capture

1. **Reference.** Take a screenshot of the current watch app on the watch
   simulator: `xcrun simctl io <watch udid> screenshot reference.png`. Find
   the watch with `xcrun simctl list devices booted`. When the watch app is
   not installed or not paired with data, take the screenshot that you can,
   and say what it misses. A new build needs a separate request from the
   user (`apps/mobile/AGENTS.md`).
2. **Render.** Open the HTML file with the browser tools of the harness (in
   T3 Code, `html_preview` and `html_render`), or with Playwright. Take a
   screenshot of each variant in Ready and in each data state that is
   important to the decision, at the default watch size and at the smallest.
   Make each screenshot of the watch frame only, at 2× scale, so that its pixel
   size is the same as a simulator screenshot. Save them as `a-ready.png`,
   `a-offline-40mm.png`, and so on.
3. **Compare.** Put each variant screenshot beside `reference.png`. The clock,
   the title, the back button, the margins and the row style must look the same
   as on the simulator. When they differ, fix the frame, not the variant.
4. **Fix.** Fix clipped text, content under the clock or in a rounded corner,
   tap targets smaller than 44 pt, and JavaScript errors in the console.
5. **Differences.** Write the list of points where the HTML can look
   different from the real watch, for this feature. Always check these:
   - the font: a browser without SF Compact uses another font, so the line
     breaks can be different;
   - the text size: the user's text size setting on the watch;
   - the system parts that the HTML only draws: navigation bar, scroll fade,
     list row style, button press state, sheet transition, page indicator;
   - the Digital Crown, haptics and dictation, which the HTML only simulates;
   - the data: polling every 5 to 15 seconds and the snapshot limits, so no
     live value;
   - Always On and the dimmed state;
   - a new contract field that the variant needs.

## Step 6 — Show the variants

Write one message:

1. Your assumptions from Step 1, as a short list, with each new contract
   field that a variant needs.
2. The link to the HTML file (absolute path), and how to use the swatches.
3. One table: variant, idea, strengths, costs.
4. The build table from Step 2, with each part that the variants use.
5. The list of differences from Step 5.
6. The screenshots, embedded with their absolute paths, with `reference.png`
   first.
7. Your recommendation, in one sentence, with the reason.
8. One question: which direction, or which mix (for example "B with the
   rows of A").

Then stop. Do not commit, push, or open a PR unless the user asks.

## Step 7 — After the user chooses

- **More rounds**: when the user asks for changes or a mix, change the HTML
  file and repeat Steps 5 and 6. Remove the variants that the user rejected.
- **Implement**: when the user tells you to build the chosen direction, build
  it in product code with the normal repository rules:
  - Build each part with the SwiftUI part from the build table, in
    `apps/mobile/targets/watch/`. Use the colors and the text styles that the
    CSS names.
  - Add each new data field to `packages/contracts/src/watch-protocol.ts` as
    an optional field, and fill it in both builders: the iPhone
    (`watch-snapshot.ts`) and the host (`watch-relay-snapshot.ts`). Keep the
    support window of the root `AGENTS.md`: an older iPhone app or host does
    not send the field.
  - Move each `COPY` string to a `mobile.watch.` catalog key
    ([docs/i18n.md](../../../docs/i18n.md)), and add it to `WATCH_TEXT_KEYS`
    in both builders and to `TextKey` in `WatchText.swift`.
  - Type-check the watch code only:
    `cd apps/mobile/targets/watch && xcrun --sdk watchsimulator swiftc -typecheck -target arm64-apple-watchos<deployment target>-simulator *.swift`.
    Use `bun run typecheck:node` for the host and the contracts `typecheck`
    script for the contract. Do not run the mobile typecheck.
  - Build and install on the simulator only on the user's request:
    `bun scripts/mobile-ios.ts --configuration Release --no-bundler --device "<iPhone simulator>"`.
    It also installs the watch app on the paired watch simulator.
  - Say that the change makes a new runtime version: native code changes,
    so it cannot go to the store build over the air.
  - Write release notes in `apps/mobile/changelog.d/<branch>.md`.
- **Reject**: when the user rejects all directions, delete the prototype
  folder.

Never commit the prototype HTML file or its screenshots.
