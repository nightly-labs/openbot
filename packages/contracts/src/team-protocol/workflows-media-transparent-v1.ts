// Frozen optional workflows-media-transparent-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: the `image` node of
// `workflows-media-v1` reads one more field, `background`. With "transparent", an image step of GPT
// Image (`gpt-image`) or Grok Imagine (`grok-imagine`) makes a picture whose pixels around the subject
// are clear. Any other value, a missing field, a video, and every other model make the model's own
// background. The step output stays as `workflows-media-v1` sets it.
//
// It adds no route. A client lets a person choose a transparent background only on a host that
// advertises it, because an older host ignores the field and makes an opaque picture. Widening any of
// it needs a second capability string.

export const WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY = "workflows-media-transparent-v1";
