// Frozen optional setting-link-markers-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a client that sends it can
// show the chat messages whose item type starts with `setting-link:` (`SETTING_LINK_ITEM_TYPE_PREFIX`).
// Each one is a completed system message that an agent posted with `show_setting`; the rest of the item
// type is a setting id, and the text is English status text. A host sends these messages, in pages, live
// events and read state, only to a client that sends this capability. It adds no route and no field. A
// client shows no card for an id it does not know. A protocol 9 capability only.
export const SETTING_LINK_MARKERS_CAPABILITY = "setting-link-markers-v1";
