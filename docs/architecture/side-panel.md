# Side panel

## Side panel panes

The side panel is on the right side of a chat. Each open pane has a tab at the top of the panel.
File tabs and side threads also have tabs there, but they have their own models: `SidePanelState.files`
in `panels-store.ts` and the thread list of the agent. The pane registry does not include them.

This is an internal extension point for built-in features. It is not a plugin API.

### Where each part is

| Part | Owner |
| --- | --- |
| Pane id, label key, and icon | `SIDE_PANEL_PANES` in `packages/ui/src/features/conversation/SidePanel.tsx` |
| Pane type and id check | `SidePanelPane` and `isSidePanelPane`, from the same record |
| Panel mode of a pane | The pane id. `RightPanelMode` in `conversation-types.ts` includes `SidePanelPane` |
| Open tabs, selected tab, maximize | `SidePanelState` in `stores/panels-store.ts` |
| Open, close, and the tab that shows after a close | `openSidePanelPane`, `closeSidePanelPane`, and `showSidePanelInPlaceOf` in `conversation-scope.ts` |
| Work of a pane when it opens or closes | `sidePanelPaneActions` in `conversation-scope.ts` |
| Availability | `sidePanelPanes` in `ConversationPanels.tsx`, and the entry point of the feature |
| Content | The feature component, shown from `ConversationPanels.tsx` when `activeRightPanel()` is the pane id |

The tabs, the Add menu, and the launcher read the label and the icon from `SIDE_PANEL_PANES`. The
panel store finds the pane of a panel mode with `isSidePanelPane`. Thus a pane needs no separate
mode map.

### Add a pane

1. Add a label key `conversation.sidePanel.pane.<id>` to each catalog in
   `packages/i18n/src/messages/*/conversation.ts`. Read [docs/i18n.md](../i18n.md) first.
2. Add the pane to `SIDE_PANEL_PANES` with its label key and an icon from `@openbot/ui`. The
   order of the record is the order of the launcher and of the Add menu.
3. Show the content in `ConversationPanels.tsx` when `activeRightPanel()` is the pane id. Keep the
   content component, its store, and its calls in the owning feature. Give a shared component typed
   props, as [packages/ui/AGENTS.md](../../packages/ui/AGENTS.md) says. The content calls
   `closeSidePanelPane(<id>)` to close its own tab.
4. Control availability:
   - To list the pane in the launcher and the Add menu, add a rule to `sidePanelPanes`. The rule
     must be true only when the content can show, for example only when an agent is open.
   - A pane that opens from one place only, such as a side question or a subagent, is not in
     `sidePanelPanes`. Its entry point checks availability before it calls `openSidePanelPane`.
5. Add an entry to `sidePanelPaneActions` only when the pane must do more than show its mode:
   - `open` runs in place of the mode change. The Browser pane uses it to start a tab.
   - `release` runs before the tab closes. The question pane uses it to delete its question.
6. Release long-lived resources in the owning feature. A store can watch
   `SidePanelState.panes` and stop when its pane leaves the list. A component releases its own
   resources in `onCleanup`.

### Close behavior

`closeSidePanelPane` runs the `release` action, removes the tab, and keeps the order of the other
tabs. When the closed pane showed, the panel shows, in this order:

1. The pane next to the closed tab.
2. The first side thread.
3. The last file tab.
4. The pane list, when no tab stays.

The panel keeps its tabs while it is collapsed. Each agent and each channel has its own tabs.

### Verification

A change to the registry or to pane behavior must keep the behavior of the existing panes. Check
these in the real app:

- Open and select each pane from the launcher, the Add menu, and its own entry point.
- Close the selected tab and a tab that is not selected. The next tab must show.
- Collapse and open the panel again. The same tab must show.
- Maximize and restore the panel.
- File tabs and side threads beside the panes.
- Switch to another agent or server and back.
- The question pane deletes its question on close.

`scripts/side-panel-panes-e2e.ts` checks the launcher and Add menu order, selection, close, collapse,
maximize, an agent change, and the side question release in the `App/Playground` story.
`scripts/web-side-panel-e2e.ts` compares the web and desktop panels in Storybook.

An agent change closes Agent settings, Files, and a file preview (`resetPanelsForAgent` in
`conversation-scope.ts`). The tabs stay.
