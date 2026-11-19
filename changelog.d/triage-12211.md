### Fixed

- WhatsApp: when an agent posts text with one image or file, the text is now the caption of the file,
  in one message. Before, the text could go missing while the image arrived, and the agent said that
  the post was sent.
- WhatsApp: when the connection closes after OpenBot sent a message, but before WhatsApp confirmed
  it, the message is sent again. Before, the message could be lost while OpenBot counted it as sent.
