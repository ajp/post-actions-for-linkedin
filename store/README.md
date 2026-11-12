# Chrome Web Store assets

Images and listing copy for the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Images

| File | Size | Store field |
| --- | --- | --- |
| `promo-screenshot-1-1280x800.png` | 1280×800 | Screenshot 1: the toolbar |
| `promo-screenshot-2-1280x800.png` | 1280×800 | Screenshot 2: real Saved items and LinkedIn's own toasts |
| `promo-screenshot-3-1280x800.png` | 1280×800 | Screenshot 3: settings (background vs foreground tab) |
| `promo-screenshot-4-1280x800.png` | 1280×800 | Screenshot 4: supported pages |
| `promo-screenshot-5-1280x800.png` | 1280×800 | Screenshot 5: privacy |
| `promo-small-440x280.png` | 440×280 | **Small promo tile** (required) |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee promo tile (optional, used for featuring) |

The **store icon** is `icons/icon128.png`, taken from the zip.

The images are rendered from HTML templates using the dark-mode captures in
[`../docs/`](../docs). The build script lives in the local, gitignored test
harness (`.harness/store/build.mjs`), so recreate the images whenever the UI changes.

## Listing copy

**Name:** Post Actions for LinkedIn  _(comes from the manifest)_

**Summary** (≤132 chars; comes from the manifest `description`):
> Adds a quick-action toolbar to every LinkedIn feed post: Save, Copy link, and Open in a new tab.

**Category:** Productivity  **Language:** English

**Description:**
> LinkedIn tucks a post's most useful actions inside the “…” menu. This extension
> puts them in the post header as one-click icons, so you don't have to open
> the menu.
>
> • Save: saves the post to your real LinkedIn Saved items. The bookmark fills;
>   click again to unsave.
> • Copy link: copies the post's link, the same one LinkedIn's “Copy link to
>   post” gives you.
> • Open in a new tab: opens the post on its own page. It opens in a background
>   tab by default; hold ⌘/Ctrl to flip that for one click, or change the
>   default in settings.
> • Looks native: each icon is cloned from LinkedIn's own controls, so it
>   matches LinkedIn's light and dark themes, and no menu ever visibly pops up.
>
> Works on the home feed, profiles, activity (posts, comments, reactions),
> search results and hashtags, groups, company pages, Saved posts, and a post's
> own page, including reposts and “X likes this” cards. Works in any UI language.
>
> Private by design: no tracking, no data collection, and no network requests of
> its own. It runs only on linkedin.com, and its one permission, “storage”, only
> remembers your Open-tab preference. Save and Copy work by triggering LinkedIn's
> own menu actions when you click.
>
> Open source: https://github.com/ajp/post-actions-for-linkedin
>
> Not affiliated with, endorsed by, or sponsored by LinkedIn Corporation.

**Homepage URL:** https://github.com/ajp/post-actions-for-linkedin
**Support URL:** https://github.com/ajp/post-actions-for-linkedin/issues
**Privacy policy URL:** https://github.com/ajp/post-actions-for-linkedin/blob/main/PRIVACY.md

## Privacy practices tab

- **Single purpose:** Adds a quick-action toolbar to LinkedIn posts that puts the post's own Save, Copy link, and Open-in-a-new-tab actions one click away.
- **`storage` justification:** Stores one user preference: whether Open uses a background or a foreground tab.
- **Host permission justification** (the content script on `https://www.linkedin.com/*`): The content script runs only on LinkedIn. It adds the toolbar, reads the post's link from the page, and, when the user clicks, triggers LinkedIn's own Save or Copy link menu item or opens the post in a new tab. No other sites.
- **Remote code:** No, I am not using remote code.
- **Data usage:** tick **none** of the data types. The extension collects and transmits no user data.
- **Certifications:** tick all three (no selling or transferring data, no unrelated use, no creditworthiness use).

## Submission checklist

1. **Developer account:** register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 fee) and verify your contact email.
2. **New item → upload** `post-actions-for-linkedin.zip` (built with the `zip` command in `CLAUDE.md`).
3. **Store listing tab:** paste the description, set category and language, upload the 5 screenshots plus the small and marquee tiles, and add the homepage and support URLs.
4. **Privacy practices tab:** fill it in from the section above, then add the privacy policy URL.
5. **Distribution:** Public, all regions (or limit as you prefer).
6. **Submit for review.** Review usually takes from a few days to a couple of weeks, sometimes longer for a first submission.
