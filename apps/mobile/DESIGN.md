# OpenBot Mobile Design Guidelines

These rules apply to design, implementation, review, and AI-generated mobile UI. They define which layer owns each part of the interface and prevent the app from drifting into multiple visual systems.

## Core rule

HeroUI Native is the foundation for application content. It is already installed, its provider is mounted in `src/app/_layout.tsx`, and its theme aliases are mapped to OpenBot tokens in `global.css`.

Use HeroUI Native for product UI such as buttons, cards, fields, alerts, chips, accordions, and other content rendered inside a screen. Reuse an existing OpenBot component first, then a HeroUI Native component. Do not recreate a component that either layer already provides.

HeroUI Native is a component source, not a requirement to decorate every screen. Start with the lightest useful composition. A focused screen may need only layout, `Typography`, and one `Button`; add `Card`, `Chip`, `Surface`, or `Alert` only when it expresses real grouping, state, interaction, or actionable information.

Render product text through HeroUI Native `Typography`, including `Typography.Heading` and `Typography.Paragraph` for semantic roles. Screens and product components must not import React Native `Text` directly unless a third-party integration boundary requires the native primitive and the exception is documented.

Native system chrome is the intentional exception. Navigation and operating-system-owned controls must remain native even when HeroUI can produce a visually similar element. This lets iOS apply Liquid Glass automatically on supported versions and lets Android retain its native Material behavior.

All text uses Inter, the desktop and web font, with the system font as fallback. Native chrome stays native but takes the font: header titles, back titles and toolbar labels read the React Navigation theme fonts (`navigationFonts` in `src/shared/lib/app-font.ts`), and an iOS `@expo/ui` label takes `nativeLabelFont`. System menus, date pickers and Live Activities keep the system font.

## Component ownership

