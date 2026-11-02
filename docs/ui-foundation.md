# OpenBot UI foundation

OpenBot uses a compact control scale: 24 px for supporting elements, 28 px for toolbars, 32 px as the standard and 36 px for important actions. Every global `--openbot-*` token is declared in `packages/brand/src/tokens.css` — a single file that web and mobile import as well — with its dark value; `src/renderer/src/styles.css` only imports it, then `tokens-light.css`, and adds the renderer's animation variables.

Dark is the default. The light palette in `packages/brand/src/tokens-light.css` changes token values, never declares a token, and applies when the root element has `data-openbot-color-scheme="light"`. On the desktop, main keeps the Settings choice (System, Light or Dark), and each window applies it to the attribute and resolves System from `prefers-color-scheme` (`src/renderer/src/color-scheme.ts`); the Dynamic Island stays dark. Main leaves `nativeTheme.themeSource` on the system, so visited websites and the native menus follow the computer. On macOS, Settings also has Transparent window: main gives the main window the `under-window` vibrancy and a clear background, and the window sets `data-openbot-window-glass` on the root. `src/renderer/src/styles/window-glass.css` then tints only the frame, the content card and the pages that fill the card; the surface tokens stay solid, so dialogs, menus, toasts and cards do not change. The blur takes its light or dark shade from `themeSource`, so while the window is transparent, main sets `themeSource` to the theme, and websites and native menus follow the theme too. The web client at `/app` keeps the choice in browser storage. The public site never sets the attribute. Code that cannot use the tokens in CSS, such as Mermaid or a sandboxed chat visual, reads the scheme through `@openbot/ui/document-color-scheme`. Storybook has a Color scheme toolbar. The reset and base roles are in `styles/base.css`, the primitives in `packages/ui/src/styles/primitives.css`, and a screen's rules in its own feature stylesheet — `features/<domain>/<domain>.css`, imported from `styles.css` in an order that is the cascade. The exception is `styles/app-shell.css`: its tail is a theme layer shared by every domain, so it stays whole (the reason is documented in the file header). None of these files defines a palette of its own.

## Public API

Features — the `src/renderer/src/features/<domain>/` directories — import primitives from `@openbot/ui` only, and shared feature components from explicit subpaths such as `@openbot/ui/features/sidebar/Sidebar`. Direct imports from Kobalte and Lucide are forbidden. Kobalte is a behaviour engine, not the application's public API; that is what lets it be upgraded without touching a feature.

- `Text` and `Heading` — interface text; pick the semantic `as`, and the look through `variant` or `size`.
- `Button` — an action with a label. `default` serves the single most important action in a context, `secondary` standard actions, `ghost` toolbars, `destructive` destructive operations, and `link` actions embedded in text.
- `IconButton` — a standalone icon; always pass `label`. `tooltip` may add the shortcut, but it does not replace the accessible label.
- `Badge` — a short, non-interactive state or category. Do not use it as a button.
- `Input`, `Textarea`, `NativeSelect` — native controls in a uniform anatomy. Wrap them in `Field` to wire up label, description, error, `required` and `aria-describedby` automatically.
- `Switch` — an immediate change to a binary setting. For a decision that needs the form submitted, use a checkbox or RadioGroup.
- `Card`, `Separator`, `Spinner`, `Skeleton`, `Kbd` — surface, structure and feedback elements.
- `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`, `Tabs`, `RadioGroup`, `Select`, `Combobox` and `Listbox` — the exported Kobalte adapters for complex interactions.

## Implementation rules

Colours must come from the semantic `--openbot-*` variables. Text sizes, radii and animation durations use tokens. Hover applies only inside `@media (hover: hover) and (pointer: fine)`, pressable controls use `scale(0.97)`, and animations stay below 300 ms and respect `prefers-reduced-motion`.

`bun run check:ui` blocks native buttons and switches, hand-rolled dialogs/menus/tabs/listboxes, direct Kobalte/Lucide imports outside the UI layer, and colour literals along with untokenized text sizes, radii and transition durations. The check covers every renderer stylesheet as well as inline declarations in TSX; the only place a colour literal is allowed is the shared palette `packages/brand/src/tokens.css`. It also checks that the complex namespaces have not gone back to direct Kobalte aliases. Every migration budget is zero, including the `data-testid` budget.

## Verification

Isolated components are checked in Storybook under `Foundations`. Full flows, dialogs, menus, the composer and the conversation are checked in the dev app. Every component should have default, hover, focus-visible, active, disabled and loading/empty states (where they apply), a keyboard test and an a11y story. A11y is a global Storybook gate (`test: "error"`).

## Which component to pick

- An immediate action: `Button` or `IconButton`; navigation embedded in text: the `link` variant.
- State or metadata: `Badge`; continuous feedback from work in progress: `Spinner` or `Skeleton`.
- A binary value applied at once: `Switch`; one choice from a short list: `RadioGroup`; a choice from a longer list: `Select`; a list that needs search or a custom value: `Combobox`.
- Several peer views: `Tabs`; a list of actions next to a trigger: `DropdownMenu`; a right-click context menu: `ContextMenu`.
- Light information anchored to an element: `Tooltip` or `Popover`; a task that needs focus: `Dialog`; an irreversible confirmation: `AlertDialog`.

## Dependency boundaries

`@kobalte/core@2.0.0-alpha.0` is pinned exactly and reachable only through `@openbot/ui`. The curated adapters in `packages/ui/src/complex.tsx` keep their public names regardless of the upstream structure and compensate for the alpha's lost focus after dialogs, menus and popovers close. A local Solid 2 RC compatibility fix is maintained by Bun in `patches/`; once Kobalte moves to a stable API, remove the patch first and confirm the wrappers behave without changing feature imports. Lucide icons also go through the shared `packages/ui/src/icons.ts` export; the logo, avatars and product artwork remain OpenBot's own assets.
