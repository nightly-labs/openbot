# Shared SolidJS UI

Follow the SolidJS, accessibility, and design-token guidance in
[renderer instructions](../../src/renderer/AGENTS.md).

This package owns shared primitives and feature UI: sidebar, account screens, server controls,
message rendering, composer editor, attachments, preview renderers, and reusable settings panels.
Primitives live in `src/`; feature components and their local interaction logic live in
`src/features/<domain>/`. Export features through explicit package subpaths. Shared display
models live in `src/data.ts`.

Keep app contexts, desktop persistence, host transports, and platform controllers in consumers.
Do not import renderer, main, backend, or preload code, or call `window.openbot` here.
Receive data and actions through typed props and callbacks. Move components; do not copy them.
Preserve existing markup, styles, and behavior unless the user requests a design change.
Shared feature CSS lives in this package. The app stylesheet imports it in the existing order.
`features/conversation/conversation.css` is the ordered style manifest. Keep component rules in
its `styles/` directory and preserve override order. Do not import those fragments separately.
Keep platform features in typed content slots or adapters, not environment checks in shared UI.
Biome rejects desktop preload access as well as application imports; keep its boundary fixtures
in `tools/ui-foundation/fixtures` when extending the rule.

Check affected desktop, public web, preview, and Storybook consumers. Existing feature tests
remain in the renderer test harness and import this package. Run focused checks only, as required
by the root instructions. Native mobile consumes shared brand tokens and contracts, not this UI.
