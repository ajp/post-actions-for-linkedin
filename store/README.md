# Chrome Web Store assets

Promotional images and listing copy for submitting this extension to the
[Chrome Web Store](https://chrome.google.com/webstore/devconsole).

## Images

| File | Size | Store field |
| --- | --- | --- |
| `promo-small-440x280.png` | 440×280 | **Small promo tile** (required) |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee promo tile (optional, for featuring) |
| `promo-screenshot-1-1280x800.png` | 1280×800 | Screenshot 1 — the feature |
| `promo-screenshot-2-1280x800.png` | 1280×800 | Screenshot 2 — light & dark |
| `promo-screenshot-3-1280x800.png` | 1280×800 | Screenshot 3 — settings |
| `promo-screenshot-4-1280x800.png` | 1280×800 | Screenshot 4 — privacy |

At least one 1280×800 (or 640×400) screenshot is required; up to 5 are allowed.

## Listing copy

**Name:** LinkedIn Open Post in New Tab

**Summary** (≤132 chars):
> Adds an open-in-new-tab button to every LinkedIn feed post — one click opens the post's permalink in a new tab. No tracking.

**Category:** Productivity

**Description:**
> Tired of LinkedIn opening posts in a modal, or digging into the “…” menu just
> to copy a link? This extension adds a small open-in-new-tab icon right next to
> the “…” menu on every feed post. One click opens that post on its own page.
>
> • One click — no menu, no “Copy link”.
> • Opens in a background tab by default so you keep scrolling (configurable;
>   hold ⌘/Ctrl to flip it for one click).
> • Looks native — the button is cloned from LinkedIn’s own controls and matches
>   light/dark themes.
> • Works across the feed (Top and Recent sorts), profiles, activity pages,
>   reposts, and “Suggested” posts.
>
> Private by design: no tracking, no data collection, no network calls. Site
> access is limited to linkedin.com, and the only permission is “storage”, used
> solely to remember your background/foreground preference.

## Privacy / review form answers

- **Single purpose:** Adds a button to LinkedIn feed posts that opens the post in a new tab.
- **`storage` permission:** Stores the user's preference for opening posts in a background vs. foreground tab.
- **Host access (`https://www.linkedin.com/*`):** The content script runs only on LinkedIn to read the post's URL already present in the page and inject the button. No other sites.
- **Remote code:** No.
- **Data collection:** None. The extension does not collect or transmit any user data.

## Regenerating

These are built from the screenshots in [`../docs/`](../docs) via headless Chrome
(HTML/CSS rendered at 2× and downscaled). No build step is committed; recreate as
needed if the UI changes.
