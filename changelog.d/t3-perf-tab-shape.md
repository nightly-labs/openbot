### Changed

- A chat switch takes less work in the app window. The selected-tab shape in the chat header now
  moves with the layout that the window already does for each frame. It no longer makes the window
  calculate the page layout again after each header change. In a test with 20 chat switches, the
  blocked time of the window went down by 12%.
