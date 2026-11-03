---
name: "Alt Text"
description: "Write short, copyable alt text for images: the purpose of the image in its context first, 125 characters or less by default. Handles decorative images, charts, images of text, logos and linked images. Returns one copy block per image."
---

# Alt Text

## When to use

- When the user has images for a page, a post, a document or an email and needs alt text.
- When the user wants the alt text on a live page checked and improved.
- Not for a full page audit. Use Accessibility Audit for that.

## Inputs

1. **The images.** Uploaded files, or a page in `openbot_browser`. For a page, call `openbot_browser.list_tabs`
   first, then read the images and their current alt text from a snapshot.
2. **The context.** Where the image appears and what the text around it says. On a page, read it. For an
   upload, if the purpose is not clear, ask one question with `ask_user`: "What should a reader learn from this
   image here?"
3. **Length.** 125 characters by default. Use the user's limit when they give one.

## Steps

1. For each image, decide its type with the rubric below.
2. Write the purpose first: what the image tells or does in this place. Then add the detail that a reader needs
   and cannot get from the text around it.
3. Do not start with "Image of" or "Picture of". Screen readers already say it is an image.
4. Do not repeat a caption or the nearby text word for word.
5. Name people only when the user or the page names them. Do not guess who someone is, or their age,
   ethnicity, gender or health.
6. Count the characters. Cut adjectives and detail that does not serve the purpose.
7. If you are not sure what the image shows, say what is uncertain and ask. Do not invent.

## Rubric

- **Informative:** describe what it shows that matters here. One sentence.
- **Decorative** (adds nothing the text does not say): empty alt, `alt=""`. Say why it is decorative.
- **Functional** (inside a link or button, with no other text): name the action or destination, not the
  picture. "Search", not "Magnifying glass".
- **Text in the image:** transcribe the text exactly. If it is long, transcribe the key line and put the rest
  in a long description.
- **Logo:** the organization's name, plus "logo" only when the context needs it.
- **Chart or diagram:** the key takeaway in the alt text, then a short data summary in a long description
  below: the axes, the main values, the trend. Use only values you can read.
- **Pass rule:** the alt text says the purpose, fits the limit, invents nothing, and a reader who cannot see
  the image misses nothing important.

## Output

One block per image, ready to copy:

````
Image 1 — <file name or position on the page> — <type>
```
<alt text>
```
<n> characters. Current alt: "<current alt or none>".
Long description (charts and long text only):
```
<data summary or full transcription>
```
````

## Approvals and stop conditions

- Never edit the page, the site files or a document. You give the text; the user puts it in place.
- Do not describe private details in an image (faces of children, documents with personal data) beyond what
  the purpose needs. Ask the user when you are not sure.

## Common failures

- Describing every visual detail instead of the purpose.
- "Image of a chart" with no takeaway.
- Alt text for a decorative image that makes the reader listen to noise.
- A linked icon described as a picture, not as the action.
- Guessing names, numbers or text that are not readable.
