### Fixed

- A sign-in card from an agent now shows when the agent names the browser tab as other browser
  tools take it, such as `tab_id`. Before, the request failed with "OpenBot could not create a
  browser takeover request", and you got no card. When OpenBot still cannot show the card, the agent
  now gets the reason, such as a closed tab or a tab from a different chat, so it can try again or
  tell you what to do.
