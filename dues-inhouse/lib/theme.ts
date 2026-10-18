/** Where the visitor's light or dark choice is kept in their browser. */
export const THEME_KEY = "dues-theme";

/**
 * Runs in <head> before the page paints, so a dark-mode visitor never sees a
 * white flash. A saved choice wins; otherwise the device's setting decides.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;
