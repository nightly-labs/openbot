// Frozen optional workflows-media-size-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: the `image` node of
// `workflows-media-v1` reads two more fields, `width` and `height`, when its `aspect` is "custom". Each
// is a whole number of pixels from 64 to 4096. The host asks the model for the aspect ratio nearest to
// width:height, at the smallest resolution of the model that is at least as large as the longer side
// (else its largest). It then crops the centre of the picture to width:height and scales it to exactly
// width x height pixels, as a PNG. A video, a value out of range and a missing field keep the first
// aspect ratio of the model. When the crop fails, the step keeps the picture that the model made. The
// step output stays as `workflows-media-v1` sets it.
//
// The host also reads the aspect ratios "4:5" and "5:4" for an image: it asks the model for that ratio.
// A video model without its own list of aspect ratios does not make them, so a video step reads them
// as its first one.
//
// It adds no route. A client lets a person choose a custom size, 4:5 or 5:4 only on a host that
// advertises it, because an older host reads "custom", "4:5" and "5:4" as the first aspect ratio of the
// model. Widening any of it needs a second capability string.

export const WORKFLOWS_MEDIA_SIZE_CAPABILITY = "workflows-media-size-v1";
