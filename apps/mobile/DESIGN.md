# OpenBot Mobile Design Guidelines

These rules apply to design, implementation, review, and AI-generated mobile UI. They define which layer owns each part of the interface and prevent the app from drifting into multiple visual systems.

## Core rule

HeroUI Native is the foundation for application content. It is already installed, its provider is mounted in `src/app/_layout.tsx`, and its theme aliases are mapped to OpenBot tokens in `global.css`.

Use HeroUI Native for product UI such as buttons, cards, fields, alerts, chips, accordions, and other content rendered inside a screen. Reuse an existing OpenBot component first, then a HeroUI Native component. Do not recreate a component that either layer already provides.

HeroUI Native is a component source, not a requirement to decorate every screen. Start with the lightest useful composition. A focused screen may need only layout, `Typography`, and one `Button`; add `Card`, `Chip`, `Surface`, or `Alert` only when it expresses real grouping, state, interaction, or actionable information.

Render product text through HeroUI Native `Typography`, including `Typography.Heading` and `Typography.Paragraph` for semantic roles. Screens and product components must not import React Native `Text` directly unless a third-party integration boundary requires the native primitive and the exception is documented.

Native system chrome is the intentional exception. Navigation and operating-system-owned controls must remain native even when HeroUI can produce a visually similar element. This lets iOS apply Liquid Glass automatically on supported versions and lets Android retain its native Material behavior.

## Component ownership

| Interface need | Preferred owner | Guidance |
| --- | --- | --- |
| Product content and reusable product controls | HeroUI Native | Use installed HeroUI components and variants. Compose them before creating a new primitive. |
| Product headings, paragraphs, labels, and inline text | HeroUI Native `Typography` | Use semantic type, color, weight, and alignment props instead of React Native `Text` and screen-local font styling. |
| Screen stacks, titles, back buttons, headers, and route transitions | Expo Router native `Stack` | Configure them in route layouts or screen options instead of drawing custom headers. |
| Tab navigation | Expo Router `NativeTabs` | Use native tab triggers, labels, badges, and platform icons instead of a custom tab bar. |
| Search integrated with navigation | `Stack.SearchBar` and native toolbar search slots | Do not place a HeroUI input inside a handmade navigation bar. |
| Header and bottom toolbar actions or menus | `Stack.Toolbar` native items | Let the platform render placement, materials, menus, and interaction behavior. |
| Route-level modals and form sheets | Expo Router native presentations | Prefer native modal or form-sheet presentation over a custom full-screen overlay. |
| Native pickers, switches, sliders, menus, and grouped system forms | `@expo/ui` | Use when the interaction should look and behave like a platform control. Keep every `@expo/ui` tree inside `Host`. |
| Large or unbounded data lists | React Native `FlatList` or an approved virtualized list | Do not use a non-virtualized component for feeds or large search results. |
| Custom in-content glass surface | `expo-glass-effect` | Use sparingly, only when glass is part of the product content rather than navigation chrome. Provide non-glass and reduced-transparency behavior. |

Native ownership takes priority over HeroUI for navigation chrome. HeroUI ownership takes priority for application content.

## Liquid Glass and platform behavior

- Obtain Liquid Glass through native navigation components. Do not imitate it with blur views, gradients, translucent HeroUI cards, shadows, or screenshots of glass.
- Do not replace native headers, tab bars, toolbars, or search bars with `GlassView`. `expo-glass-effect` is for deliberate custom content surfaces, not for rebuilding system chrome.
- Preserve platform safe-area and scroll-edge behavior. Ordinary screens normally use automatic content inset adjustment. Native sheets use the shared `SheetScrollView` header handling described below; do not add a second automatic inset or screen-local spacer.
- Avoid forcing opaque colors or bespoke backgrounds onto native chrome unless the product requirement explicitly calls for it. Let the operating system adapt materials to the platform version, appearance, accessibility settings, and scroll state.
- Treat older iOS versions and Android as first-class fallbacks. The interface must remain complete and readable when Liquid Glass is unavailable or reduced transparency is enabled.
- Use platform-native icons in native navigation (`sf` on iOS and the corresponding Material icon on Android). Use the existing application icon convention for HeroUI content.

## Sheets

The sheet style is a neutral iOS-style grouped surface: a white/light-gray sheet in light mode,
charcoal in dark mode, gently contrasting groups, muted descriptions, inset separators and soft
16 pt group corners. Keep this visual language consistent across settings, add/edit forms and
other sheets. The system owns the outer sheet shape and presentation.

### Native presentation and headers

Register standalone sheet routes in the existing Expo Router stack. The current configuration for
a standalone sheet with a native title is:

```tsx
{
  presentation: "formSheet",
  sheetAllowedDetents: "fitToContents",
  sheetGrabberVisible: true,
  sheetExpandsWhenScrolledToEdge: false,
  contentStyle: { backgroundColor: sheetBackground },
  headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
  headerTransparent: isIOS,
  headerBlurEffect: "none",
  scrollEdgeEffects: { top: "soft" },
  title: "Profile",
}
```

