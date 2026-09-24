# @openbot/ui

Internal SolidJS component library for OpenBot desktop, public web, and Storybook.
The source files are moved from the desktop renderer; there is one implementation.

```tsx
import { Button, Input } from "@openbot/ui";
import { cx } from "@openbot/ui/utils";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
```

Load `@openbot/brand/tokens.css` and `@openbot/ui/styles.css` in the consumer stylesheet.
Tailwind consumers must scan `packages/ui/src`. Application styles still supply feature
layouts and theme aliases. Use the repository's pinned Solid 2 runtime and patched Kobalte.

Keep components independent of application contexts, Electron, storage, authentication,
and network clients. Receive data and callbacks through typed props. Do not import files
from `src/renderer`, `src/main`, `src/backend`, or `src/preload`.

Native mobile clients share brand tokens and contracts; they do not consume SolidJS DOM UI.

Feature components include account screens, sidebar, server navigation, message rendering,
composer editor, attachments, previews, agent setup, and settings panels. Their local
interaction state can live here; account sessions, host transports, desktop persistence,
and the full conversation controller belong to consumers. The move preserves existing
markup and styles. Shared feature CSS lives in the package and is imported by the app stylesheet in its original order.

The package also contains direct conversations, question prompts, provider code sign-in,
provider selection, skill previews, panel resizing, file previews, and browser preview cards.
Renderer adapters supply translations, link opening, preview capture, and panel preferences.
The adapters keep storage keys and native behavior unchanged. Shared component CSS is exposed
through explicit stylesheet subpaths; preserve its order in the consumer stylesheet.
