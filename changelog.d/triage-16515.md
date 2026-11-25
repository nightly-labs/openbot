### Fixed

- A long chat with many images uses much less memory in the desktop app. Before, each image in a chat loaded its full-size file, also in a small tile, and a chat with 30 large images used about 600 MB more memory in the window. Image tiles now show a small copy of the image. A single image keeps its full-size file when the copy would look less sharp, for example on a high-resolution screen. The image viewer, Save and Open still use the full file.
- Scrolling a long chat with tables and code blocks does less work. Before, each table and code block that came into view measured its size at once and made the window calculate the layout again.
