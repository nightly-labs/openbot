### Fixed

- After an agent continues a request by itself, the next completion check now reads the agent's earlier answers to the request and what the earlier check found. It no longer opens a finished request again only because the agent's last reply was short.
- An agent that checks its work again after an automatic continuation no longer writes in the chat that "the check" or "the verification" is right or wrong. It says that it checked again and that its last answer stays correct.
