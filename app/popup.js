import { describe, detailsText, logError, ERROR_HOVER, ERROR_LIST_URL, REPO } from "../src/shared/errors.js";

const VERSION = chrome.runtime.getManifest().version;
const DEFAULTS = { enabled: true, peek: false, seenMs: 1000, hideRightAway: false, forgetDays: 0, hideStyle: "blur", updateSource: "" };
const KEY = "l:";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

let settings = { ...DEFAULTS };
const save = (patch) => guard("ML-301", async () => {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
})();

// ---------- errors: code, hover text, "?" link, Copy Details ----------

function errorBanner(err, onDismiss) {
  const d = describe(err.code);
  const el = document.createElement("div");
  el.className = "banner error";
  el.title = ERROR_HOVER;
  el.innerHTML = `
    <span class="grow" title="${esc(ERROR_HOVER)}">⚠️ <span class="err-code" title="${esc(ERROR_HOVER)}">Error code: ${esc(d.code)}</span>
      <a class="help" href="${ERROR_LIST_URL}" target="_blank" title="${esc(ERROR_HOVER)}">?</a><br>
      <span title="${esc(ERROR_HOVER)}">${esc(d.summary)} ${esc(d.hint)}</span></span>
    <button class="btn copy">Copy Error Details</button>
    <button class="btn dismiss">Dismiss</button>`;
  el.querySelector(".copy").onclick = async (e) => {
    await navigator.clipboard.writeText(detailsText(err, VERSION));
    e.target.textContent = "Copied";
  };
  el.querySelector(".dismiss").onclick = () => { el.remove(); onDismiss && onDismiss(); };
  return el;
}

function guard(code, fn) {
  return async (...args) => {
    try { return await fn(...args); } catch (e) {
      await logError(e.code || code, e.stack || String(e)).catch(() => {});
      $("#banners").prepend(errorBanner({ code: e.code || code, details: e.stack || String(e), t: Date.now() }));
    }
  };
}

function updateBanner(u) {
  const el = document.createElement("div");
  el.className = "banner update";
  el.innerHTML = `<span class="grow">⬆︎ <strong>Marketplace Lens v${esc(u.latest)} is available</strong> (you have v${esc(u.current)}).
    ${u.notes ? `<br>${esc(u.notes)}` : ""}
    <br>To install: download it, replace your MarketplaceLens folder with the new one, then click ↻ on Marketplace Lens in brave://extensions.
    If you cloned the repo, run <code>git pull</code> instead. What you've seen is kept either way.</span>
    ${u.url ? `<a class="btn" href="${esc(u.url)}" target="_blank">Download</a>` : ""}`;
  return el;
}

async function renderBanners(store) {
  const box = $("#banners");
  box.innerHTML = "";
  const seen = settings.errorsSeenAt || 0;
  for (const err of (store.errors || []).filter((e) => e.t > seen).slice(-3).reverse()) {
    box.append(errorBanner(err, () => save({ errorsSeenAt: err.t })));
  }
  if (store.update && store.update.available) box.prepend(updateBanner(store.update));
}

// ---------- main view ----------

function renderChanges(listings) {
  const changed = listings.filter(([, r]) => r.c && (r.h || []).length > 1).sort((a, b) => b[1].c - a[1].c);
  $("#changesCount").textContent = changed.length ? `(${changed.length})` : "";
  $("#noChanges").hidden = changed.length > 0;
  $("#changes").innerHTML = changed.slice(0, 25).map(([id, r]) => {
    const [prev, now] = r.h.slice(-2);
    const dir = now.v != null && prev.v != null && now.v > prev.v ? "up" : "down";
    return `<li><a href="https://www.facebook.com/marketplace/item/${esc(id)}/" target="_blank">
      ${r.i ? `<img class="thumb" src="${esc(r.i)}" alt="" referrerpolicy="no-referrer">` : `<div class="thumb"></div>`}
      <div><div class="title">${esc(r.t || "Listing " + id)}</div><div class="when">${dir === "up" ? "Went up" : "Dropped"} ${esc(ago(r.c))}</div></div>
      <div class="delta ${dir}"><span class="old">${esc(prev.p)}</span><span class="new">${dir === "up" ? "↑" : "↓"} ${esc(now.p)}</span></div></a></li>`;
  }).join("");
}