| Interface need | Preferred owner | Guidance |
| --- | --- | --- |
| Product content and reusable product controls | HeroUI Native | Use installed HeroUI components and variants. Compose them before creating a new primitive. |
| Product headings, paragraphs, labels, and inline text | HeroUI Native `Typography` | Use semantic type, color, weight, and alignment props instead of React Native `Text` and screen-local font styling. |
| Screen stacks, titles, back buttons, headers, and route transitions | Expo Router native `Stack` | Configure them in route layouts or screen options instead of drawing custom headers. |
| Tab navigation | Expo Router `NativeTabs` | Use native tab triggers, labels, badges, and platform icons instead of a custom tab bar. |
| Search integrated with navigation | `Stack.SearchBar` and native toolbar search slots | Do not place a HeroUI input inside a handmade navigation bar. The home search field and the Marketplace field are the documented exceptions; see [Home search](#home-search) and [Marketplace search](#marketplace-search). |
| Header and bottom toolbar actions or menus | `Stack.Toolbar` native items | Let the platform render placement, materials, menus, and interaction behavior. |
| Route-level modals and form sheets | Expo Router native presentations | Prefer native modal or form-sheet presentation over a custom full-screen overlay. |
| Native pickers, switches, sliders, menus, and grouped system forms | `@expo/ui` | Use when the interaction should look and behave like a platform control. Keep every `@expo/ui` tree inside `Host`. Import `MenuView` from `@/shared/components/menu-view`, not `@expo/ui/community/menu`. iOS keeps the native menu. Android draws the HeroUI `Menu`, because the Material menu takes the device palette and shape, and shows a Lucide icon for each SF Symbol `image` that the component maps. Add the mapping when you use a new symbol. |
| Large or unbounded data lists | React Native `FlatList` or an approved virtualized list. The chat uses Legend List (`@legendapp/list`) | Do not use a non-virtualized component for feeds or large search results. |
| Custom in-content glass surface | `expo-glass-effect` | Use sparingly, only when glass is part of the product content rather than navigation chrome. Provide non-glass and reduced-transparency behavior. |

Native ownership takes priority over HeroUI for navigation chrome. HeroUI ownership takes priority for application content.

## Liquid Glass and platform behavior

- Obtain Liquid Glass through native navigation components. Do not imitate it with blur views, gradients, translucent HeroUI cards, shadows, or screenshots of glass.
- Do not replace native headers, tab bars, toolbars, or search bars with `GlassView`. `expo-glass-effect` is for deliberate custom content surfaces, not for rebuilding system chrome.
- Preserve platform safe-area and scroll-edge behavior. Ordinary screens normally use automatic content inset adjustment. Native sheets use the shared `SheetScrollView` header handling described below; do not add a second automatic inset or screen-local spacer.
- The home list is the fallback exception for a full screen: iOS 27 shows no native scroll edge effect under its header. Its native header is transparent on iOS and Android, the native top edge is hidden, and the screen draws the canvas `SheetScrollEdgeEffect` of the chat header under the native buttons
(on iOS; Android draws the solid Material bar of the big header). Android pads the list by the header height, because it has no content inset.
- Avoid forcing opaque colors or bespoke backgrounds onto native chrome unless the product requirement explicitly calls for it. Let the operating system adapt materials to the platform version, appearance, accessibility settings, and scroll state.
- Treat older iOS versions and Android as first-class fallbacks. The interface must remain complete and readable when Liquid Glass is unavailable or reduced transparency is enabled.
- Use platform-native icons in native navigation (`sf` on iOS and the corresponding Material icon on Android). Use the existing application icon convention for HeroUI content.

### Big headers

Home, Routines and Usage have a big header that the screen draws, not `headerLargeTitle`. The native
large title does not work under the custom scroll edge effect on iOS 27, and Android has none. Use
`src/shared/components/large-title.tsx`:

- `useLargeTitleScroll` gives the scroll handler and the scroll distance from the rest position.
- `LargeTitle` is the first item of the scroll content: an optional caption (the server name) and the
  34 pt bold title. On iOS a pull past the top grows it a little, as the native title does.
- `LargeTitleBar` draws the scroll edge effect and the 17 pt small title. The small title fades in,
  4 pt up, in 200 ms when the text of the big title reaches the bottom of the bar.
- Android uses Material 3, not an iOS copy: a 28 dp bold title (a medium top app bar), the surface
  solid under the bar and a 32 dp fade below it, as the top fade of the design,
  a 22 dp regular small title on the 72 dp line, and 48 dp icon buttons with a round ripple: a 40 dp glass circle on full screens, the plain icon in sheets.
- Android has no Liquid Glass, and its blur does not work over a scroll view. The search field and the
  bar buttons use `useChromeGlass()`: the solid glass of the design (`--openbot-bg-chrome-glass`, 94-96%
  opaque), a hairline edge, a soft shadow and the top light of `ChromeGlassSheen`. The home search
  field has a real blur on Android 12 and later: the home content is in a `BlurTargetView`, and the
  field draws a `BlurView` of it (radius 24) under the lighter `--openbot-bg-chrome-blur` fill. While
  the results are open, the field shows the solid glass over the blur, because the results are not in
  the target. iOS without Liquid Glass keeps the solid capsule.
  Stacks set `androidBackOptions` in `screenOptions`, so the back button of every inner page, in
  sheets too, is the same round button and not the native arrow.
- `LargeTitleScrollView` puts grouped content under a big header on the sheet surface.

The native header stays, transparent, with an empty title. It keeps the native Liquid Glass buttons on
iOS: back, `Stack.Toolbar` actions and menus. Android draws its buttons with `AndroidHeaderButton`,
and the stack draws the back button with `androidBackOptions`. Text sizes that HeroUI `Typography` has no variant for come from
`src/shared/lib/type-scale.ts`; spread them into `style`.

### Home search

Search is a field at the bottom of home (`features/search/components/home-search.tsx`), not a header
button or a sheet. It is an in-content glass surface: `GlassView` with Liquid Glass, and a solid
`default` capsule without it or with Reduce Transparency. The field rides on the keyboard. When it
takes focus, the results come in over the list (220 ms, opacity and 8 pt up; opacity only with
reduced motion), a close button comes in beside the field, and the drawer pan stops. Close, Android
Back, or a result closes them in 160 ms. With no query the results show shortcuts and the agents of
the server; a query shows the same sections as before, with `BlurSwap` between states.

### Marketplace search

The Marketplace page (drawer → Marketplace) has the same bottom field as home, for the same reason:
it is the one control of a page that the thumb reaches, and it rides on the keyboard. It uses the
shared `GlassCapsule` (`src/shared/components/glass-capsule.tsx`), so the glass, the solid fallback
and Reduce Transparency behave as on home. `Stack.SearchBar` would put the field at the top and
leave the filter without a place.

The filter is a glass button beside the field, in its own capsule, that opens a native `MenuView`:
the kind (one inline group), a category submenu, and Installed only. It is not inside the field: on
iOS the menu grows out of the view it opens from, so a button in the field would take the whole field
into the menu. Android shows the categories as one more group of the menu, not as a sub-menu: the
Android menu draws a sub-menu as a layer under its row, which runs off the screen above a bottom field.
The Android menu opens above a button in the lower half of the screen and fits its height to the room
there. Each filter that is set shows as a token in the field, and a tap on a token removes it. A filter or a query turns the overview into one grouped list in place;
there is no results overlay. A close button comes in beside the field while it has focus or text.

A listing opens as one sheet with a nested stack. The first page shows the listing as the desktop
page does: one header card on the listing's gradient (`ListingGradient`, the still colours of the
desktop `SkillGradient`) with the icon, name, creator and kind, and an example request or the agent's
skills under them; then the facts in a grid of two columns, and the content (SKILL.md, an agent's skills and routines, an app's prompts). The `+` in the native header
installs. A skill opens the agent choice as the next page, and an app that asks for a key or a
sign-in opens its connect page; each page has its own `SheetSaveAction`. The arrow on an example request is the desktop Try: it puts the request
(a skill keeps its `@[name](skill:id)` marker) in an agent's message field and the chat replaces the
sheet, as Agent info > Skills does for a new skill. Several agents that can use it are a native menu.

