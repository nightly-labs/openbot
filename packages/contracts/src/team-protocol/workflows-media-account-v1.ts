// Frozen optional workflows-media-account-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: the `image` node of
// `workflows-media-v1` reads one more field, `account`. It is the id of one account of the provider
// of the node's model, as `provider-accounts-v1` lists the accounts of that provider. A missing or
// empty field, and "default", is the provider's own sign-in. The host makes the file on that account,
// so that account's subscription pays for it. When the host does not have that account for that
// provider, the step fails with the "account not found" error: the host never makes the file on
// another account. A Sunra model ignores the field. The step output stays as `workflows-media-v1`
// sets it.
//
// It adds no route. A client lets a person choose the account of a step only on a host that
// advertises it, because an older host ignores the field and makes the file on the provider's own
// sign-in. Widening any of it needs a second capability string.

export const WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY = "workflows-media-account-v1";