async function render() {
  const store = await chrome.storage.local.get(null);
  settings = { ...DEFAULTS, ...(store.settings || {}) };
  const listings = Object.entries(store).filter(([k]) => k.startsWith(KEY)).map(([k, v]) => [k.slice(KEY.length), v]);

  $("#enabled").checked = settings.enabled;
  $("#peek").checked = settings.peek;
  $("#offNote").hidden = settings.enabled;
  $("#seenMs").value = String(settings.seenMs);
  $("#hideRightAway").checked = settings.hideRightAway;
  for (const r of document.querySelectorAll('input[name="hideStyle"]')) r.checked = r.value === settings.hideStyle;
  $("#peek").parentElement.lastChild.textContent = { collapse: " Peek at hidden listings (shown faded)", blur: " Peek at hidden listings (less blur)", cover: " Peek at hidden listings (see through the covers)" }[settings.hideStyle] || " Peek at hidden listings";
  $("#forgetDays").value = String(settings.forgetDays);
  $("#updateSource").value = settings.updateSource || "";
  $("#total").textContent = listings.length.toLocaleString();
  $("#versionLine").textContent = `You have Marketplace Lens v${VERSION}.`;
  $("#ghLink").href = `https://github.com/${REPO}`;
  $("#errLink").href = ERROR_LIST_URL;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = tab ? `count:${tab.id}` : null;
  const n = key ? ((await chrome.storage.session.get(key))[key] || 0) : 0;
  $("#hiddenCount").textContent = n;
  $("#hiddenLabel").textContent = `listing${n === 1 ? "" : "s"} hidden on this page`;

  renderChanges(listings);
  await renderBanners(store);
}

// ---------- backup ----------

const doExport = guard("ML-402", async () => {
  const store = await chrome.storage.local.get(null);
  const listings = Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(KEY)));
  const blob = new Blob([JSON.stringify({ app: "MarketplaceLens", version: VERSION, exportedAt: new Date().toISOString(), listings })], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `marketplace-lens-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  $("#dataResult").textContent = `Exported ${Object.keys(listings).length.toLocaleString()} listings.`;
});

const doImport = guard("ML-401", async (file) => {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw Object.assign(new Error(`Not JSON: ${e.message}`), { code: "ML-401" }); }
  if (data.app !== "MarketplaceLens" || !data.listings || typeof data.listings !== "object") throw Object.assign(new Error("Missing app/listings fields"), { code: "ML-401" });
  const incoming = Object.entries(data.listings).filter(([k, v]) => k.startsWith(KEY) && v && v.s);
  const existing = await chrome.storage.local.get(incoming.map(([k]) => k));
  const patch = {};
  for (const [k, v] of incoming) {
    const cur = existing[k];
    patch[k] = !cur ? v : cur.s >= v.s ? { ...cur, f: Math.min(cur.f, v.f) } : { ...v, f: Math.min(cur.f, v.f) };
  }
  await chrome.storage.local.set(patch);
  $("#dataResult").textContent = `Imported ${incoming.length.toLocaleString()} listings.`;
  await render();
});

const doForget = guard("ML-301", async () => {
  const store = await chrome.storage.local.get(null);
  const keys = Object.keys(store).filter((k) => k.startsWith(KEY));
  if (!confirm(`Forget all ${keys.length.toLocaleString()} listings you've seen? They'll all show again on Marketplace.`)) return;
  await chrome.storage.local.remove(keys);
  $("#dataResult").textContent = `Forgot ${keys.length.toLocaleString()} listings.`;
  await render();
});

// ---------- wiring ----------

$("#enabled").onchange = (e) => { save({ enabled: e.target.checked }); $("#offNote").hidden = e.target.checked; };
$("#peek").onchange = (e) => save({ peek: e.target.checked });
$("#seenMs").onchange = (e) => save({ seenMs: Number(e.target.value) });
for (const r of document.querySelectorAll('input[name="hideStyle"]')) r.onchange = async (e) => { await save({ hideStyle: e.target.value }); render(); };
$("#hideRightAway").onchange = (e) => save({ hideRightAway: e.target.checked });
$("#forgetDays").onchange = (e) => save({ forgetDays: Number(e.target.value) });
$("#updateSource").onchange = (e) => save({ updateSource: e.target.value.trim() });
$("#export").onclick = doExport;
$("#import").onclick = () => $("#importFile").click();
$("#importFile").onchange = (e) => e.target.files[0] && doImport(e.target.files[0]);
$("#forget").onclick = doForget;
$("#checkUpdates").onclick = guard("ML-999", async (e) => {
  e.target.textContent = "Checking for Updates…";
  const u = await chrome.runtime.sendMessage({ type: "checkUpdates" });
  e.target.textContent = "Check for Updates…";
  const out = $("#updateResult");
  out.innerHTML = "";
  if (u.error) out.append(errorBanner({ ...u.error, t: u.checkedAt }));
  else if (u.available) out.append(updateBanner(u));
  else out.textContent = `Marketplace Lens is up to date (v${VERSION}).`;
});

guard("ML-301", render)();
