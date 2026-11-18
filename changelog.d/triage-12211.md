### Fixed

- WhatsApp: when an agent posts text with one image or file, the text is now the caption of the file,
  in one message. Before, the text could go missing while the image arrived, and the agent said that
  the post was sent.
- WhatsApp: a message is sent again when the connection closes before WhatsApp confirms it. Before,
  the message could be lost while OpenBot counted it as sent.
