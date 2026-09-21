// window.openbot belongs in the application adapter.
export const documentation = "window.openbot";
export const viewport = () => window.innerWidth;
export const platformAction = (props: { openbot: () => void }) => props.openbot();