## Wide windows and iPhone Duo

The app supports iPad and iPhone Duo. Apple and Expo ask for one design that widens, not a design
for each device or pose: a folded iPhone Duo is a compact window, and an open one is a wide window.

- `AdaptiveSplit` (`src/shared/components/adaptive-split.tsx`) decides the layout from the window.
  A window 700 pt or wider (iPad in both orientations, the open iPhone Duo, an open Android foldable)
  shows the chat list as a pane beside the stack. Narrower windows (phones, the folded iPhone Duo, a
  half of Split View) show the stack alone, as before.
- A vertical fold, from `react-native-reserved-regions`, ends the pane, so neither column lies across
  it. Without a fold the pane takes about a third of the window, from 320 to 400 pt.
- The pane has two modes, kept across starts (`split-pane-preference.ts`): the full list, or a rail
  of avatars (`ChatListRail`, 76 pt and the side inset). Only a drag on the divider changes it, with
  no button: it resizes the list (320 pt to 520 pt, and the detail keeps 380 pt), and a drag or
  flick past the middle collapses it to the rail, or opens the rail again. The pane width follows
  the finger on the UI thread. The list never lays out narrower than 320 pt: the pane clips it,
  and below that the list fades out as the rail fades in (`SplitPaneLayers`), so nothing snaps. With a fold, the
  list keeps the fold width; the rail gives the detail the rest of the window. The divider is an
  `adjustable` element for screen readers.
- The bar of the pane fits 320 pt: the connection state takes the room that the buttons leave. On
  iOS its 48 pt buttons, and the chat header's beside it, are centred in the native bar height
  (`NATIVE_BAR_HEIGHT`: 50 pt on iPad, 44 pt on iPhone), so they line up with the native bar buttons
  of the other screens (Threads, Marketplace and others). A phone keeps the chat header 8 pt down.
