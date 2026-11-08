/** Options page / popup: persist the default open mode (background/foreground). */
const DEFAULTS = { openMode: "background" };
const OPEN_MODES = ["background", "foreground"];
// chrome.storage is present only with the "storage" permission active. Guard so
// a stale load (permission not yet registered) degrades instead of throwing.
const store =
  (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) || null;

function setStatus(text) {
  const s = document.getElementById("status");
  if (s) s.textContent = text;
}

function showSaved() {
  setStatus("Saved");
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => setStatus(""), 1200);
}

function restore() {
  if (!store) {
    setStatus("Settings unavailable — reload the extension.");
    return;
  }
  store.get(DEFAULTS, (items) => {
    const mode = OPEN_MODES.includes(items.openMode) ? items.openMode : DEFAULTS.openMode;
    const el = document.querySelector('input[name="openMode"][value="' + mode + '"]');
    if (el) el.checked = true;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  restore();
  document.querySelectorAll('input[name="openMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (store) store.set({ openMode: e.target.value }, showSaved);
    });
  });
});
