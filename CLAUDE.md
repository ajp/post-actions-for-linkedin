# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome/Chromium extension that injects a **quick-action toolbar**
(Save, Copy link, Open in a new tab) next to the `…` (overflow) menu on every
LinkedIn feed post. Zero host permissions, one `storage` permission, no direct
network calls, no build step. Save and Copy work by driving LinkedIn's own `…`
menu items (kept hidden); Open opens the post in a new tab.

## Commands

There is no build system, package manager, linter, or test suite — it's plain MV3
files loaded directly.

- **Run/reload during development:** `chrome://extensions` → Developer mode →
  **Load unpacked** → select this folder. After editing, click the reload icon on
  the extension card, then hard-reload a `linkedin.com/feed` tab.
- **Debug a post that gets no button:** set `DEBUG = true` at the top of
  `content.js` for per-post console diagnostics of why detection failed.
- **Package a release zip** (only the runtime files ship; `git ls-files` shows
  the rest are docs/store assets):
  ```sh
  zip -r linkedin-open-post-in-new-tab.zip \
    manifest.json content.js background.js options.html options.js styles.css \
    README.md icons/icon16.png icons/icon48.png icons/icon128.png \
    _locales/en/messages.json
  ```
  The zip is gitignored and published as a GitHub Release asset.

## Architecture

Three cooperating pieces, message-passing between them:

- **`content.js`** (injected on `https://www.linkedin.com/*`) — finds each post's
  `…` button, builds the cloned toolbar, and wires each action. All the hard logic
  lives here.
- **`background.js`** (service worker) — receives a `{type:"lnt-open", url, toggle}`
  message on Open click and calls `chrome.tabs.create`. This exists *only* because a
  content script's `window.open` cannot place a tab in the background or right
  after the current tab; `chrome.tabs.create` can, and needs no permission. It
  hard-validates the URL against LinkedIn hosts (`…/feed/update/`, `…/posts/`,
  `lnkd.in/`).
- **`options.html` / `options.js`** — settings page *and* toolbar popup (same file
  for both). Persists one preference, `openMode` (`background`|`foreground`), to
  `chrome.storage.sync`; `background.js` reads it per Open. `⌘/Ctrl`-click on Open
  inverts the default for that one click (the `toggle` flag).

### The core problem content.js solves

LinkedIn's post header uses **randomized, per-build CSS class names** and several
different layouts, and the feed is **virtualized** (headers can render before the
post's permalink streams in). The whole design works around this:

- **Finding the `…` button** (`OVERFLOW_SELECTOR`): matched by localized
  `aria-label` **and** by the stable `svg#overflow-web-ios-small` icon id (so
  non-English locales work). Comment menus reuse that icon, so `isCommentContext()`
  filters them out by walking up to the `role="listitem"` post boundary.
- **Finding the permalink** (`findPostUrl` → `extractPostUrl`): the URN appears in
  different link shapes per surface — a plain anchor on profile/activity pages,
  but **URL-encoded in a query param** (`highlightedUpdateUrn=urn%3Ali%3A…`) on
  the main feed, so hrefs are `decodeURIComponent`'d before regex-matching. The
  ancestor walk is **bounded to the post's own card** so a card with no permalink
  never grabs a neighbor's URL.
- **"Most Recommended" fallback** (`activityUrlFromToken`): those cards expose no
  permalink anchor at all. The activity id is reverse-engineered from a base64
  protobuf token prefixing the card's `-replaceableCommentTools` element id (the
  varint is `activityId << 1`; uses BigInt; sanity-gated to 19 digits so an
  encoding change fails closed with no button rather than a wrong one). This is the
  most fragile part — used only as a fallback when no anchor exists.
- **Building the buttons** (`makeIconButton`, driven by an `actions[]` list): each
  toolbar button **clones the post's own `…` button** (`cloneNode(true)`) and swaps
  in a fresh namespaced `<svg>` (`setGlyph`), rather than styling a custom button.
  Cloning inherits the live sibling's exact size, alignment, spacing, and native
  hover circle for whatever build/layout is current. Color/size are set **inline
  with `!important`** to beat each route's `svg path { fill: … } !important` rule;
  fill is `currentColor` so it follows LinkedIn's in-app (not OS) dark/light toggle
  live. See the `clone-overflow-button-approach` memory for the full rationale.
- **Actions**: Open uses the derived permalink (and reads LinkedIn's clipboard link
  to match Copy's exact link, falling back to the permalink / the menu's Embed share
  URN). **Save (`saveViaMenu`) and Copy (`copyViaMenu`)** drive LinkedIn's own `…`
  menu: open it, click the item matched by its stable icon (`bookmark-*` for
  Save/Unsave, `link-*` for Copy link), dismiss. `primeSavedState` reads the saved
  state on a post's own page. The live `…` is re-resolved at click time (React can
  swap the node).
- **Hidden menu** (`suppressMenus` + `styles.css`): menus we drive must never flash.
  A root class hides `[role="menu"]`, and — because LinkedIn paints a spinner
  container *before* `role="menu"` exists — a `MutationObserver` hides the dropdown's
  positioned ancestor from its first frame. `endMenuInteraction` reveals only once no
  `[role="menu"]` remains in the DOM. `element.click()` works on hidden nodes, so the
  actions still fire.
- **Placement**: buttons inserted before `…` for order `[save][copy][open][…][X]`
  (Open dropped on the post's own page). The leftmost is the single
  `margin-inline-start:auto` push point; siblings to its right are zeroed, so the row
  stays flush-right (RTL-correct via logical margins). `layoutToolbar` measures the
  native `…↔X` gap live and matches every inter-icon gap.
- **Virtualization handling**: a `MutationObserver` scoped to added overflow
  buttons/post links (coalesced into one `requestAnimationFrame` scan) plus a retry
  ladder. The `…` is marked `data-lnt-processed` **only after a successful insert**;
  when the URL isn't ready yet it's left for a later scan, giving up after ~4s so
  ad/system cards aren't re-walked forever.

### Gotcha when editing content.js

Anything touching selectors, the URN shapes, the protobuf decode, the menu-item
icons (`bookmark-*` / `link-*`), or button placement rides LinkedIn's private DOM
and has historically taken several rounds to get right across all surfaces (main
feed, profile, activity pages, social-proof cards, Most Recommended). Test on
multiple surfaces, not just one. `content.js` prints a one-time console warning if
it finds overflow menus on a feed page but injects nothing — a signal a selector
went stale.