- On a wide window, bottom search fields (home, Marketplace) take the resting height and bottom gap
  of the chat composer (`useBottomFieldMetrics`, from `shared/lib/composer-metrics.ts`), so they line
  up with the composer beside them. The phone keeps the large field. Use the hook for a new one.
- The stack stays mounted when the layout changes. A chat that is open when the device folds stays
  open, with its state. Home then shows the list again under it.
- On a wide window, `connected` shows the empty detail, the pane draws its own bar (the native bar
  belongs to the stack), a chat opens in place of the chat before it, and a chat beside the pane has
  no Back and no edge swipe (`useSplitDetailRoot`).
- Each column has its own `SafeAreaProvider`. Use `useSafeAreaInsets()` for the column insets, and
  `useColumnWidth()` in place of the window width for a view that sizes itself.
- Pad content by `insets.left` and `insets.right`, not only top and bottom. The iPhone Duo rail
  takes 84 pt on the left or the right, and landscape has side insets too. Keep backgrounds edge to
  edge, pad the content, and give absolute buttons `left: insets.left + N`. Put the insets outside a
  scroll view with `contentInsetAdjustmentBehavior="always"` (a margin on the scroll view), because
  iOS would also inset its content by them.
- Native headers, toolbars and sheets place themselves, rail included. Do not move them by hand.
- While iOS shows the vertical bar (`useVerticalBarShown`), it moves native bar buttons (Back, icon
  buttons, menus) into it; custom views (`Stack.Toolbar.View`) stay at the top. A JS header cannot
  move, so `ChatHeader` then shows the native bar with its Back, browser and actions as toolbar items
  and its title pill as a custom view. Give a new screen native bar items, not JS buttons.
- With the vertical bar, the top inset has no status bar and iOS makes the top bar shorter than the
  stack reports. The bars start at `useBarTop()` (at least 20 pt from the top edge), and the
  large-title screens pad their content themselves (`scroll.ownsInset`, as on Android), so the
  caption stays below the scroll edge effect. Without the vertical bar nothing changes.
- Check folded, open, partially open, Split View and rotation on iPhone Duo, iPad in both
  orientations, and a standard iPhone, which must not change.

## Sheets

The sheet style is a neutral iOS-style grouped surface: a white/light-gray sheet in light mode,
charcoal in dark mode, gently contrasting groups, muted descriptions, inset separators and soft
16 pt group corners. Keep this visual language consistent across settings, add/edit forms and
other sheets. The system owns the outer sheet shape and presentation. On Android, the system sheet
has square corners, so the parent stack sets `sheetCornerRadius: 28` there.

### Native presentation and headers

Register standalone sheet routes in the existing Expo Router stack. The current configuration for
a standalone sheet with a native title is:

```tsx
{
  presentation: "formSheet",
  sheetAllowedDetents: [0.85],
  sheetGrabberVisible: true,
  sheetExpandsWhenScrolledToEdge: false,
  contentStyle: { backgroundColor: sheetBackground },
  headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
  headerTransparent: isIOS,
  headerBlurEffect: "none",
  scrollEdgeEffects: { top: "hidden", bottom: "soft" },
  title: "Profile",
}
```

Resolve `sheetBackground` from `--openbot-bg-sheet`, as in `src/app/(app)/_layout.tsx`.
Keep `headerShadowVisible: false` from the parent stack. A headerless sheet uses
`headerShown: false`; do not add a fake navigation bar. Full-height detents are appropriate for
search or similarly large content, not the default for a short form.

