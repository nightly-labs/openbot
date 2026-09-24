---
name: openbot-avatar
description: Make a new avatar image for yourself from a description and set it as your OpenBot avatar. Use when the user asks you to generate, draw, or change your avatar picture.
---

# Make your avatar

The result is a square 512 by 512 pixel image that OpenBot shows as your avatar. Do all steps in one turn. Do not ask questions unless the description is empty.

1. Make one image from the user's description. Use the image generation tool of your provider, such as Codex image generation or the Grok image tool, or any image tool or MCP server you have. Ask for a square image.
2. If you have no image tool, draw the image with code: write an SVG, then convert it to PNG with a local tool such as `rsvg-convert`, `sips`, `magick`, or Python. Do not install software for this.
3. Design for a small circle: one centered subject, a simple background, strong shapes, and no text, logo, or watermark.
4. Save a prepared copy at `.openbot-avatar/avatar-<timestamp>.png` in your working directory. Crop the center to a square and resize it to exactly 512 by 512 pixels. Keep the source image unchanged.
5. Make sure the file is PNG, JPEG, or WebP and at most 512 KB. If it is larger, save it as WebP or JPEG at a lower quality, then check the size again.
6. Call `openbot.update_profile` with your own agent id from `agent_profile` and `avatarPath` set to the prepared file. Do not send `name`, `title`, `description`, `avatarSeed`, or `avatarHue`.
7. Call `openbot.attach_files_to_response` with the prepared file, then answer in one short sentence.

If a step fails, tell the user what failed in one sentence. Do not report the avatar as set unless `openbot.update_profile` succeeded.
