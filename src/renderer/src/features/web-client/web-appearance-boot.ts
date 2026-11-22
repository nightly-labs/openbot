export const WEB_APPEARANCE_STORAGE_KEY = "openbot.web.appearance";

export const WEB_APPEARANCE_BOOT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(WEB_APPEARANCE_STORAGE_KEY)});if(a==="system")a=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(a==="light"||a==="dark")document.documentElement.dataset.openbotColorScheme=a}catch(e){}`;
