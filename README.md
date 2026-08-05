# LinkedIn — Open Post in New Tab

A tiny, zero-permission Chrome/Chromium extension that adds an **open-in-new-tab**
icon next to the `…` menu on every LinkedIn feed post. Click it to open that post
on its own page in a new tab — no more digging into **… → Copy link to this post**.

<p>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-blue">
  <img alt="Permissions: none" src="https://img.shields.io/badge/permissions-none-brightgreen">
  <img alt="No tracking" src="https://img.shields.io/badge/tracking-none-brightgreen">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-informational">
</p>

## Screenshots

> _Placeholders — drop the images below into `docs/` with these exact names and
> they'll render here._

| Feed post with the button | Hover state |
| --- | --- |
| ![The open-in-new-tab icon sits left of the … menu on a feed post](docs/screenshot-feed.png) | ![Hover state of the injected button](docs/screenshot-hover.png) |

## Why

LinkedIn opens posts in an overlay/modal, and getting a real permalink means
opening the `…` menu and choosing *Copy link to this post*. This extension puts a
one-click **open in a new tab** control right in the post header, so you can fan
out interesting posts into tabs and keep scrolling.

## Features

- **One click, new tab** — opens the post's canonical permalink.
- **Native look** — the button is cloned from the post's own `…` button, so it
  matches LinkedIn's size, spacing, hover circle, and **theme color** (follows the
  in-app dark/light toggle live, no reload).
- **Works across feed layouts** — home feed, profile posts, activity pages, and
  social-proof cards ("X commented / likes this"), including the main feed's
  URL-encoded permalinks.
- **Locale-friendly** — detects the `…` button by its stable icon, not only the
  English label, so non-English UIs work too. Comment menus are ignored.
- **Private & light** — **no permissions**, **no network calls**, **no storage**,
  **no data collection**. Just a content script.

## Install

### From source (unpacked)

1. Download this repo (**Code → Download ZIP**, or the latest
   [Release](../../releases)) and unzip it.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the extension folder.
5. Open [linkedin.com/feed](https://www.linkedin.com/feed/) — each post now has an
   open-in-new-tab icon next to its `…` menu.

Works in any Chromium browser (Chrome, Edge, Brave, Arc) that supports Manifest V3.

## How it works

Each post card already carries its own permalink. On profile/activity pages it's a
plain anchor:

```html
<a href="https://www.linkedin.com/feed/update/urn:li:activity:1234567890/">
```

On the main `/feed` the URN is **URL-encoded in a query param**:

```
.../feed/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A1234567890&...
```

The content script decodes whichever form it finds and reconstructs the canonical
`/feed/update/urn:li:<type>:<id>/` URL — no menu interaction, no scraping of
LinkedIn's randomized, per-build class names.

For each post it:

1. Finds the `…` (overflow) button — by `aria-label` **and** by the overflow
   icon's stable `svg#overflow-web-ios-small` (so translated UIs work); comment
   menus share that icon and are filtered out.
2. Reads the post's permalink/URN off the card and normalizes it.
3. Injects an inline-SVG icon button just before `…`, cloned from it for a native
   match, colored with `currentColor` so it tracks the active theme.
4. Watches the feed with a `MutationObserver` (scoped + coalesced) so posts loaded
   while scrolling get the button too.

## Privacy

This extension collects nothing and talks to nothing. It runs only on
`https://www.linkedin.com/*`, requests **no** permissions and **no** host
permissions beyond that content-script match, makes **no** network requests, and
uses **no** storage. All it does is read a URL already present in the page and add
a button that calls `window.open`.

## Project layout

| File            | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `manifest.json` | MV3 manifest; injects the content script on LinkedIn.      |
| `content.js`    | Finds permalinks and injects the icon button.              |
| `styles.css`    | Minimal button styling.                                    |
| `icons/`        | Toolbar / store icons (16, 48, 128).                       |
| `docs/`         | Screenshots for this README.                               |

## Development & limitations

- This rides LinkedIn's **private, unstable DOM**. If LinkedIn reworks the post
  header, detection may need a tweak — see `OVERFLOW_SELECTOR` and `findPostUrl`
  in `content.js`. The console prints a **one-time warning** if it finds overflow
  menus but injects nothing (a signal the selector went stale).
- Set `DEBUG = true` at the top of `content.js` for per-post console diagnostics.
- No build step — plain MV3, edit and reload.

## License

[MIT](LICENSE) © AJ Penninga