On Android, react-native-screens draws no header on a `formSheet` route, so its title,
`AndroidHeaderButton` and `SheetSaveAction` do not show. A sheet that needs them on Android uses the
nested stack below, even for one page. A one-page sheet uses `SheetPageStack` in its `_layout.tsx`, as
`add-agent` and `install-agent` do. Android also puts a full-height (`[1]`)
sheet under the status bar, which covers the header; such a sheet uses `[0.85]` on Android.

Multi-page flows such as Settings stay inside ONE sheet. Register the outer `settings` route with
`presentation: "formSheet"`, `headerShown: false`, a grabber and stable detents `[0.85]`.
Its `settings/_layout.tsx` owns a native `Stack`; detail routes use `presentation: "card"`,
`headerBackButtonDisplayMode: "minimal"` and the same transparent header styling. `router.push`
opens an inner page and `router.back` returns to the previous page without dismissing the sheet.
Do not register each settings page as another modal. Use `initialRouteName: "index"` so direct
entry into a detail page has a back route. `add-server` follows the same shape: its outer route is
the sheet, `add-server/_layout.tsx` owns the stack, and the invitation scanner is the inner `scan`
page rather than a full-screen modal over the sheet.

All sheets require a stable viewport. Use fixed detents for standalone forms and nested
navigators; do not use `fitToContents` or measure content to set the sheet height. Preserve the active
page and unsaved input when navigating forward and back; do not replace routing with conditional
screen rendering or a custom back-button imitation.

Settings has one detent, `[0.85]`, so a drag cannot expand it to an otherwise unnecessary second
height. The parent stack sets `sheetExpandsWhenScrolledToEdge: false` for sheets. Overflow belongs
to the content scroll view, not a larger sheet detent. Native dismissal remains available.

`headerTransparent` alone does not remove a configured blur material. Do not restore
`systemMaterial` or another `headerBlurEffect` on these sheets, or put an opaque header color back
on iOS. `SheetScrollView` draws the top progressive blur with the existing
`SheetScrollEdgeEffect` behind the native title and actions. The native top edge is hidden to
avoid two effects. Keep the bottom edge explicitly soft.

This is a fallback for the missing native effect reported on iOS 27 in both Expo Go and
TestFlight, even with an explicit soft edge. The native cause is not yet confirmed. The fallback
uses installed visual components and keeps native navigation controls. It does not require
a new native dependency.

### Save and create actions

Use `SheetSaveAction` for every form with an explicit save or create action. Put its checkmark
on the right of the native header. Do not put a second Save/Create button in the content.

- Hide the action until the draft differs from the saved values (or initial creation values).
  Restore the initial values to hide it again. Keep validity separate from change detection.
- Show a disabled checkmark for changed but invalid input or an unavailable host. Keep validation
  and request errors in the form. A failed request keeps the draft and permits retry.
- Disable the action and fields during the request, expose a pending accessibility label, and
  prevent duplicate requests and dismissal. Hide the action after a successful save. A successful
  create returns to the previous page after the draft guard is released.
- Use a clear accessible action name, such as `Save name` or `Create agent`, even with an icon.
  Preserve keyboard submission where the form supports it.
- Standalone creation forms have a native close (`×`) action on the left. Nested pages keep the
  native back button. Closing or going back must respect existing unsaved-change guards.
- Keep `SheetScrollView` in charge of header clearance, safe areas, and keyboard behavior.
  Do not add footer spacing for the header action.

### Scroll ownership

Use `src/shared/components/sheet-scroll-view.tsx` as the root scroll container. In particular:

- Keep native bounce on iOS and `overScrollMode="auto"` on Android for content that overflows.
  Use `alwaysBounceVertical={false}` so content that fits stays still. Do not force hard stops
  at the edges by disabling bounce or overscroll globally.
  Keep scrolling enabled. Do not use content measurements or keyboard visibility to decide
  whether scrolling is available. The native scroll view handles content that fits.
- With an iOS native header, it reads `HeaderShownContext` from `expo-router/react-navigation`
  and uses automatic content inset adjustment when the header overlays the content. UIKit owns
  the clearance under the header and its relationship to the native scroll edge. Do not replace
  this with a padding view or add another safe-area wrapper. A non-overlay header uses `never`
  because navigation already places the content below it.
