// Frozen optional mistral-code-sign-in-v1 marker.
//
// What it grants, recorded here because freezing it makes it permanent: nothing new on the wire. It
// tells a client that the released `codeLoginStart` route of providers-v8 signs Mistral in, and
// answers with its `link` shape: a Mistral page that the user opens on any device, which signs the
// host in by itself. Cancel is the released `codeLoginCancel`. An older host refuses Mistral on that
// route, so a client offers it only when the host advertises this. The routes, their admin gate and
// their bounds stay as providers-v8 defines them. Widening any of it needs a second capability string.
export const MISTRAL_CODE_SIGN_IN_CAPABILITY = "mistral-code-sign-in-v1";
