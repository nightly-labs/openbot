This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Execution and verification limits

- `bun run lint` and `bun run typecheck` are the default checks here and need no permission. Each covers the whole app in seconds, so narrowing them to changed files buys nothing and hides a break in one of the packages the app imports. Run both before you call a task done and before a PR.
- Everything slower than those two needs explicit user permission for that exact command: builds, packaging, signing, submission, deployment, EAS commands, iOS simulator or Android emulator runs, device runs, and native development clients. One permission authorizes one command and nothing that follows it.
- If a requested workflow needs a command from that list, explain the limitation and wait for permission. Never substitute a broader command or run one implicitly.

## Design system and native chrome

Read and follow [`DESIGN.md`](./DESIGN.md) before changing mobile UI.

- Build application content with HeroUI Native. Reuse its installed components and the OpenBot theme aliases in `global.css`; do not introduce a parallel component library, theme, or screen-local design language.
- HeroUI-first does not mean component-heavy. Prefer the smallest composition that communicates the screen: plain layout plus `Typography` and `Button` is better than decorative `Card`, `Chip`, `Surface`, or `Alert` wrappers when those components add no interaction or hierarchy.
- Render product text with HeroUI Native `Typography` and its semantic variants. Do not import React Native `Text` directly in screens or product components unless an integration boundary explicitly requires the native primitive.
- Treat system chrome as the deliberate exception to the HeroUI-first rule. Navigation stacks, headers, tab bars, toolbars, search bars, system menus, and route-level sheets must use the native Expo Router or `@expo/ui` APIs whenever they provide the required behavior.
- Prefer `Stack`, `Stack.Title`, `Stack.Toolbar`, `Stack.SearchBar`, and `NativeTabs` over custom React Native or HeroUI imitations. Native chrome must remain native so iOS can provide Liquid Glass on supported versions and Android can use its platform conventions.
- Do not fake native chrome with custom blur, gradients, translucent cards, or `GlassView`. Use `expo-glass-effect` only for an intentional custom in-content glass surface, with platform and accessibility fallbacks.
- If neither an existing OpenBot component nor HeroUI Native fits an application-content need, verify that before creating a reusable component. If native APIs cannot satisfy a system-chrome requirement, document the constraint in the change before using a fallback.
- Do not add status badges, warnings, or operational guidance unless the application state and repository behavior support the claim. Verify lifecycle and connectivity copy against the implementation before presenting it to users.

## Sheets

Follow [DESIGN.md — Sheets](./DESIGN.md#sheets) for presentation options, tokens and header styling,
and inspect the current route options in `src/app/(app)/_layout.tsx`, when adding or changing a
sheet. Four rules decide the shape of the screen before any of that detail applies:

- A multi-page flow is ONE outer sheet with a nested native stack. Inner routes use
  `presentation: "card"` and the native back button, never another sheet. A nested navigator cannot
  measure intrinsic height, so it needs stable detents and no `flex: 1` wrapper.
- `SheetScrollView` is the screen's scroll container and owns header clearance, safe-area behavior
  and scroll-edge effects. Do not add screen-local header padding or another inset layer.
- Save and create actions use `SheetSaveAction` in the native header. Do not add a second
  Save/Create button in sheet content.
- Do not add a redundant Done or close button to a dismissible sheet. Add an explicit action only
  when the flow requires one, such as Save or Cancel for unsaved work.

Check initial header clearance, scrolling under the header, the last action, keyboard visibility,
and light/dark appearance. Typecheck does not establish visual correctness. Report which device
checks actually ran; the execution limits above still apply.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
bunx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
bun run start                # start the dev server
bun run lint                 # lint and format-check with Biome
bun run typecheck            # typecheck with TypeScript 7
bun run doctor               # diagnose dependency and config issues
bunx expo install --fix      # fix incompatible package versions
```

Both are scoped to this app: `lint` is `biome check --max-diagnostics=none src` and `typecheck` runs `codegen` before `tsc`. See "Execution and verification limits" above for when to run them, and [repository checks](../../AGENTS.md#checks) for the repository-wide commands worth avoiding and why.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- For a navigator option, route convention or typed-route question, see https://docs.expo.dev/router/introduction.md.

## Building with EAS

Once authorized under "Execution and verification limits", EAS performs the operation in the cloud (`eas build`, `eas submit`, or `eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
For a build profile, credential or submission option the command needs, see https://docs.expo.dev/eas/index.md.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules, so a library with native code needs a development build. Say so and stop there; creating or running that build is an authorized command under "Execution and verification limits".
- Prefer recommended Expo modules over third-party libraries. Check `.agents/skills/` for a skill that covers the dependency before adding it, and https://docs.expo.dev/versions/latest/index.md for whether Expo already ships the module you need.