- Under an overlaid iOS native header, a fixed `SheetScrollEdgeEffect` covers the measured
  header height and a 48 pt fade. It follows the scroll view as a sibling so it cannot intercept
  gestures or obstruct first-child scroll view discovery. Its position does not depend on scroll
  events. Headerless sheets keep their existing shared edge behavior; non-overlay headers do not
  add a blur overlay.
- Keep the scroll view reachable directly from the sheet. `SheetScrollView` uses `flex: 1`
  to fill the fixed viewport. Keep the last action in the same scroll flow, with the existing
  bottom safe-area utilities, so it remains reachable on small screens and with the keyboard open.
- Use `keyboardDismissMode="interactive"` and `keyboardShouldPersistTaps="handled"` for forms,
  following existing screens. Reuse `SheetFormField` instead of rebuilding its platform inputs.
- `SheetScrollView` uses `KeyboardAwareScrollView` to reveal the focused field and keep the last
  action reachable above the keyboard. Keep `mode="insets"` so keyboard clearance does not add a
  layout spacer. Use `disableScrollOnKeyboardHide` to keep the user's position. The keyboard-controller 1.22.7 patch shrinks insets during dismissal and
  clamps only the current offset beyond the remaining content, instead of replaying a saved offset
  after a new drag. Check that event sequence again when the library changes. Leave
  `automaticallyAdjustKeyboardInsets` disabled and do not add another keyboard-avoiding wrapper. Verify tapping outside a field followed immediately by scrolling,
  interactive keyboard dismissal, reaching the final action, and both short and long content.

### Palette, groups and text

On iOS, sheet edges use `ProgressiveSheetBlur`: six weak native blur layers with separate,
overlapping smooth masks. Each mask becomes transparent before the physical view edge.
The material follows the system theme. In dark mode a masked `bg-sheet` layer at 70% opacity
covers it, because the dark material is lighter than the dark sheet. Render it
following the scrolling content so the native blur samples that content. The masks are static;
scrolling does not update React state. This approximates a variable blur radius using public
Expo APIs, as described in [Beautiful Expo](https://github.com/davidmokos/beautiful-expo).
Android sheets draw no edge blur. Below the opaque native header, or at the top of a sheet with no
header, the content fades into a 32 dp masked `bg-sheet` layer. The fade follows the same rule as the
iOS blur. A sticky custom header, such as search, uses the opaque `bg-sheet` color. Chat, home list
and drawer edges keep their canvas effect.

The values belong to `packages/brand/src/tokens.css` and `tokens-native.css`; `global.css` only
maps them to utilities. Do not copy these hex values into components.

| Role | Utility | Light | Dark |
| --- | --- | --- | --- |
| Sheet background | `bg-sheet` | `#fcfcfc` | `#141414` |
| Group background | `bg-grouped` | `#f2f2f2` | `#212121` |
| Supporting text | `text-grouped-secondary` | `#69696e` | `#96969b` |
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
rows do not have chevrons; destructive actions use `text-danger-text` instead of a filled red block.
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
replace the label with a separate form that moves the surrounding content. Show the header checkmark only after
the name changes, disable it for invalid input or a pending request, and let Cancel restore the
saved name. Reserve a compact Cancel area so editing does not shift the page.
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

Use `text-muted` for readable timestamps, reply references and code labels. Reserve dim colors
for decoration or inactive controls. Status text on neutral surfaces uses `text-success-text`,
`text-warning-text` or `text-danger-text`; `success`, `warning` and `danger` remain fill colors.
The text colors must retain at least 4.5:1 contrast on the surfaces that use them in both modes.

Fixed colors in camera overlays, QR codes, SVG alpha masks and agent artwork serve their
respective media or identity roles. Do not replace these with foreground/background theme colors.

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
