/**
 * A settings change that the agent's state or the listed models refuse: the agent works, or the
 * request names a model, an effort or an account that is not available. Its message is for the user.
 * The Local scripts API answers it as a conflict; another failure stays an internal error.
 */
export class AgentSettingsRefused extends Error {}
