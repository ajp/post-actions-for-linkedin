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
| `promo-screenshot-5-1280x800.png` | 1280×800 | Screenshot 5 — works on every kind of post |

At least one 1280×800 (or 640×400) screenshot is required; up to 5 are allowed.

> **Note:** the committed promo images still show the single open-in-new-tab
> button from 1.1.x. Regenerate them to show the Save / Copy / Open toolbar
> before submitting 1.2.

## Listing copy

**Name:** Open Post in New Tab for LinkedIn

> Consider renaming to reflect the toolbar (e.g. "Post Quick Actions for
> LinkedIn") — the current name now undersells Save and Copy.

**Summary** (≤132 chars):
> A quick-action toolbar on every LinkedIn post: Save, Copy link, and Open in a new tab — one click each. No tracking.

**Category:** Productivity

**Description:**
> LinkedIn tucks a post's most useful actions inside the “…” menu. This extension
> surfaces them as one-click icons right in the post header, so you can act
> without opening the menu.
>
> • Save — saves the post to your real LinkedIn Saved items (the bookmark fills;
>   click again to unsave).
> • Copy link — copies the post's canonical LinkedIn link.
> • Open in a new tab — opens the post on its own page; background tab by default
>   (hold ⌘/Ctrl to flip it for one click).
> • Looks native — each icon is cloned from LinkedIn’s own controls and matches
>   light/dark themes; no menu ever visibly pops up.
> • Works across the feed (both sorts), profiles, activity pages, reposts, and
>   “Suggested” posts, in any UI language.
>
> Private by design: no tracking, no data collection, and the extension makes no
> network requests of its own. Site access is limited to linkedin.com, and the
> only permission is “storage”, used solely to remember your Open tab preference.
> Save and Copy work by activating LinkedIn’s own menu items on your click.
>
> Not affiliated with, endorsed by, or sponsored by LinkedIn Corporation.

## Privacy / review form answers

- **Single purpose:** Adds a quick-action toolbar to LinkedIn feed posts that surfaces the post's own Save, Copy link, and Open-in-a-new-tab actions as one-click icons.
- **`storage` permission:** Stores the user's preference for opening posts in a background vs. foreground tab.
- **Host access (`https://www.linkedin.com/*`):** The content script runs only on LinkedIn to add the toolbar, read the post's link from the page, and — on the user's click — activate LinkedIn's own Save/Copy menu items or open the post in a new tab. No other sites.
- **Remote code:** No.
- **Data collection:** None. The extension does not collect or transmit any user data. (Save/Copy invoke LinkedIn's own controls; the clipboard is written locally only — no clipboard read.)

## Regenerating

These are built from the screenshots in [`../docs/`](../docs) via headless Chrome
(HTML/CSS rendered at 2× and downscaled). No build step is committed; recreate as
needed if the UI changes.