Resolve `sheetBackground` from `--openbot-bg-sheet`, as in `src/app/(app)/_layout.tsx`.
Keep `headerShadowVisible: false` from the parent stack. A headerless sheet uses
`headerShown: false`; do not add a fake navigation bar. Full-height detents are appropriate for
search or similarly large content, not the default for a short form.

Multi-page flows such as Settings stay inside ONE sheet. Register the outer `settings` route with
`presentation: "formSheet"`, `headerShown: false`, a grabber and stable detents `[0.85]`.
Its `settings/_layout.tsx` owns a native `Stack`; detail routes use `presentation: "card"`,
`headerBackButtonDisplayMode: "minimal"` and the same transparent header styling. `router.push`
opens an inner page and `router.back` returns to the previous page without dismissing the sheet.
Include secondary flows such as joining a server in this stack. Do not register each settings page
as another modal. Use `initialRouteName: "index"` so direct entry into a detail page has a back route.

A nested navigator requires a stable viewport; do not combine it with `fitToContents`. The
intrinsic-height rule applies to standalone forms, not multi-page settings. Preserve the active
page and unsaved input when navigating forward and back; do not replace routing with conditional
screen rendering or a custom back-button imitation.

Settings has one detent, `[0.85]`, so a drag cannot expand it to an otherwise unnecessary second
height. The parent stack sets `sheetExpandsWhenScrolledToEdge: false` for sheets. Overflow belongs
to the content scroll view, not a larger sheet detent. Native dismissal remains available.

`headerTransparent` alone does not remove a configured blur material. Do not restore
`systemMaterial` or another `headerBlurEffect` on these sheets, or put an opaque header color back
on iOS. The native soft scroll edge handles the transition under the title.

### Scroll ownership

Use `src/shared/components/sheet-scroll-view.tsx` as the root scroll container. In particular:

- Disable bounce and overscroll (`bounces={false}`, `alwaysBounceVertical={false}` and
  `overScrollMode="never"`). Content that fits stays still; longer content keeps native scrolling.
  Do not disable scrolling globally. Agent Info uses `scrollOnlyOnOverflow` to disable touch
  scrolling on short pages. It compares native content and viewport sizes without changing layout,
  and permits scrolling while the keyboard is visible. Keep this opt-in behavior in `SheetScrollView`.
- With an iOS native header, it reads `HeaderHeightContext` and `HeaderShownContext` from
  `expo-router/react-navigation`, disables automatic content inset adjustment, and adds the
  measured header height inside scrollable content. This keeps the first item below the title at
  rest while allowing it to scroll underneath. No hardcoded header height or additional safe-area
  wrapper belongs in the screen.
- It suppresses `SheetScrollEdgeEffect` when a native header owns the edge. Do not combine custom
  masking, blur material and native scroll-edge effects; they can obscure content in overlapping
  bands. Headerless sheets retain their existing shared edge behavior.
- Keep the scroll view reachable directly from the sheet. Avoid surrounding `flex: 1` containers
  for standalone fit-to-content presentations. A nested settings stack has a bounded viewport. Keep the last action in the same scroll flow, with the existing
  bottom safe-area utilities, so it remains reachable on small screens and with the keyboard open.
- Use `keyboardDismissMode="interactive"` and `keyboardShouldPersistTaps="handled"` for forms,
  following existing screens. Reuse `SheetFormField` instead of rebuilding its platform inputs.
- `SheetScrollView` uses `KeyboardAwareScrollView` to reveal the focused field and keep the last
  action reachable above the keyboard. Keep `mode="insets"`: a layout spacer changes the intrinsic
  sheet height and conflicts with native sheet sizing. Use `disableScrollOnKeyboardHide` to keep
  the user's position. The keyboard-controller 1.21.9 patch shrinks insets during dismissal and
  clamps only the current offset beyond the remaining content, instead of replaying a saved offset
  after a new drag. `scripts/mobile-keyboard-scroll.test.ts` covers that event sequence against the
  installed library. Leave `automaticallyAdjustKeyboardInsets` disabled and do not add another
  keyboard-avoiding wrapper. Verify tapping outside a field followed immediately by scrolling,
  interactive keyboard dismissal, reaching the final action, and short fit-to-content sheets.

### Palette, groups and text

The values belong to `packages/brand/src/tokens.css` and `tokens-native.css`; `global.css` only
maps them to utilities. Do not copy these hex values into components.

| Role | Utility | Light | Dark |
| --- | --- | --- | --- |
| Sheet background | `bg-sheet` | `#fcfcfc` | `#121212` |
| Group background | `bg-grouped` | `#f2f2f2` | `#212121` |
| Supporting text | `text-grouped-secondary` | `#858589` | `#96969b` |
| Inset separator | `bg-grouped-border` | `#dddddf` | `#333335` |
| Group corners | `rounded-grouped` | 16 pt | 16 pt |

Use the same sheet token for the native route container and scroll background. `bg-background`
is the app canvas, and `bg-control` is a different surface; neither is a substitute here.
`rounded-2xl` follows the shared desktop radius scale and does not mean a 16 pt group corner in
this app. Use `rounded-grouped` explicitly.

