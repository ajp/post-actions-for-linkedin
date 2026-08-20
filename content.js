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

  // Timing / limit knobs, grouped so the virtualization-retry model is visible
  // in one place. See each use site below for why the value is what it is.
  const SCAN_RETRY_MS = [400, 1200, 2500]; // ladder of rescans after the first pass
  const URL_RETRY_GIVEUP_MS = 4000; // stop re-walking a card that never gets a permalink
  const STALE_SELECTOR_WARN_MS = 5000; // delay before the one-time "selector stale" warning
  const MAX_WALK_DEPTH = 12; // ancestor-walk cap when hunting a card's permalink
  const GAP_MEASURE_RETRIES = 5; // layoutToolbar re-measures this many times if layout isn't ready
  const GAP_MEASURE_RETRY_MS = 200;
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
    // /posts/<slug>-<type>-<id>-<code> style permalinks (activity/share/ugcPost).
    m = s.match(/-(activity|share|ugcPost)-(\d+)/);
    if (m) return location.origin + "/feed/update/urn:li:" + m[1] + ":" + m[2] + "/";
    return null;
  }

  /** The numeric post id from a canonical permalink (type-agnostic), or null. */
  function postIdOf(u) {
    const m = (u || "").match(/urn:li:(?:activity|share|ugcPost):(\d+)/);
    return m ? m[1] : null;
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
    while (node && node !== document.body && depth < MAX_WALK_DEPTH) {
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
  const COPY_FEEDBACK_MS = 1200; // how long a button flashes its "done" glyph
  const SAVE_MENU_TRIES = 10; // poll attempts to find a menu item after opening …
  const SAVE_MENU_POLL_MS = 100; // delay between those attempts
  // Toolbar glyphs. Most are on a 16x16 viewBox to match LinkedIn's own icons;
  // Save reuses LinkedIn's native bookmark glyph, which is authored at 24x24
  // (setGlyph scales it to a 16px box via the per-icon viewBox).
  const ICON_PATHS = {
    open: "M9 1v2h2.59L6.3 8.29l1.41 1.41L13 4.41V7h2V1zM11 13H3V5h4V3H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9h-2z",
    copy: "M5.5 3.5A1.5 1.5 0 0 1 7 2h5a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 12h-.5v-1H12a.5.5 0 0 0 .5-.5v-7A.5.5 0 0 0 12 3H7a.5.5 0 0 0-.5.5V4h-1v-.5zM3.5 5A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5v-7A1.5 1.5 0 0 0 8.5 5h-5zM3 6.5A.5.5 0 0 1 3.5 6h5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-7z",
    check: "M13.5 4.5l-7 7L3 8l1-1 2.5 2.5L12.5 3.5z",
    // LinkedIn's own bookmark-outline glyph (matches the menu's Save item).
    save: "M19 5a3 3 0 0 0-3-3H5v20l7-6.29L19 22zm-3-1a1 1 0 0 1 1 1v12.51L12 13l-5 4.51V4z",
    // Filled bookmark, shown briefly after a successful save (24x24 like save).
    saveDone: "M19 5a3 3 0 0 0-3-3H5v20l7-6.29L19 22z",
  };
  const ICON_VIEWBOX = { save: "0 0 24 24", saveDone: "0 0 24 24" }; // default 0 0 16 16
  // Native LinkedIn icons paint with fill="currentColor", so currentColor is the
  // theme-correct color and it FOLLOWS LinkedIn's in-app dark/light toggle (which
  // doesn't reload the page). Set inline with !important so it still beats each
  // route's `svg path { fill: <token> } !important` rule. This replaces reading a
  // one-time resolved color, which froze on theme change and could fall back to
  // near-black before the native svg had painted.
  const ICON_FILL = "currentColor";

  /** True while our extension context is still valid. After the extension is
   *  reloaded/updated, content scripts already injected in open tabs are
   *  orphaned and any `chrome.*` call throws "Extension context invalidated";
   *  `chrome.runtime.id` goes undefined, so we can detect it and stop cleanly. */
  function extAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /** i18n helper: localized message when a translation exists, else the fallback. */
  function msg(key, fallback) {
    try {
      return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback;
    } catch (e) {
      return fallback; // orphaned context — degrade to English
    }
  }

  /**
   * Swap a cloned button's glyph for our own. Builds a FRESH namespaced <svg>
   * rather than reusing the cloned svg. Color/size are set INLINE with
   * !important: the cloned button keeps LinkedIn's classes, and each route's
   * stylesheet has its own `svg path { fill: <token> } !important` rule that
   * would otherwise win the cascade and leave the icon invisible. An inline
   * !important beats any stylesheet !important regardless of specificity/order.
   * Returns the <path> so callers can flip the glyph later (copy feedback).
   */
  function setGlyph(btn, d, viewBox = "0 0 16 16") {
    const oldSvg = btn.querySelector("svg");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", viewBox);
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
    path.setAttribute("d", d);
    path.style.setProperty("fill", ICON_FILL, "important");
    svg.appendChild(path);
    if (oldSvg) {
      oldSvg.replaceWith(svg); // keep the span wrapper (centering) intact
    } else {
      (btn.querySelector("span") || btn).appendChild(svg);
    }
    return path;
  }

  /**
   * Build one toolbar button by cloning the post's own … (overflow) button and
   * swapping in our glyph. Cloning inherits LinkedIn's exact size, alignment,
   * spacing and hover treatment for whatever layout/build is live — instead of
   * chasing per-layout CSS against randomized class names. Inter-button spacing
   * is set later by layoutToolbar(); this only builds the node.
   */
  function makeIconButton(overflowBtn, { className, label, iconD, iconViewBox, onClick }) {
    const btn = overflowBtn.cloneNode(true);
    btn.classList.add("lnt-action-btn", className);
    btn.setAttribute("type", "button");
    btn.setAttribute("title", label);
    btn.setAttribute("aria-label", label);
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

    setGlyph(btn, iconD, iconViewBox);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e, btn);
    });
    return btn;
  }

  /** Open a URL via the service worker (honors the user's default open mode and
   *  can background the tab; toggle inverts the default for one click). */
  function openTab(url, toggle) {
    if (!url) return;
    try {
      chrome.runtime.sendMessage({ type: "lnt-open", url, toggle }, () => {
        void chrome.runtime.lastError; // swallow "no receiver" noise
      });
    } catch (err) {
      // Extension context gone (e.g. just reloaded) — fall back to a normal tab.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  /** Canonical permalink read from the open … menu's Embed item href, which
   *  carries the post's real share URN (…targetUrn=urn:li:share:<id>). Correct
   *  even where our derived URN isn't; null if there's no Embed item. */
  function menuPostUrl() {
    const embed = document.querySelector('[role="menu"] a[href*="targetUrn="]');
    if (!embed) return null;
    let href = embed.getAttribute("href") || "";
    try {
      href = decodeURIComponent(href);
    } catch (e) {
      /* keep raw */
    }
    const m = href.match(/urn:li:(activity|share|ugcPost):(\d+)/);
    return m ? location.origin + "/feed/update/urn:li:" + m[1] + ":" + m[2] + "/" : null;
  }

  /**
   * Open the post in a new tab using a canonical link read from the … menu's
   * Embed reference (the post's real share URN) — correct even on cards where
   * our derived URN isn't (e.g. social-proof "X likes this"). Opens the (hidden)
   * menu only to read that href; no clipboard access. Falls back to the derived
   * permalink if there's no Embed item. `toggle` is captured before we go async.
   */
  function openViaMenu(btn, fallbackUrl, toggle) {
    const parent = btn.parentElement;
    const overflowBtn = parent && parent.querySelector(OVERFLOW_SELECTOR);
    if (!overflowBtn) {
      openTab(fallbackUrl, toggle);
      return;
    }
    suppressMenus(true); // hide the dropdown before it paints
    try {
      overflowBtn.click(); // open the … dropdown (mounts async, but hidden)
    } catch (e) {
      suppressMenus(false);
      openTab(fallbackUrl, toggle);
      return;
    }
    let tries = 0;
    const tick = () => {
      const url = menuPostUrl(); // canonical permalink from the Embed href
      if (url) {
        endMenuInteraction();
        openTab(url, toggle);
        return;
      }
      if (++tries < SAVE_MENU_TRIES) {
        setTimeout(tick, SAVE_MENU_POLL_MS);
      } else {
        endMenuInteraction();
        openTab(fallbackUrl, toggle); // no Embed href → derived URL
      }
    };
    setTimeout(tick, SAVE_MENU_POLL_MS);
  }

  /** Copy the permalink to the clipboard, flashing a checkmark on success. */
  function copyLink(url, btn, label) {
    const ok = () => flashCopied(btn, label);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(ok, () => fallbackCopy(url, ok));
      } else {
        fallbackCopy(url, ok);
      }
    } catch (e) {
      fallbackCopy(url, ok);
    }
  }

  /** Clipboard fallback for non-secure contexts / older engines. */
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      if (done) done();
    } catch (e) {
      /* clipboard unavailable — nothing more we can do */
    }
  }

  /** Briefly swap a button's glyph + tooltip to a "done" state, then restore it.
   *  Only the path `d` changes, so donePath/restorePath must share the button's
   *  viewBox (copy uses 16x16 glyphs, save uses LinkedIn's 24x24 bookmark). */
  function flashAction(btn, donePath, restorePath, doneTitle, restoreTitle) {
    const path = btn.querySelector("svg path");
    if (path) path.setAttribute("d", donePath);
    btn.setAttribute("title", doneTitle);
    clearTimeout(btn._lntFlash);
    btn._lntFlash = setTimeout(() => {
      if (path) path.setAttribute("d", restorePath);
      btn.setAttribute("title", restoreTitle);
    }, COPY_FEEDBACK_MS);
  }

  /** Reflect saved/unsaved on the save button: filled bookmark = saved (stays
   *  filled), outline = not saved. We track our own optimistic toggle since the
   *  post's saved state isn't readable without opening the menu. */
  function setSavedState(btn, saved, label) {
    const path = btn.querySelector("svg path");
    if (path) path.setAttribute("d", saved ? ICON_PATHS.saveDone : ICON_PATHS.save);
    btn.setAttribute("data-lnt-saved", saved ? "1" : "0");
    const t = saved ? msg("savedState", "Saved — click to remove") : label;
    btn.setAttribute("title", t);
    btn.setAttribute("aria-label", t);
  }

  /** Convenience wrapper: flash the copy button's checkmark. */
  function flashCopied(btn, label) {
    flashAction(
      btn,
      ICON_PATHS.check,
      ICON_PATHS.copy,
      msg("copiedConfirmation", "Copied ✓"),
      label
    );
  }

  /**
   * Save the post to the member's real LinkedIn "Saved" items. LinkedIn exposes
   * Save only inside the … menu (lazily rendered on click), so we drive its own
   * control rather than reverse-engineering the private save endpoint: open the
   * menu, click the item whose icon is the bookmark glyph, then dismiss. Matching
   * on the stable `bookmark-*` svg id (not the localized "Save" text) keeps it
   * locale-independent and fail-closed — if we can't find it, we do nothing but
   * close the menu.
   */
  function saveViaMenu(btn, label) {
    // Resolve the … button live from our toolbar's parent: React can replace the
    // native node on re-render, so a captured reference may be detached (its
    // .click() would then no-op). Our clones don't match OVERFLOW_SELECTOR
    // (different glyph/label), so the header's only match is the real … button.
    const parent = btn.parentElement;
    const overflowBtn = parent && parent.querySelector(OVERFLOW_SELECTOR);
    if (!overflowBtn) return;
    suppressMenus(true); // hide the dropdown before it paints
    try {
      overflowBtn.click(); // open the … dropdown (mounts async, but hidden)
    } catch (e) {
      suppressMenus(false);
      return;
    }
    let tries = 0;
    const tick = () => {
      const item = findSaveMenuItem();
      if (item) {
        item.click(); // triggers LinkedIn's own Save/Unsave; closes the menu itself
        // Optimistically toggle our own saved state: not-saved → saved (stays
        // filled), saved → not-saved (back to outline).
        const nowSaved = btn.getAttribute("data-lnt-saved") !== "1";
        setSavedState(btn, nowSaved, label);
        endMenuInteraction(); // dismiss + reveal menus again
        return;
      }
      if (++tries < SAVE_MENU_TRIES) {
        setTimeout(tick, SAVE_MENU_POLL_MS);
      } else {
        endMenuInteraction(); // gave up — don't leave the menu hanging open
      }
    };
    setTimeout(tick, SAVE_MENU_POLL_MS);
  }

  /**
   * Copy the post's link via LinkedIn's own "Copy link to post" menu item,
   * which yields the canonical lnkd.in short link. We prefer this over our
   * derived permalink because the derived URN is wrong for some cards (e.g.
   * social-proof "X likes this"), where it resolves to "Post not found". Opens
   * the (hidden) … menu, clicks the item matched by its stable link-* icon, and
   * lets LinkedIn write the clipboard. Falls back to copying the derived URL if
   * the item can't be found.
   */
  function copyViaMenu(btn, label, fallbackUrl) {
    const parent = btn.parentElement;
    const overflowBtn = parent && parent.querySelector(OVERFLOW_SELECTOR);
    if (!overflowBtn) {
      if (fallbackUrl) copyLink(fallbackUrl, btn, label);
      return;
    }
    suppressMenus(true); // hide the dropdown before it paints
    try {
      overflowBtn.click(); // open the … dropdown (mounts async, but hidden)
    } catch (e) {
      suppressMenus(false);
      if (fallbackUrl) copyLink(fallbackUrl, btn, label);
      return;
    }
    let tries = 0;
    const tick = () => {
      const icon = document.querySelector('[role="menu"] svg[id^="link-"]');
      const item = icon && icon.closest('[role="menuitem"]');
      if (item) {
        item.click(); // LinkedIn copies the canonical link to the clipboard
        flashCopied(btn, label);
        endMenuInteraction();
        return;
      }
      if (++tries < SAVE_MENU_TRIES) {
        setTimeout(tick, SAVE_MENU_POLL_MS);
      } else {
        endMenuInteraction();
        if (fallbackUrl) copyLink(fallbackUrl, btn, label); // menu missing → derived URL
      }
    };
    setTimeout(tick, SAVE_MENU_POLL_MS);
  }

  /** The open … menu's Save item, identified by its bookmark icon (covers both
   *  the "Save" (bookmark-outline) and "Unsave" (bookmark-fill) states). */
  function findSaveMenuItem() {
    const icons = document.querySelectorAll('[role="menu"] svg[id^="bookmark-"]');
    for (const icon of icons) {
      const item = icon.closest('[role="menuitem"]');
      if (item) return item;
    }
    return null;
  }

  /**
   * On a post's own permalink page, reflect its current saved state by reading
   * it once from the … menu: the Save item's icon is bookmark-OUTLINE when not
   * saved and bookmark-FILL when saved (locale-independent). Opens the menu,
   * reads the state, sets the button, and dismisses. Called only for the page's
   * main post, so the feed never opens menus on load.
   */
  function primeSavedState(btn, label) {
    if (btn.getAttribute("data-lnt-primed") === "1") return;
    btn.setAttribute("data-lnt-primed", "1");
    const parent = btn.parentElement;
    const overflowBtn = parent && parent.querySelector(OVERFLOW_SELECTOR);
    if (!overflowBtn) return;
    suppressMenus(true); // hide the dropdown before it paints
    try {
      overflowBtn.click(); // open the … dropdown (mounts async, but hidden)
    } catch (e) {
      suppressMenus(false);
      return;
    }
    let tries = 0;
    const tick = () => {
      const icon = document.querySelector('[role="menu"] svg[id^="bookmark-"]');
      if (icon) {
        const saved = /fill/i.test(icon.getAttribute("id") || "");
        setSavedState(btn, saved, label);
        endMenuInteraction();
        return;
      }
      if (++tries < SAVE_MENU_TRIES) {
        setTimeout(tick, SAVE_MENU_POLL_MS);
      } else {
        endMenuInteraction(); // menu never appeared — leave the button as outline
      }
    };
    setTimeout(tick, SAVE_MENU_POLL_MS);
  }

  // Signals that a node is (part of) the … dropdown: the menu itself, or the
  // loading spinner LinkedIn shows first while the items stream in.
  const POPOVER_HINT = '[role="menu"], [role="progressbar"], .artdeco-loader';
  let menuHideObserver = null;

  /** Hide the popover that contains `node` from its first frame: walk up to the
   *  nearest positioned ancestor (the dropdown surface) and hide that, so even
   *  the pre-menu spinner phase never paints. Marked so we can restore it. */
  function hidePopover(node) {
    let el = node;
    for (let i = 0; el && el !== document.body && i < 8; i++) {
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "absolute") break;
      el = el.parentElement;
    }
    const target = el && el !== document.body ? el : node;
    if (target.getAttribute("data-lnt-hidden") === "1") return;
    target.setAttribute("data-lnt-hidden", "1");
    target.style.setProperty("visibility", "hidden", "important");
    target.style.setProperty("opacity", "0", "important");
    target.style.setProperty("pointer-events", "none", "important");
  }

  /**
   * Hide any dropdown we drive programmatically so it never visibly flashes.
   * The class (styles.css) covers [role="menu"], but LinkedIn paints a spinner
   * container BEFORE role="menu" exists, so we also watch for the dropdown being
   * inserted and hide its container in the observer microtask (before paint).
   */
  function suppressMenus(on) {
    document.documentElement.classList.toggle("lnt-suppress-menu", !!on);
    if (on) {
      if (!menuHideObserver) {
        menuHideObserver = new MutationObserver((records) => {
          for (const r of records) {
            for (const node of r.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              const hit = node.matches?.(POPOVER_HINT)
                ? node
                : node.querySelector?.(POPOVER_HINT);
              if (hit) hidePopover(hit);
            }
          }
        });
      }
      menuHideObserver.observe(document.body, { childList: true, subtree: true });
    } else if (menuHideObserver) {
      menuHideObserver.disconnect();
      document.querySelectorAll('[data-lnt-hidden="1"]').forEach((el) => {
        el.style.removeProperty("visibility");
        el.style.removeProperty("opacity");
        el.style.removeProperty("pointer-events");
        el.removeAttribute("data-lnt-hidden");
      });
    }
  }

  /** Dismiss the menu we opened, then reveal menus again only once the one we
   *  drove has actually left the DOM — so it never flashes on its way out (after
   *  Copy, LinkedIn closes it a beat later, async). Bounded so a menu that never
   *  unmounts can't leave us stuck hidden. */
  function endMenuInteraction() {
    dismissMenu();
    let tries = 0;
    const reveal = () => {
      if (!document.querySelector('[role="menu"]') || ++tries > 40) {
        suppressMenus(false);
      } else {
        setTimeout(reveal, 30);
      }
    };
    setTimeout(reveal, 30);
  }

  /** Close any open dropdown by sending Escape (artdeco menus listen for it). */
  function dismissMenu() {
    try {
      const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
      (document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent("keydown", opts)
      );
    } catch (e) {
      /* nothing else to do */
    }
  }

  function processOverflowButton(overflowBtn) {
    // Already handled — nothing to do.
    if (overflowBtn.getAttribute(PROCESSED_ATTR) === "1") return;
    // Dedupe on the presence of OUR clone, not just the flag: React can replace
    // the native … button with a fresh (unflagged) node on re-render while our
    // toolbar persists as siblings. The button immediately before … is the last
    // of our group, so match our shared marker class. Without this, a re-render
    // would inject a duplicate toolbar.
    const prev = overflowBtn.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains("lnt-action-btn")) {
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
      if (now - first > URL_RETRY_GIVEUP_MS) overflowBtn.setAttribute(PROCESSED_ATTR, "1");
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

    // Our quick-action toolbar, listed left→right. Each is a clone of … with our
    // glyph and handler. Add more actions here (e.g. Save) and they slot in.
    const openLabel = msg("openPostInNewTab", "Open this post in a new tab");
    const copyLabel = msg("copyLinkToPost", "Copy link to this post");
    const saveLabel = msg("savePost", "Save this post");
    // On the post's own canonical page (/feed/update/… or /posts/…) we're already
    // here, so Open is redundant. Match by post id — and because a card can derive
    // a different URN *type* than the page URL (activity vs share resolve to the
    // same post), also treat it as our own page when the page's id appears in this
    // card. Other posts on a detail page (recommendations) won't contain it.
    const pageId = postIdOf(extractPostUrl(location.href));
    const ownCard = overflowBtn.closest('[role="listitem"]');
    const onOwnPage =
      pageId !== null &&
      (postIdOf(url) === pageId ||
        (ownCard && ownCard.innerHTML.indexOf(pageId) !== -1));
    const actions = [
      {
        className: "lnt-save-btn",
        label: saveLabel,
        iconD: ICON_PATHS.save,
        iconViewBox: ICON_VIEWBOX.save,
        onClick: (e, btn) => saveViaMenu(btn, saveLabel),
      },
      {
        className: "lnt-copy-btn",
        label: copyLabel,
        iconD: ICON_PATHS.copy,
        // Copy the link from LinkedIn's own "Copy link to post" menu item (its
        // canonical lnkd.in link) rather than our derived permalink, which is
        // wrong for some cards; falls back to the derived URL if unavailable.
        onClick: (e, btn) => copyViaMenu(btn, copyLabel, url),
      },
    ];
    if (!onOwnPage) {
      actions.push({
        className: "lnt-open-btn",
        label: openLabel,
        iconD: ICON_PATHS.open,
        // Open the same link Copy produces (LinkedIn's short link, read back from
        // the clipboard); falls back to a canonical permalink. toggle captured now.
        onClick: (e, btn) => openViaMenu(btn, url, e.metaKey || e.ctrlKey),
      });
    }
    const ours = actions.map((a) => makeIconButton(overflowBtn, a));
    // Insert in order just before … → [save][copy][open][…][X].
    ours.forEach((b) => overflowBtn.parentElement.insertBefore(b, overflowBtn));
    // The leftmost of our group is the single right-push point
    // (margin-inline-start:auto); zero the inline-start margins on every button
    // after it (our others, …, X) so no competing margin opens a gap. Keeps the
    // whole row flush at the inline-end edge under both header layouts and RTL.
    ours[0].style.setProperty("margin-inline-start", "auto", "important");
    for (let i = 1; i < ours.length; i++) {
      ours[i].style.setProperty("margin-inline-start", "0", "important");
    }
    for (let sib = overflowBtn; sib; sib = sib.nextElementSibling) {
      if (sib.tagName === "BUTTON") {
        sib.style.setProperty("margin-inline-start", "0", "important");
      }
    }
    // Even out the inter-icon spacing to match the native …↔X gap.
    layoutToolbar(ours, overflowBtn);

    // If this is the main post on its own permalink page, read its saved state
    // once from the … menu so an already-saved post shows a filled bookmark on
    // load. onOwnPage is false on the feed, so this never fires there — only the
    // page whose URN matches this card. ours[0] is Save.
    if (onOwnPage) {
      primeSavedState(ours[0], saveLabel);
    }
  }

  /** Positive gap between two horizontally-adjacent boxes, regardless of which
   *  is on the left (so the math holds under both LTR and RTL locales). */
  function gapBetween(a, b) {
    return Math.max(a.left, b.left) - Math.min(a.right, b.right);
  }

  /** Set each of our buttons' inline-end margin so every gap in the row —
   *  ours↔ours and (last)ours↔… — matches the native …↔X gap. Uses
   *  direction-agnostic gaps and the logical inline-end margin so it's correct
   *  in RTL too. Re-measures a bounded number of times if the card isn't laid
   *  out yet (e.g. injected while collapsed) rather than giving up. */
  function layoutToolbar(ours, dotsBtn, attempt = 0) {
    const x = dotsBtn.nextElementSibling; // the native X (hide) button
    if (!x || x.tagName !== "BUTTON") return; // nothing to match the gap against
    requestAnimationFrame(() => {
      try {
        if (!ours[0] || !ours[0].isConnected) return; // removed by a re-render
        const rects = ours.map((b) => b.getBoundingClientRect());
        const dots = dotsBtn.getBoundingClientRect();
        const xr = x.getBoundingClientRect();
        // Not laid out yet (hidden tab / display:none card) → rects are zero.
        // Retry a bounded number of times so the gaps are measured once real
        // layout exists, instead of staying unequalized for the card's life.
        if (!dots.width || !xr.width || rects.some((r) => !r.width)) {
          if (attempt < GAP_MEASURE_RETRIES) {
            setTimeout(
              () => layoutToolbar(ours, dotsBtn, attempt + 1),
              GAP_MEASURE_RETRY_MS
            );
          }
          return;
        }
        const nativeGap = gapBetween(dots, xr); // …↔X, the gap to reproduce
        // Walk each of our buttons and match its gap to the next element (our
        // next button, or … for the last one). The leftmost's auto margin keeps
        // the whole group flush-right, so these inline-end tweaks only set the
        // internal spacing.
        const seq = rects.concat([dots]);
        for (let i = 0; i < ours.length; i++) {
          const cur = parseFloat(getComputedStyle(ours[i]).marginInlineEnd) || 0;
          const gap = gapBetween(seq[i], seq[i + 1]);
          const end = Math.max(0, cur + (nativeGap - gap));
          ours[i].style.setProperty("margin-inline-end", end + "px", "important");
        }
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
  SCAN_RETRY_MS.forEach((ms) => setTimeout(scan, ms));

  // One-time breakage signal: if we're on a feed-ish page but injected nothing,
  // LinkedIn likely renamed the overflow selector — make that observable.
  setTimeout(() => {
    if (
      /\/(feed|in)\//.test(location.pathname) &&
      document.querySelector(OVERFLOW_SELECTOR) &&
      !document.querySelector(".lnt-action-btn")
    ) {
      console.warn(
        "[lnt] LinkedIn Open-in-New-Tab: found overflow menus but injected no " +
          "buttons — the post detection may be out of date."
      );
    }
  }, STALE_SELECTOR_WARN_MS);

  // The feed is virtualized and streams content in. Only schedule a scan when a
  // mutation actually adds an overflow button OR a post link (a late-arriving
  // permalink) — otherwise LinkedIn's constant DOM churn (and non-feed routes
  // like messaging/jobs) would trigger a full-document rescan on every frame.
  const RELEVANT = OVERFLOW_SELECTOR + ", " + POST_HREF;
  const observer = new MutationObserver((records) => {
    // Orphaned after an extension reload: stop observing so we don't keep
    // re-scanning (and throwing "context invalidated") on every feed mutation.
    if (!extAlive()) {
      observer.disconnect();
      return;
    }
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
