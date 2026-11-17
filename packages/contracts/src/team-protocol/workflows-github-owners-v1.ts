// Frozen optional workflows-github-owners-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: the GitHub trigger of
// `workflows-github-v1` reads two more fields. `owners` holds user or organization logins, one a line.
// The trigger then starts on the events of each repository of such an owner that the host's GitHub
// connection reaches, also of a repository that the owner makes later. `excluded` holds `owner/name`
// repositories, one a line, that an owner of the trigger watches but that the trigger leaves out. A
// value of the wrong form is ignored. `repository` and `repositories` keep their meaning, and a trigger
// can have both single repositories and owners.
//
// It adds no route. A client lets a person choose all repositories of an owner only on a host that
// advertises it, because an older host ignores `owners` and an owner-only trigger never starts there.
// Widening any of it needs a second capability string.

export const WORKFLOWS_GITHUB_OWNERS_CAPABILITY = "workflows-github-owners-v1";
