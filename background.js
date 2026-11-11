/**
 * Service worker for "LinkedIn Open Post in New Tab".
 *
 * Opens a post's permalink in a new tab on behalf of the content script. We use
 * chrome.tabs.create (which requires NO permissions) because it can place the
 * tab in the background (active:false) and right after the current tab — things
 * window.open from a content script cannot do.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "lnt-open" || typeof msg.url !== "string") return;
  // Only ever open a canonical LinkedIn post permalink — exactly
  // /feed/update/urn:li:<type>:<id>/, the only shape content.js builds — so a
  // page-supplied URL can't point the new tab anywhere else. Check the PARSED
  // URL: Chrome normalizes dot-segments before navigating, so a raw-string match
  // would pass e.g. /feed/update/../../redir/redirect?url=… , and the exact
  // shape also rules out encoded tricks like ..%2F.
  let u;
  try {
    u = new URL(msg.url);
  } catch (e) {
    return;
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "www.linkedin.com" ||
    u.port ||
    u.username ||
    u.password ||
    !/^\/feed\/update\/urn:li:(activity|share|ugcPost):\d+\/$/.test(u.pathname)
  ) {
    return;
  }
  const tab = sender.tab;
  const open = (openMode) => {
    let active = openMode === "foreground";
    if (msg.toggle) active = !active; // ⌘/Ctrl-click inverts for one click
    chrome.tabs.create({
      url: u.href,
      active,
      openerTabId: tab ? tab.id : undefined,
      index: tab ? tab.index + 1 : undefined, // place just after the current tab
    });
  };
  // Default open mode comes from the options page; degrade to background if
  // storage isn't available for any reason.
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ openMode: "background" }, (cfg) => open(cfg.openMode));
  } else {
    open("background");
  }
});
