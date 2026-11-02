/** The key under which this browser keeps the web client's theme. */
export const WEB_APPEARANCE_STORAGE_KEY = "openbot.web.appearance";

/**
 * An inline script for the head of `/app`. It shows the saved theme before the first paint: without
 * it, the loading screen paints dark until its code runs. No saved theme leaves the dark default.
 * The loading screen's code then takes over, and removes the attribute when the user leaves `/app`.
 */
export const WEB_APPEARANCE_BOOT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(WEB_APPEARANCE_STORAGE_KEY)});if(a==="system")a=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(a==="light"||a==="dark")document.documentElement.dataset.openbotColorScheme=a}catch(e){}`;