Reuse the settings compositions in `src/features/settings/components/settings-content.tsx`.
Groups use HeroUI `ListGroup` without shadows, regular-weight primary text, smaller muted
supporting text, and inset hairline separators. Section captions use normal casing. Avoid heavy
labels, uppercase section titles, decorative cards and tinted gray backgrounds. Account portraits
can use `ProfileAvatar neutral`; agent colors still convey their own identities.

Action rows use the same flat grouped surface as navigation rows. Sign-out and photo-removal
rows do not have chevrons; destructive actions use `text-danger` instead of a filled red block.
Keep pending/disabled behavior and confirmation for sign-out. Do not add account deletion or other
unsupported actions just because a visual reference shows them.

Use `Typography` for application text. Native pickers and other platform controls remain inside
an Expo UI `Host` with the selected app appearance. A whole SwiftUI `FieldGroup`/`Form` introduces
its own scrolling, background and typography, so do not use it as a replacement for this sheet
composition merely because its individual controls are native.

### Profile and About

Keep the profile identity centered: neutral avatar, editable name directly below, then the email
in smaller secondary text. Place the pencil immediately beside the visible name, not against the
sheet edge. Keep the name centered and constrain long names to the available width.

Edit the name inline with the same mounted native input and typography in both states. Do not
replace the label with a separate form that moves the surrounding content. Show Save only after
the name changes, disable it for invalid input or a pending request, and let Cancel restore the
saved name. Reserve a compact action area so showing these controls does not shift the page.
Group the identity, action area and Profile photo section together instead of applying the
standard section gap on both sides of the reserved area. Keep the email close to the name.

About ends with a centered, interactive `AppLogo`, the OpenBot name and the app version, including
the build number when available. Reuse the logo's existing tap animation; do not create another
mascot animation or add a marketing subtitle. Read version metadata from the app rather than
hardcoding it.

### Visual verification

Inspect light and dark mode, initial presentation, a scrolled position under the title, the bottom
of the sheet, and keyboard-open state. Include large text and small screens when layout changes.
Check headerless sheets as well when changing `SheetScrollView`. Native behavior should be checked
on iOS and Android when available, including iOS 26 for its scroll-edge behavior.

A compiler or token test cannot confirm transparency, clipping, colors or corner radii. State
which visual checks ran and which remain unverified. Do not start a simulator, native client or
build without the authorization required by `AGENTS.md`; inspecting an already running instance
does not prove a changed screen was exercised.

## Theme and visual consistency

- `packages/brand/src/tokens.css` is the single source of truth for OpenBot color, typography, radius, shadow, and motion tokens, shared with the desktop and web apps; `tokens-native.css` beside it carries the light and dark values for the tokens mobile themes. `global.css` imports both and declares none of its own — it maps them to Tailwind utilities and HeroUI semantic aliases.
- Use HeroUI semantic variants and existing utility classes. Do not add raw colors, arbitrary radii, or one-off shadows to a screen when a token or component variant can express the intent.
- Extend OpenBot tokens only for a new semantic role that will be reused. Keep HeroUI aliases mapped to OpenBot tokens rather than creating a second palette.
- Support light and dark appearance, dynamic type, reduced motion, reduced transparency, and sufficient contrast.
- Favor composition and shared variants over copying styled JSX between screens.
- Keep status and instructional copy evidence-based. Do not introduce badges, alerts, or lifecycle requirements that cannot be derived from the actual session, connectivity, or persistence implementation.

## Development workflow

Before implementing a mobile UI change:

1. Search `src/components` and current screens for an existing reusable component or pattern.
2. Check HeroUI Native for the product-content component or composition.
3. If the element is navigation chrome or a platform control, check the Expo SDK version-matched Expo Router and `@expo/ui` APIs before building anything custom.
4. Extend the existing component or token layer only when the required state or semantic role is genuinely missing.
5. Verify behavior and appearance in light and dark mode. For native chrome changes, verify both iOS and Android; include an iOS version that supports Liquid Glass when available.

Any fallback away from this ownership model must be explained in the change: what the preferred layer could not do, which platforms are affected, and how the fallback preserves accessibility and theme behavior.

## AI implementation rules

AI agents must follow the same workflow and must not infer component APIs from memory. Before changing Expo Router, `@expo/ui`, or other Expo UI code, confirm the installed Expo major version and use its versioned documentation. Before using a HeroUI Native component, confirm the installed package API or project usage.

An AI-generated UI change is incomplete when it introduces a custom navigation or search surface that a native API can own, duplicates an available HeroUI component, adds a second theme, or omits platform and accessibility fallbacks.

## Haptics

Use `shared/lib/haptics.ts` for application feedback. It reads the device preference on every call;
components must not import `expo-haptics` directly. From a worklet, schedule feedback on the RN runtime.

Keep native Liquid Glass context menus in both Haptics states. Do not replace `Link.Menu` or
long-press `MenuView` with an action sheet to suppress feedback. These system context menus expose
no public haptics opt-out in the installed Expo APIs. Their feedback, like system keyboard and
picker feedback, remains owned by iOS. Do not use private UIKit APIs to suppress it.
