/**
 * LinkedIn "Open Post in New Tab"
 *
 * For every post card in the LinkedIn feed, injects a small open-in-new-tab
 * icon button next to the post's overflow (…) menu. Clicking it opens that
 * post's permalink in a new browser tab.
 *
 * Why we don't scrape the "Copy link to this post" item inside the … menu:
 * that menu is rendered lazily (only after a click) and its markup uses
 * randomized, per-build class names. But the card ALREADY contains the post's
 * canonical permalink as a plain anchor:
 *
 *     <a href="https://www.linkedin.com/feed/update/urn:li:activity:12345.../">
 *
 * That permalink is the exact destination the lnkd.in/p/... short link resolves
 * to, so we read it directly. Robust and instant — no menu interaction needed.
 */

(() => {
  "use strict";

  const DEBUG = false; // set true to log, in console, why a post gets no button
  const PROCESSED_ATTR = "data-lnt-processed"; // marks an overflow button we've handled
  // Identify a post's … (overflow) button. Primary signal is the localized
  // aria-label; we ALSO match the overflow icon's stable svg id so non-English
  // locales (where the label is translated) still work. Comment overflow buttons
  // share that icon, so isCommentContext() filters them out below.
  const OVERFLOW_SELECTOR =
    'button[aria-label^="Open control menu for post"], button:has(svg#overflow-web-ios-small)';

  // A post's URL can appear in several link shapes across LinkedIn's layouts:
  //   /feed/update/urn:li:activity:123/          (profile posts)
  //   /feed/update/urn:li:share:123/             (main feed shares)
  //   /feed/update/urn:li:ugcPost:123/           (some posts)
  //   /posts/<name>_<slug>-activity-123-ab       (posts-style permalinks)
  //   /feed/?highlightedUpdateUrn=urn%3Ali%3A... (main feed — URL-ENCODED urn!)
  // Gather anchors matching any of these; extractPostUrl decodes + parses below.
  const POST_HREF =
    'a[href*="urn:li:activity:"], a[href*="urn:li:share:"], ' +
    'a[href*="urn:li:ugcPost:"], a[href*="-activity-"], ' +
    'a[href*="highlightedUpdateUrn"], a[href*="urn%3Ali%3A"]';

  /** Turn any post-ish href into a clean canonical permalink, or null. */
  function extractPostUrl(href) {
    if (!href) return null;
    // Main-feed links carry the urn percent-encoded in a query param
    // (urn%3Ali%3Aactivity%3A123). Decode first so one set of patterns works.
    let s = href;
    try {
      s = decodeURIComponent(href);
    } catch (e) {
      /* keep raw */
    }
    // A urn anywhere in the (decoded) URL — path or query param. Keep its type.
    let m = s.match(/urn:li:(activity|share|ugcPost):(\d+)/);
    if (m) return location.origin + "/feed/update/urn:li:" + m[1] + ":" + m[2] + "/";
    // /posts/<slug>-activity-<id>-<code> style permalinks.
    m = s.match(/-activity-(\d+)/);
    if (m) return location.origin + "/feed/update/urn:li:activity:" + m[1] + "/";
    return null;
  }

  /**
   * True if this overflow button belongs to a COMMENT, not the post itself.
   * Comment menus use the same overflow icon, so we exclude them: walking up,
   * a comment button hits a comment container (componentkey/testid/id contains
   * "comment") before reaching the post card boundary (role="listitem").
   */
  function isCommentContext(btn) {
    for (let n = btn.parentElement; n && n !== document.body; n = n.parentElement) {
      const tag =
        (n.getAttribute("componentkey") || "") +
        (n.getAttribute("data-testid") || "") +
        (n.id || "");
      if (/comment/i.test(tag)) return true;
      if (n.getAttribute("role") === "listitem") return false; // post boundary
    }
    return false;
  }

  /**
   * Fallback URL source for feeds that expose NO permalink anchor — notably the
   * "Most Recommended" sort, where the social-bar/image links are placeholder
   * `/feed/` hrefs. LinkedIn still embeds the post's activity id in a base64
   * protobuf that prefixes the card's comment-tools element id, e.g.
   *   id="CgsIg…-replaceableCommentTools<cardToken>FeedType_MAIN_FEED_RELEVANCE"
   * The protobuf is `0a <len> 08 <varint>`, and the varint is (activityId << 1).
   * Verified against a known post (activity URN opened the correct article) and
   * cross-checked on a Most Recent card. Used only as a fallback so real anchors
   * (which we trust more) always win. BigInt throughout — ids exceed 2^53.
   */
  function activityUrlFromToken(card) {
    const el = card.querySelector(
      '[id*="-replaceableCommentTools"], [componentkey*="-replaceableCommentTools"]'
    );
    if (!el) return null;
    const raw = el.getAttribute("id") || el.getAttribute("componentkey") || "";
    const m = raw.match(/^([A-Za-z0-9+/]+)-replaceableCommentTools/); // base64 prefix
    if (!m) return null;
    let bytes;
    try {
      const b64 = m[1];
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch (e) {
      return null;
    }
    // protobuf: <tag> <len> 08 <varint> -> { fieldN: { field1: activityId<<1 } }
    // The outer tag is 0x0a (field 1) for normal posts but 0x12 (field 2) for
    // reposts and some others — both are wire type 2. Accept any wire-type-2 tag.
    if ((bytes[0] & 0x07) !== 2 || bytes[2] !== 0x08) return null;
    let i = 3;
    let shift = 0n;
    let val = 0n;
    while (i < bytes.length) {
      const b = bytes[i++];
      val |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
    }
    const id = val >> 1n;
    // Sanity gate: current activity ids are 19-digit (~7e18). Reject garbage so
    // an encoding change fails closed (no button) rather than opening junk.
    if (id < 1000000000000000000n || id >= 10000000000000000000n) return null;
    return location.origin + "/feed/update/urn:li:activity:" + id.toString() + "/";
  }

  /**
   * Find the permalink for the post that owns the given overflow button by
   * walking ancestors until one contains a post link — always the *closest*
   * ancestor, so we never grab a neighbouring post's URL.
   *
   * The walk is BOUNDED to the post's own card (role="listitem"), with a depth
   * cap as a fallback. Without this, a card that has no permalink of its own
   * (e.g. the "Most Recommended" feed sort) would make the walk climb into a
   * shared feed container and return the FIRST post link in the whole feed — so
   * every button resolved to the same wrong post. If no anchor is found in the
   * card, we fall back to decoding the activity id from the card's token.
   */
  function findPostUrl(overflowBtn) {
    const card = overflowBtn.closest('[role="listitem"]');
    let node = overflowBtn.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 12) {
      const links = node.querySelectorAll(POST_HREF);
      for (const link of links) {
        const url = extractPostUrl(link.getAttribute("href"));
        if (url) return url;
      }
      if (card && node === card) break; // reached the post card — don't go above it
      node = node.parentElement;
      depth++;
    }
    // No permalink anchor in the card — try the embedded activity-id token.
    return card ? activityUrlFromToken(card) : null;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  // "Open in new tab" glyph path (16x16 viewBox, same as LinkedIn's icons).
  const ICON_PATH_D =
    "M9 1v2h2.59L6.3 8.29l1.41 1.41L13 4.41V7h2V1zM11 13H3V5h4V3H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9h-2z";
  // Native LinkedIn icons paint with fill="currentColor", so currentColor is the
  // theme-correct color and it FOLLOWS LinkedIn's in-app dark/light toggle (which
  // doesn't reload the page). Set inline with !important so it still beats each
  // route's `svg path { fill: <token> } !important` rule. This replaces reading a
  // one-time resolved color, which froze on theme change and could fall back to
  // near-black before the native svg had painted.
  const ICON_FILL = "currentColor";

  /**
   * Build our button by cloning the post's own … (overflow) button, then
   * swapping in our glyph. Cloning means we inherit LinkedIn's exact size,
   * vertical alignment, spacing and hover treatment for whatever layout/build
   * is live — instead of chasing per-layout CSS against randomized class names.
   */
  function makeButton(overflowBtn, url) {
    const btn = overflowBtn.cloneNode(true);
    btn.classList.add("lnt-open-btn");
    btn.setAttribute("type", "button");
    btn.setAttribute("title", "Open this post in a new tab");
    btn.setAttribute("aria-label", "Open this post in a new tab");
    btn.removeAttribute("aria-haspopup");
    btn.removeAttribute("aria-expanded");
    btn.removeAttribute("componentkey");
    btn.removeAttribute(PROCESSED_ATTR);
    // The clone copies id / aria-ref attributes; strip them (on the button and
    // any descendants) so the injected node can't duplicate an id or hijack
    // LinkedIn's id-based lookups.
    ["id", "name", "aria-controls", "aria-describedby", "aria-labelledby"].forEach(
      (a) => btn.removeAttribute(a)
    );
    btn.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

    // LinkedIn lazy-loads icons: a blank <span data-dynamic-icon-loading>
    // placeholder sits beside the svg until the real icon loads, then LinkedIn's
    // JS removes it. Our clone can freeze that placeholder in place (LinkedIn no
    // longer manages it); left in, it occupies an icon-sized slot in the
    // centering flex wrapper and shoves our glyph off-center. Drop it.
    btn.querySelectorAll("[data-dynamic-icon-loading]").forEach((el) => el.remove());

    // Swap the … dots for our glyph. Build a FRESH namespaced <svg> rather than
    // reusing the cloned svg. Color/size are set INLINE with !important: the
    // cloned button keeps LinkedIn's classes, and each route's stylesheet has
    // its own `svg path { fill: <token> } !important` rule that would otherwise
    // win the cascade and leave the icon invisible. An inline !important beats
    // any stylesheet !important regardless of specificity or load order.
    const oldSvg = btn.querySelector("svg");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "16"); // intrinsic size backstop
    svg.setAttribute("height", "16");
    // Reuse the native icon's classes so ours is sized AND centered within the
    // button exactly like the … / X icons (centering lives on the svg's classes,
    // not the span). Our inline fill below still overrides their color rule.
    if (oldSvg && oldSvg.getAttribute("class")) {
      svg.setAttribute("class", oldSvg.getAttribute("class"));
    }
    svg.style.setProperty("width", "16px", "important");
    svg.style.setProperty("height", "16px", "important");
    // The svg sits inside LinkedIn's flex icon span; without these it gets
    // shrunk to width:0 (the native icon's classes prevent this via min-width).
    svg.style.setProperty("min-width", "16px", "important");
    svg.style.setProperty("min-height", "16px", "important");
    svg.style.setProperty("flex", "0 0 auto", "important");
    svg.style.setProperty("fill", ICON_FILL, "important");
    svg.style.setProperty("visibility", "visible", "important");
    svg.style.setProperty("opacity", "1", "important");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATH_D);
    path.style.setProperty("fill", ICON_FILL, "important");
    svg.appendChild(path);
    if (oldSvg) {
      oldSvg.replaceWith(svg); // keep the span wrapper (centering) intact
    } else {
      (btn.querySelector("span") || btn).appendChild(svg);
    }

    // Our button goes to the LEFT of …/X and must sit flush against them at the
    // right edge, consistently across both header layouts. Make OUR button the
    // single left push point (margin-inline-start:auto); processOverflowButton
    // then zeroes the inline-start margins on the buttons to our right so no
    // competing auto margin opens a gap between the icons.
    btn.style.setProperty("margin-inline-start", "auto", "important");
    btn.style.setProperty("margin-left", "auto", "important");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Open via the service worker, which honors the user's default (set in the
      // options page) and can place the tab in the background — window.open from
      // a content script can't. ⌘/Ctrl-click inverts the default for one click.
      const toggle = e.metaKey || e.ctrlKey;
      try {
        chrome.runtime.sendMessage({ type: "lnt-open", url, toggle }, () => {
          void chrome.runtime.lastError; // swallow "no receiver" noise
        });
      } catch (err) {
        // Extension context gone (e.g. just reloaded) — fall back to a normal tab.
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
    return btn;
  }

  function processOverflowButton(overflowBtn) {
    // Already handled — nothing to do.
    if (overflowBtn.getAttribute(PROCESSED_ATTR) === "1") return;
    // Dedupe on the presence of OUR clone, not just the flag: React can replace
    // the native … button with a fresh (unflagged) node on re-render while our
    // clone persists as a sibling. Without this, that would inject a duplicate.
    const prev = overflowBtn.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains("lnt-open-btn")) {
      overflowBtn.setAttribute(PROCESSED_ATTR, "1");
      return;
    }
    // The svg-id selector also catches comment overflow menus — skip those.
    if (isCommentContext(overflowBtn)) {
      overflowBtn.setAttribute(PROCESSED_ATTR, "1");
      return;
    }

    const url = findPostUrl(overflowBtn);
    // On the virtualized /feed the header (with the … button) can render before
    // the post's permalink anchor streams in. If we can't find the URL yet,
    // DON'T mark the button done — leave it so a later scan retries once the
    // permalink loads. But bound the retry window: cards that genuinely never
    // have a permalink (ads/system cards) would otherwise be re-walked on every
    // scan forever. After ~4s of misses, give up and mark them processed.
    if (!url) {
      const now = Date.now();
      let first = parseInt(overflowBtn.getAttribute("data-lnt-first") || "0", 10);
      if (!first) {
        first = now;
        overflowBtn.setAttribute("data-lnt-first", String(now));
      }
      if (now - first > 4000) overflowBtn.setAttribute(PROCESSED_ATTR, "1");
      if (DEBUG) {
        const found = [];
        let n = overflowBtn.parentElement;
        while (n && n !== document.body) {
          n.querySelectorAll("a[href]").forEach((a) => {
            const h = a.getAttribute("href");
            if (/urn:li:|-activity-|\/feed\/update\/|\/posts\//.test(h)) found.push(h);
          });
          if (found.length) break;
          n = n.parentElement;
        }
        console.warn("[lnt] no URL for:", overflowBtn.getAttribute("aria-label"), "| candidate links:", found.slice(0, 5));
      }
      return;
    }

    overflowBtn.setAttribute(PROCESSED_ATTR, "1");
    const btn = makeButton(overflowBtn, url);
    // Place our button just before … so the order is [ours][…][X] (our icon
    // third from the right). Zero the inline-start margins on the buttons to our
    // right so OUR auto margin is the only push point (keeps the trio flush at
    // the right edge in both header layouts).
    overflowBtn.parentElement.insertBefore(btn, overflowBtn);
    for (let sib = overflowBtn; sib; sib = sib.nextElementSibling) {
      if (sib.tagName === "BUTTON") {
        sib.style.setProperty("margin-inline-start", "0", "important");
        sib.style.setProperty("margin-left", "0", "important");
      }
    }
    // Make the ours↔… gap equal the native …↔X gap. LinkedIn's exact spacing
    // mechanism varies by layout, so measure it live and set our end margin.
    equalizeGap(btn, overflowBtn);
  }

  /** Set our button's end margin so ours↔… spacing matches the native …↔X gap. */
  function equalizeGap(iconBtn, dotsBtn) {
    const next = dotsBtn.nextElementSibling;
    if (!next || next.tagName !== "BUTTON") return; // no X to match against
    requestAnimationFrame(() => {
      try {
        const dots = dotsBtn.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const iconRect = iconBtn.getBoundingClientRect();
        // Not laid out yet (hidden tab / display:none card) → rects are zero.
        // Bail without writing; a later scan re-measures once layout exists.
        if (!dots.width || !nextRect.width || !iconRect.width) return;
        const targetGap = nextRect.left - dots.right; // …↔X
        const currentGap = dots.left - iconRect.right; // ours↔…
        const cur =
          parseFloat(getComputedStyle(iconBtn).marginInlineEnd) || 0;
        const end = Math.max(0, cur + (targetGap - currentGap));
        iconBtn.style.setProperty("margin-inline-end", end + "px", "important");
        iconBtn.style.setProperty("margin-right", end + "px", "important");
      } catch (e) {
        /* leave as-is */
      }
    });
  }

  function scan(root = document) {
    root.querySelectorAll(OVERFLOW_SELECTOR).forEach(processOverflowButton);
  }

  // Coalesce the bursts of mutations LinkedIn emits into a single scan.
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  // Initial pass, plus a short ladder of retries to catch cards whose permalink
  // streams in a beat after their header (in case mutations are sparse).
  scan();
  [400, 1200, 2500].forEach((ms) => setTimeout(scan, ms));

  // One-time breakage signal: if we're on a feed-ish page but injected nothing,
  // LinkedIn likely renamed the overflow selector — make that observable.
  setTimeout(() => {
    if (
      /\/(feed|in)\//.test(location.pathname) &&
      document.querySelector(OVERFLOW_SELECTOR) &&
      !document.querySelector(".lnt-open-btn")
    ) {
      console.warn(
        "[lnt] LinkedIn Open-in-New-Tab: found overflow menus but injected no " +
          "buttons — the post detection may be out of date."
      );
    }
  }, 5000);

  // The feed is virtualized and streams content in. Only schedule a scan when a
  // mutation actually adds an overflow button OR a post link (a late-arriving
  // permalink) — otherwise LinkedIn's constant DOM churn (and non-feed routes
  // like messaging/jobs) would trigger a full-document rescan on every frame.
  const RELEVANT = OVERFLOW_SELECTOR + ", " + POST_HREF;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(RELEVANT) || node.querySelector?.(RELEVANT)) {
          scheduleScan();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
