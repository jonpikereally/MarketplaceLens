// Marketplace Lens content script. Runs on facebook.com, but only acts on
// Marketplace pages. It remembers every listing card you've looked at and,
// on later visits, hides the ones you've already seen unless the price has
// changed. Everything is stored in this browser only.
(() => {
  if (window.__marketplaceLens) return;

  const ITEM_LINK = 'a[href*="/marketplace/item/"]';
  const KEY = "l:"; // storage key prefix: "l:<listing id>"
  // hideStyle: "blur" keeps the card's space and blurs it under a click-to-show label;
  // "cover" uses a solid panel instead; "collapse" removes the card from the grid.
  const DEFAULTS = { enabled: true, peek: false, seenMs: 1000, hideRightAway: false, forgetDays: 0, hideStyle: "blur", blurPx: 14 };

  // ---------- reading a card ----------

  const MONEY = /^(free|[A-Z]{0,3}\s?[$€£¥₹]\s?[\d.,\s]+|[\d.,\s]+\s?[$€£¥₹]|[\d.,]+\s?(kr|zł))$/i;

  // A price at the start of a card's first line (which may hold two: "CA$400CA$500").
  const LEADING_MONEY = /^(free|[A-Z]{0,3}\s?[$€£¥₹]\s?\d[\d.,]*|\d[\d.,]*\s?([$€£¥₹]|kr|zł))/i;

  // Versions up to 1.2.1 could save a sentence as a price (from a "New for you"
  // notice). Drop any saved price that isn't one, falling back to the last real one.
  function cleanRec(rec) {
    if (!rec || !rec.price || MONEY.test(String(rec.price).trim())) return rec;
    const h = (rec.h || []).filter((x) => x.p && MONEY.test(String(x.p).trim()));
    const last = h[h.length - 1];
    return { ...rec, h, price: last ? last.p : null, value: last ? last.v : null };
  }

  function priceValue(text) {
    if (!text) return null;
    if (/^free$/i.test(text.trim())) return 0;
    const m = text.match(/\d[\d.,\s]*/);
    if (!m) return null;
    let s = m[0].replace(/\s/g, "");
    const sep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (sep !== -1 && s.length - sep - 1 !== 3) s = s.slice(0, sep).replace(/[.,]/g, "") + "." + s.slice(sep + 1);
    else s = s.replace(/[.,]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // The link's label reads "Title, CA$6,000, Toronto, ON, listing 1844168883435292".
  // Card text reads "CA$6,000\nTitle\nToronto, ON" (with a second, older price
  // on the first line when the seller has dropped it).
  function readCard(a) {
    const id = (a.getAttribute("href").match(/\/marketplace\/item\/(\d+)/) || [])[1];
    if (!id) return null;
    const lines = (a.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    let price = null, title = null;
    const label = a.getAttribute("aria-label") || "";
    const parts = label.replace(/,?\s*listing \d+\s*$/i, "").split(", ");
    const pi = parts.findIndex((p) => MONEY.test(p.trim()));
    if (pi > 0) { price = parts[pi].trim(); title = parts.slice(0, pi).join(", "); }
    if (!price && lines.length) {
      const first = lines[0].match(LEADING_MONEY);
      price = first ? first[0].trim() : null;
    }
    // Links without a price aren't listing cards: Facebook's "New for you"
    // notices link to listings too ("…may sell soon: PlayAudio12").
    if (!price) return null;
    if (!title) title = lines.find((l, i) => i > 0 && !MONEY.test(l)) || lines[1] || "";
    const img = a.querySelector("img");
    return { id, price, value: priceValue(price), title: title.slice(0, 200), image: img ? img.currentSrc || img.src : null };
  }

  // The grid cell to hide: the card's ancestor that sits beside other cards.
  function cellOf(a) {
    let n = a;
    for (let i = 0; i < 12 && n.parentElement && n.parentElement !== document.body; i++) {
      const p = n.parentElement;
      let cards = 0;
      for (const c of p.children) if (c === n || c.querySelector(ITEM_LINK)) cards++;
      if (cards >= 2) return n;
      n = p;
    }
    return a;
  }

  const priceChanged = (rec, card) =>
    rec.value != null && card.value != null ? Math.abs(rec.value - card.value) > 0.005 : !!(rec.price && card.price && rec.price !== card.price);

  // ---------- state ----------

  let settings = { ...DEFAULTS };
  const seenThisTab = new Set(); // seen since this tab opened: stays visible until the next visit
  const changedThisTab = new Map(); // id -> { cls, text }: price tags stay up for the whole visit
  const revealedThisTab = new Set(); // covered listings you clicked to show
  const cards = new Map();       // link element -> { card, cell, rec }
  const timers = new Map();
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
  const isMarketplace = () => location.pathname.startsWith("/marketplace");

  function injectStyle() {
    if (document.getElementById("mlens-style")) return;
    const st = document.createElement("style");
    st.id = "mlens-style";
    st.textContent = `
      /* "collapse": take hidden cards out of the grid */
      html.mlens-collapse:not(.mlens-peek) [data-mlens="hide"] { display: none !important; }
      html.mlens-collapse.mlens-peek [data-mlens="hide"] { opacity: .3; filter: grayscale(1); }
      html.mlens-collapse.mlens-peek [data-mlens="hide"]:hover { opacity: .8; filter: none; }
      /* "cover": keep the space, put a click-to-show panel over the card.
         Colours follow Facebook's own light/dark theme variables. */
      [data-mlens="hide"] { position: relative !important; }
      .mlens-cover { display: none; }
      html:not(.mlens-collapse) [data-mlens="hide"] > .mlens-cover {
        display: flex; position: absolute; inset: 0; z-index: 4; cursor: pointer;
        flex-direction: column; align-items: center; justify-content: center; gap: 6px;
        border-radius: 8px; text-align: center; padding: 12px;
        background: var(--secondary-button-background, #e4e6eb); color: var(--secondary-text, #65676b);
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; transition: opacity .15s; }
      html:not(.mlens-collapse) [data-mlens="hide"] > .mlens-cover:hover { filter: brightness(.96); }
      html:not(.mlens-collapse) [data-mlens="hide"] > .mlens-cover:focus-visible { outline: 2px solid #1877f2; outline-offset: 2px; }
      html.mlens-peek:not(.mlens-collapse) [data-mlens="hide"] > .mlens-cover { opacity: .55; }
      .mlens-cover b { font-weight: 600; color: var(--primary-text, #050505); font-size: 14px; }
      .mlens-cover .mlens-show { font-weight: 600; color: var(--primary-button-background, #1877f2); }
      .mlens-cover svg { width: 28px; height: 28px; opacity: .6; }
      /* "blur": same panel, but see-through and blurred; labels sit on small pills */
      html.mlens-blur [data-mlens="hide"] > .mlens-cover {
        background: rgba(255, 255, 255, .18);
        backdrop-filter: blur(var(--mlens-blur, 14px)) saturate(.7); -webkit-backdrop-filter: blur(var(--mlens-blur, 14px)) saturate(.7); }
      html.mlens-blur.mlens-peek [data-mlens="hide"] > .mlens-cover { opacity: 1;
        backdrop-filter: blur(calc(var(--mlens-blur, 14px) / 4)); -webkit-backdrop-filter: blur(calc(var(--mlens-blur, 14px) / 4)); }
      html.mlens-blur [data-mlens="hide"] > .mlens-cover b,
      html.mlens-blur [data-mlens="hide"] > .mlens-cover .mlens-show {
        background: var(--card-background, #fff); padding: 3px 10px; border-radius: 12px; max-width: 92%; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
      html.mlens-blur [data-mlens="hide"] > .mlens-cover svg { color: #fff; opacity: .95; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
      [data-mlens-tagged] { position: relative !important; }
      .mlens-tag { position: absolute; top: 8px; left: 8px; z-index: 3; pointer-events: none;
        font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 4px 7px; border-radius: 6px; color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
      .mlens-tag.down { background: #1e7d32; }
      .mlens-tag.up { background: #b54708; }
      .mlens-tag.seen { background: rgba(0,0,0,.65); }
      .mlens-tag.rejected { background: #5f6368; }
      /* Manually rejected: always a solid, opaque panel, whatever the blur setting or peek */
      html:not(.mlens-collapse) [data-mlens="hide"] > .mlens-cover.rejected {
        background: var(--comment-background, #d8dadf) !important; opacity: 1 !important;
        backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
      .mlens-cover.rejected b { color: #c62828 !important; background: none !important; box-shadow: none !important; }
      .mlens-cover.rejected .mlens-show { background: none !important; box-shadow: none !important; padding: 0 !important; }
      .mlens-cover.rejected svg { color: #c62828 !important; opacity: .85 !important; filter: none !important; }
      .mlens-cover .mlens-note { font-size: 12px; }
      .mlens-cover .mlens-act { font-size: 12px; text-decoration: underline; cursor: pointer; color: var(--secondary-text, #65676b); }
      .mlens-cover .mlens-act:hover { color: #c62828; }
      html.mlens-blur [data-mlens="hide"] > .mlens-cover:not(.rejected) .mlens-act {
        background: var(--card-background, #fff); padding: 2px 8px; border-radius: 10px; text-decoration: none; }
      /* The ✕ "not interested" button in a visible card's corner, shown on hover */
      [data-mlens-btn] { position: relative !important; }
      .mlens-reject { position: absolute; top: 8px; right: 8px; z-index: 5; width: 28px; height: 28px; padding: 0;
        border: 0; border-radius: 50%; background: rgba(0,0,0,.62); color: #fff; cursor: pointer;
        font: 600 15px/28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center;
        opacity: 0; transition: opacity .15s, background .15s; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
      [data-mlens-btn]:hover > .mlens-reject, .mlens-reject:focus-visible { opacity: 1; }
      .mlens-reject:hover { background: #c62828; }
      .mlens-reject[data-act="unreject"]:hover { background: #1e7d32; }`;
    document.documentElement.append(st);
  }

  function applyPeek() {
    document.documentElement.classList.toggle("mlens-peek", !!settings.peek);
    document.documentElement.classList.toggle("mlens-collapse", settings.hideStyle === "collapse");
    document.documentElement.classList.toggle("mlens-blur", settings.hideStyle === "blur");
    const px = `${Math.min(40, Math.max(1, Number(settings.blurPx) || 14))}px`;
    if (document.documentElement.style.getPropertyValue("--mlens-blur") !== px) document.documentElement.style.setProperty("--mlens-blur", px);
  }

  // Exact time since a listing was seen: "45 seconds", "12 minutes",
  // "3 hours 20 minutes", "2 days 4 hours".
  const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function ago(t) {
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return `${unit(sec, "second")} ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${unit(min, "minute")} ago`;
    const hr = Math.floor(min / 60), m = min % 60;
    if (hr < 24) return `${unit(hr, "hour")}${m ? " " + unit(m, "minute") : ""} ago`;
    const day = Math.floor(hr / 24), h = hr % 24;
    return `${unit(day, "day")}${h ? " " + unit(h, "hour") : ""} ago`;
  }
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.1 4.3M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>';

  const XMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>';
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  // The panel over a hidden card. mode: null, "seen" (blur or cover, per
  // settings) or "rejected" (always solid). Built once per mode; afterwards
  // only its text changes.
  function cover(box, mode, entry) {
    let c = box.querySelector(":scope > .mlens-cover");
    if (c && c.dataset.mode !== mode) { c.remove(); c = null; }
    if (!mode) return;
    if (!c) {
      c = document.createElement("div");
      c.className = `mlens-cover ${mode}`;
      c.dataset.mode = mode;
      c.setAttribute("role", "button");
      c.tabIndex = 0;
      c.innerHTML = mode === "rejected"
        ? `${XMARK}<b>Manually rejected</b><span class="mlens-note"></span><span><span class="mlens-show">Click to show</span> · <span class="mlens-act" data-act="unreject">Undo</span></span>`
        : `${EYE}<b></b><span class="mlens-show">Click to show</span><span class="mlens-act" data-act="reject" title="Mark as not interesting: it gets a solid cover from now on">✕ Not interested</span>`;
      box.append(c);
    }
    const { rec, card } = entry;
    if (mode === "seen") {
      setText(c.querySelector("b"), `Seen ${ago(rec.s)}`);
      setAttr(c, "title", `Marketplace Lens: you saw this listing on ${when(rec.s)}. Click to show it.`);
    } else {
      const moved = card.value != null && rec.xv != null && Math.abs(card.value - rec.xv) > 0.005;
      setText(c.querySelector(".mlens-note"), moved ? `Now ${card.price} (was ${rec.xp} when you rejected it)` : `Rejected ${ago(rec.x)}`);
      setAttr(c, "title", `Marketplace Lens: you marked this listing as not interesting on ${when(rec.x)}. Click to show it.`);
    }
  }

  // The ✕ in a visible card's corner (shown on hover). state: null, "reject" or "unreject".
  function rejectButton(box, state) {
    let b = box.querySelector(":scope > .mlens-reject");
    if (!state) {
      if (b) b.remove();
      if (box.hasAttribute("data-mlens-btn")) box.removeAttribute("data-mlens-btn");
      return;
    }
    if (!b) { b = document.createElement("button"); b.type = "button"; b.className = "mlens-reject"; box.append(b); }
    const label = state === "reject" ? "Not interested: cover this listing from now on" : "Undo “Manually rejected”";
    setText(b, state === "reject" ? "✕" : "↺");
    setAttr(b, "data-act", state);
    setAttr(b, "title", label);
    setAttr(b, "aria-label", label);
    if (!box.hasAttribute("data-mlens-btn")) box.setAttribute("data-mlens-btn", "");
  }

  // Keep the "Seen … ago" labels counting while the page is open.
  setInterval(() => {
    if (document.hidden) return;
    for (const e of cards.values()) if (e.coverMode) cover(e.host || e.cell, e.coverMode, e);
  }, 1000);

  // Only touch the DOM when something changes: our own edits would otherwise
  // trigger the MutationObserver and re-scan forever.
  function tag(cell, cls, text) {
    let t = cell.querySelector(":scope > .mlens-tag");
    if (!text) {
      if (t) t.remove();
      if (cell.hasAttribute("data-mlens-tagged")) cell.removeAttribute("data-mlens-tagged");
      return;
    }
    if (!t) { t = document.createElement("div"); cell.append(t); }
    if (t.className !== `mlens-tag ${cls}`) t.className = `mlens-tag ${cls}`;
    if (t.textContent !== text) t.textContent = text;
    if (!cell.hasAttribute("data-mlens-tagged")) cell.setAttribute("data-mlens-tagged", "");
  }

  function expired(rec) {
    return settings.forgetDays > 0 && Date.now() - rec.s > settings.forgetDays * 864e5;
  }

  // Decide what a card should look like right now.
  function render(entry) {
    const { card, cell, rec } = entry;
    const box = entry.host || cell;
    let hide = false, mode = null, tagCls = null, tagText = null;
    let button = settings.enabled ? "reject" : null;
    if (settings.enabled && rec && rec.x) {
      // Manually rejected: covered on every visit, whatever the price does.
      if (!revealedThisTab.has(card.id)) { hide = true; mode = "rejected"; }
      else { tagCls = "rejected"; tagText = "Manually rejected"; button = "unreject"; }
    } else if (settings.enabled && rec && !expired(rec)) {
      if (priceChanged(rec, card)) {
        tagCls = card.value != null && rec.value != null && card.value > rec.value ? "up" : "down";
        tagText = `${tagCls === "up" ? "↑" : "↓"} was ${rec.price}`;
        changedThisTab.set(card.id, { cls: tagCls, text: tagText });
      } else if (changedThisTab.has(card.id)) {
        // Already saved the new price, but keep the tag for this visit.
        ({ cls: tagCls, text: tagText } = changedThisTab.get(card.id));
      } else if (!revealedThisTab.has(card.id) && (!seenThisTab.has(card.id) || (settings.hideRightAway && entry.leftView))) {
        hide = true; mode = "seen";
      }
    }
    if (hide && settings.hideStyle === "collapse") {
      // Removed from the grid; the tag only shows while peeking.
      tagCls = mode === "rejected" ? "rejected" : "seen"; tagText = mode === "rejected" ? "Rejected" : "Seen"; mode = null;
    }
    if (hide && cell.getAttribute("data-mlens") !== "hide") cell.setAttribute("data-mlens", "hide");
    else if (!hide && cell.hasAttribute("data-mlens")) cell.removeAttribute("data-mlens");
    tag(box, tagCls, tagText);
    entry.coverMode = hide ? mode : null;
    cover(box, entry.coverMode, entry);
    rejectButton(box, hide ? null : button);
  }

  // Mark (or unmark) a listing as not interesting. Saved with the listing, so
  // it stays rejected on every later visit.
  async function setRejected(entry, on) {
    const { card } = entry;
    const key = KEY + card.id;
    const now = Date.now();
    try {
      const rec = cleanRec((await chrome.storage.local.get(key))[key]);
      const next = rec ? { ...rec } : { f: now, s: now, t: card.title, i: card.image, h: card.price ? [{ t: now, p: card.price, v: card.value }] : [], price: card.price, value: card.value };
      if (on) Object.assign(next, { x: now, xp: card.price || next.price, xv: card.value ?? next.value });
      else { delete next.x; delete next.xp; delete next.xv; }
      await chrome.storage.local.set({ [key]: next });
      if (on) revealedThisTab.delete(card.id); else revealedThisTab.add(card.id); // undo leaves it showing
      for (const e of cards.values()) if (e.card.id === card.id) { e.rec = next; render(e); }
      countHidden();
    } catch (e) {
      send({ type: "error", code: String(e).includes("QUOTA") ? "ML-302" : "ML-301", details: String(e && e.stack || e) });
    }
  }

  // Clicking a cover shows that listing for the rest of this visit; its links
  // and the ✕ button mark or unmark it as rejected. None of them open the
  // listing (they sit inside Facebook's link), so clicks are caught first.
  function entryOf(el) {
    for (let n = el; n; n = n.parentElement) {
      if (n.__mlensEntry) return n.__mlensEntry;
      if (n.__mlensLink) return cards.get(n.__mlensLink);
    }
    return null;
  }
  function reveal(entry) {
    revealedThisTab.add(entry.card.id);
    render(entry);
    countHidden();
  }
  const onCoverClick = (e) => {
    if (!e.target.closest) return;
    const act = e.target.closest(".mlens-cover [data-act], .mlens-reject");
    const c = e.target.closest(".mlens-cover");
    if (!act && !c) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "click") return;
    const entry = entryOf(act || c);
    if (!entry) return;
    if (act) setRejected(entry, act.dataset.act === "reject");
    else reveal(entry);
  };
  for (const type of ["click", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup"]) window.addEventListener(type, onCoverClick, true);
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && (e.target.classList.contains("mlens-cover") || e.target.classList.contains("mlens-reject"))) {
      e.preventDefault(); e.stopImmediatePropagation();
      const entry = entryOf(e.target);
      if (!entry) return;
      if (e.target.classList.contains("mlens-reject")) setRejected(entry, e.target.dataset.act === "reject"); else reveal(entry);
    }
  }, true);

  // ---------- recording what you've seen ----------

  async function markSeen(entry) {
    const { card } = entry;
    const key = KEY + card.id;
    const now = Date.now();
    try {
      const rec = cleanRec((await chrome.storage.local.get(key))[key]);
      const next = rec ? { ...rec, s: now, t: card.title || rec.t, i: card.image || rec.i } : { f: now, s: now, t: card.title, i: card.image, h: [] };
      if (card.price && (!rec || priceChanged(rec, card) || !rec.price)) {
        if (rec && rec.price && priceChanged(rec, card)) next.c = now; // last price change
        next.h = [...(next.h || []), { t: now, p: card.price, v: card.value }].slice(-20);
        next.price = card.price;
        next.value = card.value;
      }
      await chrome.storage.local.set({ [key]: next });
      seenThisTab.add(card.id);
      entry.rec = next;
    } catch (e) {
      send({ type: "error", code: String(e).includes("QUOTA") ? "ML-302" : "ML-301", details: String(e && e.stack || e) });
    }
  }

  // A card only counts as seen when the whole thing (photo, price and title)
  // is on screen, below Facebook's fixed top bar. Cut-off cards don't count.
  const FULLY = 0.98; // allows for sub-pixel rounding
  const io = new IntersectionObserver((records) => {
    for (const r of records) {
      const entry = cards.get(r.target.__mlensLink);
      if (!entry) continue;
      if (r.isIntersecting && r.intersectionRatio >= FULLY && entry.cell.getAttribute("data-mlens") !== "hide") {
        if (!timers.has(entry)) timers.set(entry, setTimeout(() => { timers.delete(entry); entry.seen = true; markSeen(entry); }, settings.seenMs));
      } else {
        clearTimeout(timers.get(entry));
        timers.delete(entry);
        if (entry.seen && settings.hideRightAway && !entry.leftView) { entry.leftView = true; render(entry); countHidden(); }
      }
    }
  }, { threshold: [0, FULLY, 1], rootMargin: "-56px 0px 0px 0px" });

  // ---------- scanning the page ----------

  let countTimer = null;
  function countHidden() {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      const n = isMarketplace() && settings.enabled ? document.querySelectorAll('[data-mlens="hide"]').length : 0;
      send({ type: "count", n });
    }, 300);
  }

  async function scan() {
    if (!isMarketplace()) { countHidden(); return; }
    for (const [a, e] of cards) if (!a.isConnected) { io.unobserve(e.cell); cards.delete(a); }
    const fresh = [];
    for (const a of document.querySelectorAll(ITEM_LINK)) {
      const old = cards.get(a);
      if (old && old.cell.isConnected && old.cell.contains(a)) {
        // Facebook re-renders cards; make sure our attribute is still there.
        if (old.rec) render(old);
        continue;
      }
      const card = readCard(a);
      if (!card) continue;
      const cell = cellOf(a);
      cell.__mlensLink = a;
      const entry = { card, cell, rec: undefined };
      cards.set(a, entry);
      fresh.push(entry);
    }
    if (!fresh.length) { countHidden(); return; }
    let stored = {};
    try {
      stored = await chrome.storage.local.get(fresh.map((e) => KEY + e.card.id));
    } catch (e) {
      send({ type: "error", code: "ML-301", details: String(e && e.stack || e) });
    }
    for (const entry of fresh) {
      entry.rec = cleanRec(stored[KEY + entry.card.id]) || null;
      render(entry);
      io.observe(entry.cell);
    }
    countHidden();
  }

  // A single listing's own page counts as seeing it.
  let itemTimer = null;
  function watchItemPage() {
    clearTimeout(itemTimer);
    const id = (location.pathname.match(/\/marketplace\/item\/(\d+)/) || [])[1];
    if (!id) return;
    itemTimer = setTimeout(async () => {
      const title = (document.title || "").replace(/^\(\d+\)\s*/, "").replace(/^Marketplace\s*[–-]\s*/i, "").replace(/\s*\|\s*Facebook$/i, "");
      const h1 = document.querySelector("h1");
      let price = null;
      for (let box = h1 && h1.parentElement, i = 0; box && i < 4 && !price; box = box.parentElement, i++) {
        const span = [...box.querySelectorAll("span")].find((s) => s.children.length === 0 && MONEY.test((s.textContent || "").trim()));
        if (span) price = span.textContent.trim();
      }
      await markSeen({ card: { id, title: (h1 && h1.innerText.trim()) || title, price, value: priceValue(price), image: null } });
    }, Math.max(settings.seenMs, 1500));
  }

  let scanTimer = null;
  const scheduleScan = () => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 250); };

  async function start() {
    try {
      const { settings: s } = await chrome.storage.local.get("settings");
      settings = { ...DEFAULTS, ...(s || {}) };
    } catch { /* defaults */ }
    injectStyle();
    applyPeek();
    scan();
    watchItemPage();
    const ours = (n) => n.nodeType === 1 && (n.matches(".mlens-tag, .mlens-cover, .mlens-reject") || !!n.closest(".mlens-tag, .mlens-cover, .mlens-reject"));
    new MutationObserver((muts) => {
      if (muts.some((m) => !ours(m.target) && ![...m.addedNodes, ...m.removedNodes].every(ours))) scheduleScan();
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Facebook is a single-page app: follow URL changes.
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) { last = location.href; watchItemPage(); scheduleScan(); }
    }, 700);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) {
        settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
        applyPeek();
        cards.forEach((e) => e.rec !== undefined && render(e));
        countHidden();
      }
      // Rejected or un-rejected elsewhere (another tab, or "Un-reject all" in the popup).
      for (const [k, ch] of Object.entries(changes)) {
        if (!k.startsWith(KEY) || !ch.newValue || !!(ch.oldValue && ch.oldValue.x) === !!ch.newValue.x) continue;
        cards.forEach((e) => { if (KEY + e.card.id === k) { e.rec = cleanRec(ch.newValue); render(e); } });
        countHidden();
      }
      // "Forget all" from the popup: show everything again.
      if (Object.keys(changes).some((k) => k.startsWith(KEY) && !("newValue" in changes[k]))) {
        cards.forEach((e) => { if (e.rec && changes[KEY + e.card.id] && !("newValue" in changes[KEY + e.card.id])) { e.rec = null; render(e); } });
        countHidden();
      }
    });
  }

  // Exposed for testing in a page console.
  window.__marketplaceLens = { readCard, cellOf, priceValue, scan: () => scan() };

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) start();
})();
