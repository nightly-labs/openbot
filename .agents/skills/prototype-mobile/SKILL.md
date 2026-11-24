---
name: prototype-mobile
description: Build several different design directions (3 by default) for a mobile app feature or issue inside the running iOS/Android app, with swatches to switch the variant and the data state, show them to the user, and let the user choose one. Use when the user writes `$prototype-mobile <feature>`, "prototype X on mobile", or asks for design variants, options, or directions for a phone screen in `apps/mobile` before implementation.
---

# Prototype (mobile)

Make a small number of different, usable directions for one phone feature
inside the real mobile app (`apps/mobile`). The user opens them on a device or
simulator and switches between them with swatches. The user chooses the
direction. Do not implement the feature in product code before the user
chooses.

This skill is the mobile form of [prototype](../prototype/SKILL.md). It is
different in three points:

1. The designs show in the app, not in Storybook or HTML.
2. All animations run on the UI thread, not on the JavaScript thread.
3. When the UI shows data that loads, changes or can fail, a swatch shows
   each of these states.

The usual call is short, for example `$prototype-mobile agent picker`. Get the
missing details from the issue and the code. Ask only when you cannot
continue without the user.

## Inputs

- **Subject**: the text after `$prototype-mobile`, an issue number, or an
  issue URL.
- **Count**: 3 variants, unless the user gives a different number.
- **Style**: follow `apps/mobile/DESIGN.md` and reuse its components, unless
  the user says otherwise (for example "go wild", "ignore the current
  design"). When the user sets the style aside, say which parts you changed.
  Native chrome stays native in all cases.

## Step 1 — Understand the subject

1. When the subject is an issue, read it: `gh issue view <n> --comments`.
   Otherwise search open issues: `gh issue list --search "<subject>" --state open`.
   Use a match only when it is clearly the same feature.
2. Read `apps/mobile/AGENTS.md` and `apps/mobile/DESIGN.md`. Read the
   `expo` major version in `apps/mobile/package.json` and use the docs of
   that version (`https://docs.expo.dev/versions/v<major>.0.0/`) for each
   Expo, Expo Router or `@expo/ui` API.
3. Find the current code for the feature, when it exists: the route in
   `apps/mobile/src/app/`, the screen in `src/features/<domain>/screens/`, its
   components, and its data source (a React Query hook in
   `src/features/<domain>/api/`, the workspace context, or a store). Note:
   - what the user can do now;
   - the shape that the data hook returns (`data`, `error`, `isPending`,
     `isFetching`, `refetch`, mutation status);
   - each data state that the screen has or must have (see
     [Data states](#data-states));
   - each animation and gesture that is in the screen now.
4. Decide the [presentation mode](#presentation-mode).
5. Take a reference screenshot of the place where the feature lives in the
   current app (Step 5 says how). Save it as `reference.png` beside the
   variant screenshots.
6. Write down your assumptions in one short list. You show it to the user in
   Step 6.

## Step 2 — List what to reuse

Before you write UI, list the parts that already exist:

- OpenBot components in `src/shared/components/` and
  `src/features/*/components/`.
- HeroUI Native components (`heroui-native`) and `Typography`.
- Native chrome: Expo Router `Stack`, `Stack.Toolbar`, `Stack.SearchBar`,
  `NativeTabs`, native `formSheet`, `@expo/ui` controls, and `MenuView` from
  `@/shared/components/menu-view`.
- Tokens and utilities in `apps/mobile/global.css` (from
  `packages/brand/src/tokens.css` and `tokens-native.css`). Do not add colors,
  radii or shadows when a token exists.
- Real data types and values in `packages/contracts`. Use real plan names,
  limits and model names, not invented ones.
- Mocks that exist, such as `src/features/settings/api/credits-mock.ts`.
- Motion helpers: `useReducedMotion`, `useMotionPreference` and
  `useTransitionMode` from `@/shared/lib/motion`, and haptics from
  `@/shared/lib/haptics`.
- Similar screens. A new screen must look like it belongs next to them.

## Step 3 — Choose the directions

Each direction must be a different answer to the problem, not a different
color. Change at least one of these between variants:

- Information hierarchy: what the user sees first.
- Presentation: inline in the screen, pushed card, native form sheet, menu.
- Interaction model: tap, swipe or long-press gesture, inline edit, steps.
- Density: compact for experts, spacious for first use.

Give each direction a letter, a short name, one sentence for its idea, and
one sentence for its main cost. Do not ask the user to approve the
directions. Build them.

## Step 4 — Build the variants

### Presentation mode

Choose one mode. Write the choice in your assumptions.

| Mode | Use it when | Entry |
| --- | --- | --- |
| **In place** (default) | The feature lives in a screen that exists: a row, a header part, a composer part, a section of a sheet | The real screen shows the chosen variant where the feature goes. The prototype bar floats over the screen. |
| **Gallery** | The feature is a new screen or a new sheet, or the real screen cannot show it without product changes | A dev-only **Prototype** button opens a native `formSheet` route. The route shows the prototype bar and the variant. For a new full screen, the route pushes the variant as a `card`, so that the native header is real. |

In both modes, the user gets to the prototype from the first screen after
start:

- In place on Home: the bar shows on Home.
- In place on another screen: a dev-only **Prototype** button on Home goes to
  that screen.
- Gallery: the dev-only **Prototype** button on Home opens the sheet. When the
  feature has its own screen, add the button there too.

The button is a HeroUI `Button` in a floating position at the bottom trailing
corner, above the safe area. Do not add it to the native toolbar: that
changes the real chrome.

### Files

Put the prototype in its own files:

```
apps/mobile/src/features/<domain>/prototype/
  <feature>-prototype.tsx         variant components, each with a Variant suffix
  <feature>-prototype-bar.tsx     swatches (variant, data state, action result)
  <feature>-prototype-data.ts     fixtures, draft copy, fake data source, zustand store
apps/mobile/src/app/(app)/prototype-<feature>.tsx   Gallery mode only
```

You can change product code only at the entry points, and each change is one
small line or block behind `__DEV__`:

- The `PrototypeButton` on Home and on the feature screen.
- In place: one slot in the real screen that renders the selected variant
  instead of the current part, and the prototype bar.
- Gallery: one `Stack.Screen` entry with the `formSheet` options in
  `src/app/(app)/_layout.tsx`, the same as other sheets there.

Write each entry point in `TASKS.md` so that Step 7 can revert it. Do not
change shared components, contracts, the i18n catalog, `app.json`, config
plugins, `modules/` or native dependencies for a prototype. A native change
makes a new runtime version.

Draft new copy as literals in one `PROTOTYPE_COPY` object in
`<feature>-prototype-data.ts`, and render it from there. The
`no-hardcoded-ui-text` rule checks text in JSX; one object also makes Step 7
simple, because each string moves to a `mobile.` catalog key. Use existing
`mobile.` keys through `useText()` when they fit.

### Prototype state

Keep one zustand store in `<feature>-prototype-data.ts`:

```ts
type PrototypeVariant = "current" | "a" | "b" | "c";
type PrototypeDataState = "ready" | "loading" | "empty" | "error" | "refreshing" | "refreshFailed" | "offline" | "long" | "liveChange";
type PrototypeActionResult = "succeeds" | "fails" | "slow";

export const useAgentPickerPrototype = create<{
  variant: PrototypeVariant;
  dataState: PrototypeDataState;
  actionResult: PrototypeActionResult;
  barOpen: boolean;
}>(() => ({ variant: "a", dataState: "ready", actionResult: "succeeds", barOpen: true }));
```

Keep it in memory only. Do not write prototype state to SecureStore, the
workspace cache or another store on the phone.

### Swatches

The prototype bar (`<feature>-prototype-bar.tsx`) has one row of swatches for
each axis. Use `UsageSegments` from
`@/features/agents/components/usage-segments` or HeroUI controls, not a new
control.

- **Variant**: `Current` (the real UI, for comparison, when it exists), then
  `A`, `B`, `C`. The labels use the letter and the short name.
- **Data**: only when the feature shows data. One swatch for each state in
  [Data states](#data-states) that the feature can have.
- **Action**: only when the feature changes data. `Succeeds`, `Fails`, `Slow`.
- **Block JS 2 s**: only when a variant has animation or a gesture. See
  [Animations](#animations).
- A button that collapses the bar to a small pill, so that it does not hide
  the screen. Screenshots use the collapsed bar.

Put the bar at the bottom, above the safe area and the home indicator, and
over the content, not in the native toolbar. A change of swatch updates the
screen at once, with no reload. The bar has accessible labels and works with
VoiceOver.

### Data states

When the feature shows data that the app fetches, or that changes while the
screen is open, give each state that can occur a swatch. Choose from:

| State | What the variant shows |
| --- | --- |
| Ready | Normal data |
| Loading | First load, no data yet. Hold it until the user picks another swatch |
| Empty | Load done, no items |
| Error | First load failed. Retry goes to Loading, then to Ready after `PROTOTYPE_DELAY_MS` |
| Refreshing | Data shows and a new load runs |
| Refresh failed | Old data shows with an error |
| Offline | The host (also a joined server) cannot be reached; the saved workspace copy shows when the feature has one |
| Long | Many items, long names, large numbers, other languages |
| Live change | Data changes while open: a button adds, removes or updates one item |

For an action that changes data, the **Action** swatch sets the result:
pending, then success, or an error with a real error message from the app.

Rules:

- The fake data source returns the same shape as the real hook (for a query:
  `data`, `error`, `isPending`, `isFetching`, `refetch`). Then Step 7 replaces
  the source and keeps the variant.
- All variants read the same fake source and the same fixtures, so the user
  compares design, not content.
- The variant never sends a request or a mutation to a real host. It can read
  real data from the real screen around it.
- Each state looks complete: no blank screen, no spinner without a reason, a
  retry where a retry helps.

### Animations

All animations and gestures run on the UI thread. A busy JavaScript thread
must not stop or slow them.

Use:

- `react-native-reanimated` 4: `useSharedValue`, `useAnimatedStyle`,
  `useDerivedValue`, `withTiming`, `withSpring`, `withRepeat`,
  `withSequence`, layout animations (`entering`, `exiting`,
  `layout={LinearTransition}`), and Reanimated CSS transitions and
  animations.
- `useAnimatedScrollHandler` for an effect that follows the scroll.
- `react-native-gesture-handler` 3 gestures whose callbacks are worklets and
  change shared values.
- Skia (`@shopify/react-native-skia`) with shared values or derived values as
  props.
- Native transitions of Expo Router stacks and sheets.
- `scheduleOnRN` from `react-native-worklets` only at the end of an animation
  or a gesture (for example in the `finished` callback), as
  `src/features/settings/components/theme-sweep.tsx` does. Haptics from a
  worklet use it too.

Do not use:

- `Animated` or `LayoutAnimation` from `react-native`.
- React state that changes each frame: `setState` in `setInterval`,
  `requestAnimationFrame`, `onScroll` or a gesture update.
- `scheduleOnRN` or `runOnJS` in each frame.
- A worklet that reads React state that changes during the animation. Copy
  the value to a shared value.
- A JavaScript timer that moves an animation from step to step.

Each animation follows the motion settings: `useReducedMotion()` gives no
motion or a fade, and `useMotionPreference()` turns the part off when the
user turns it off.

The **Block JS 2 s** swatch runs a busy loop on the JavaScript thread for
2 seconds. While it runs, each animation and gesture of the variant must move
smoothly. If an animation stops or jumps, it uses the JavaScript thread: fix
it before you show the variant.

### Other rules

- Light and dark appearance, dynamic type and VoiceOver work in each
  variant. Use real roles and labels.
- Keep the sheet rules of `apps/mobile/AGENTS.md` (fixed detents,
  `SheetScrollView`, `SheetSaveAction`, no extra Done button).
- When the feature shows on a wide window (iPad, split layout), check it
  there too.
- Do not add dependencies or tests for a prototype.

## Step 5 — Check and capture

Run these checks one at a time:

1. `bunx biome check --write --max-diagnostics=none <new and changed files>`
   from the repository root.
2. Do not run the mobile typecheck: `apps/mobile/AGENTS.md` does not permit
   it. Metro and LogBox show build errors. State that types are not verified.
3. Run the app. This skill is the user's request to load the JavaScript
   bundle in a development client that is already installed on a simulator or
   device. A native build (`expo run:ios`, `expo run:android`, EAS) needs a
   separate request from the user. When no development client is installed,
   stop and ask.
   - Run `bun run dev:status`. Reuse the Metro of this worktree when it is
     live. Otherwise start it as the [smoke](../smoke/SKILL.md) skill says,
     with the Bash background option.
   - Drive the simulator with the device tools of the harness (in T3 Code:
     `device_list`, `device_open`, then the `agent-device` command that it
     returns). Do not drive another worktree's app.
4. Open the prototype from Home as a user does. Take these screenshots, with
   the bar collapsed:
   - each variant in Ready, in light appearance;
   - each variant in each data state that is important to the decision
     (normally Loading, Empty and Error);
   - each variant in dark appearance, in Ready.

   Save them in `.openbot-build/prototypes/<feature>/` (git ignores it), for
   example `a-ready.png`, `a-error.png`, `a-ready-dark.png`.
5. For each variant with animation: start the animation, press
   **Block JS 2 s**, and take two screenshots during the block. The
   animation must be at a different position in each. Save them as
   `a-js-blocked-1.png` and `a-js-blocked-2.png`. When the harness can record
   the screen, also record a short video.
6. Compare each screenshot with the reference. Everything outside the new
   part must be the same. When the native header, toolbar or tab bar looks
   different, the variant changed the chrome: use the native one.
7. Look at each screenshot. Fix broken layout, clipped text, overlap with the
   safe area or the keyboard, and LogBox errors or warnings that the
   prototype causes. Report errors that also occur without the prototype; do
   not fix them.

Leave Metro and the app running, so that the user can try the variants.

## Step 6 — Show the variants

Write one message:

1. Your assumptions from Step 1, as a short list, with the presentation mode.
2. How to open the prototype: for example "Home > Prototype > A".
3. One table: variant, idea, strengths, costs, and the result of the
   JavaScript block check (or "no animation").
4. The data states that have a swatch.
5. The screenshots, embedded with their absolute paths.
6. Your recommendation, in one sentence, with the reason.
7. One question: which direction, or which mix (for example "B with the
   empty state of A").

Then stop. Do not commit, push, or open a PR unless the user asks.

## Step 7 — After the user chooses

- **More rounds**: when the user asks for changes or a mix, change the
  prototype and repeat Steps 5 and 6. Remove the variants that the user
  rejected from the code and the swatches.
- **Implement**: when the user tells you to build the chosen direction,
  build it in product code with the normal repository rules:
  - Move the variant into `src/features/<domain>/` and replace the fake data
    source with the real hook. Keep each data state that the prototype
    showed.
  - Move each `PROTOTYPE_COPY` string to a `mobile.` catalog key
    ([docs/i18n.md](../../../docs/i18n.md)).
  - Keep the animations on the UI thread.
  - Follow [Joined servers](../../../AGENTS.md#joined-servers) when the
    feature needs a host route or capability.
  - Write release notes in `apps/mobile/changelog.d/<branch>.md`.
  - Run focused checks only.
  - Delete the `prototype/` folder and the prototype route, and revert each
    entry point in `TASKS.md`.
- **Reject**: when the user rejects all directions, delete the prototype
  files and revert each entry point.

Never commit prototype files, `__DEV__` prototype entry points, or a
prototype route to `main`: a later agent copies them as references.
