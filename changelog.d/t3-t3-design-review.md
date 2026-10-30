### Changed

- Settings pages have three clear text levels: a larger page title, bold section titles, and the
  rows below them. Before, section titles were smaller than their rows. In agent settings, group
  titles are now larger than the sidebar text.
- Lines and dim text in the dark theme have more contrast. Placeholder text in fields is now less
  bright than the text that you type.
- Dialogs, menus and cards use one set of corner radii. All dialogs now have the same corners.
- Direct messages use the same text size as channels. In the sidebar, the time and the message
  preview of an agent now have the same size, weight and colour, lighter than the name.
- All search fields have the same corners as other fields.
- A switch that is off has a white thumb on a grey track in the light theme, and a bright thumb in the
  dark theme, so it does not look on or disabled.
- Icons use one stroke width and the standard icon sizes in all of the app. The stroke is a little
  heavier, so icons read as clearly as the text beside them.
- Text uses the optical sizes of Inter: small text is more open and large titles are tighter.
- Copy and Expand on a code block show when you point at the block or move to it with the keyboard.
- The failed-task tray uses neutral colours, a warning icon and a secondary Continue button.
- Sidebar rows no longer show role chips, so names have more space. Screen readers still read the
  role.
- Agent names in channel activity and the usage ring use neutral text colours.
- Secondary buttons have a visible background. Composer buttons have the same hover colour.
- Labels in Mermaid diagrams sit on the diagram background, not on a separate box. Boxes have
  rounded corners, a raised fill and a clear edge in both themes.
- In the server menu, all server names start at the same edge. A check at the end of the row marks
  the current server.
- All selects on a settings page have the same width, so the controls make one column.
- The white logo colour has a visible edge in the light theme. The selected colour has no shadow.
- In a code preview, the Preview and Code switch stands beside the language label.
- Reassign in the failed-task tray is a button like Continue.
- The rail shows the current page in the light theme. Usage rings in the rail have the icon stroke.
- A switch that is off has a visible track on a card in both themes.
- The selected side panel tab has a fill in the light theme too.
- In agent settings and other forms, the Model field has the same up and down arrows as the selects
  beside it.
- Small buttons use the body text size. Before, every button size used the larger 14px text.
- A wide Mermaid diagram scrolls sideways in a narrow column, so its labels stay readable.
- Times in a conversation use one form, as the day separators do: "Yesterday 11:55" or
  "Mon 26 Oct 12:55". The year shows only for an earlier year.
- File type badges such as MD, CSV and XLSX have larger letters.
- A provider update notification shows its close button at all times, beside Update.
- In agent settings and other forms, field labels and group titles start at the edge of their fields
  and cards, and field labels are medium weight.
- A file name in a message has one link colour. The badge before it shows the file type colour.
  LOG and TXT files have a text badge, as other file types do.
- Fields, selects and colour swatches have a stronger edge, so they are easier to see in the light
  theme.
- The selected agent colour and face have no shadow.
- Settings pages have a Back button before the title, as the usage page has. Escape now also closes
  the usage and schedule pages.
- Messages in a conversation sit closer together, and sidebar rows have a smaller gap.
- In the server menu, "Add remote server" has a plain plus icon. The check that marks the current
  server has more space before the submenu arrow.
- A code block with only its language shows the language as a plain title, not as a button.
- Setting descriptions use the small text size, one step below the setting name.
- The selected logo color has a round ring, as the color has.
- Boxes in Mermaid diagrams have a clear edge in the light theme. Before, the edge almost disappeared.
- Each provider in the rail has one usage ring, for the limit that stops work first. The hover card
  still shows every limit. The provider logo in the ring is larger.
- A wide Mermaid diagram has a thin scroll bar in the edge colour.
- A switch that is off has the same edge as a field.
- In a run of conversation events from the same minute, only the first event shows the time.
- Sidebar unread counts are less bright than agent names.
- The website and the status page use the same type sizes, weights, letter spacing and corner
  radii as the app. Website text uses the optical sizes of Inter, so long titles take fewer lines.

### Fixed

- Notifications show below the window header, so they no longer cover the header buttons.
- Reassign in the failed-task tray no longer looks disabled.
- A file in a message no longer shows a stray "@" before it, or a wide gap after it.
- Punctuation after a file name in a message no longer has a gap before it.
- An agent name in a message no longer makes its line taller than the lines around it.
- The last event in a channel no longer touches the failed-task panel below it.
- Small code labels in code previews and in chat visuals used the default text size because their
  size token was missing. They now use the small text size.
