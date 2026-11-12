# Privacy Policy — Post Actions for LinkedIn

_Last updated: November 12, 2026_

Post Actions for LinkedIn does not collect, store, transmit, sell, or share
any personal data.

- **No data collection.** The extension has no analytics, telemetry, tracking,
  or advertising code, and makes no network requests of its own.
- **What runs, and where.** A content script runs only on
  `https://www.linkedin.com/*`. It reads the post links already on the page to
  build its toolbar. When you click **Save** or **Copy link**, it activates
  LinkedIn's own menu items for that post. When you click **Open**, it opens
  the post in a new tab. Nothing is read from or sent to any other site.
- **Storage.** The `storage` permission holds one setting, whether posts open
  in a background or foreground tab. It's kept in Chrome's extension storage
  (`chrome.storage.sync`), which Chrome may sync across your signed-in
  browsers. The developer never receives it.
- **Clipboard.** **Copy link** writes the post's link to your clipboard (through
  LinkedIn's own Copy action). The extension never reads your clipboard.
- **LinkedIn.** Saving a post or copying its link happens through LinkedIn
  itself, under LinkedIn's own [privacy policy](https://www.linkedin.com/legal/privacy-policy).

Questions or concerns: open an issue at
<https://github.com/ajp/post-actions-for-linkedin/issues>.

Not affiliated with, endorsed by, or sponsored by LinkedIn Corporation.
