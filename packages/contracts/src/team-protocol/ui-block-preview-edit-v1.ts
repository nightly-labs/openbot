// Frozen optional ui-block-preview-edit-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new in the stored
// block. A host with it reads `UI_CONFIRM_PREVIEW_ANSWER_ID` beside the fallback answers of a confirm
// with a preview, gives the edited text to the agent, and stores it as the block's preview. A client
// then opens the preview for editing when the person presses the `UI_CONFIRM_EDIT_ACTION_ID` button.
// A host without it refuses that answer key, so its clients keep the button as a plain answer.
export const UI_BLOCK_PREVIEW_EDIT_CAPABILITY = "ui-block-preview-edit-v1";
