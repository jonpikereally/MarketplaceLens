# Brief for anyone (human or AI) working on Marketplace Lens

Marketplace Lens is a Manifest V3 extension (Brave/Chrome/Edge). Plain JS, no build step, no dependencies. Sibling of FakeSale (jonpikereally/FakeSale), with the same release and error-code conventions.

- **Card detection** (`src/content.js`): listing cards are `a[href*="/marketplace/item/<id>/"]`. Title and price come from the link's `aria-label` ("Title, CA$6,000, Toronto, ON, listing <id>"), falling back to the card text, whose first line is the price. The element hidden is the card's grid cell: its nearest ancestor that sits beside other cards. Never rely on Facebook's generated class names.
- **Seen** = the whole cell is ≥98% inside the viewport (below a 56px top bar) for `settings.seenMs`. Item pages count as seen after 1.5 s.
- **Hiding** happens for listings seen *before this tab loaded* (`seenThisTab`), unless `hideRightAway` is on. Price-changed cards are never hidden on that visit, and keep their tag (`changedThisTab`) even after the new price is saved.
- **Hide styles** (`settings.hideStyle`): `blur` (default) and `cover` add a `.mlens-cover` panel inside the hidden cell (backdrop-filter blur, or solid), and `collapse` sets `display:none` via the `html.mlens-collapse` class. Clicks on a cover are swallowed in the window's capture phase (so Facebook's link doesn't open) and add the id to `revealedThisTab`. Covered cards never count as seen.
- **DOM writes must be idempotent.** The MutationObserver rescans on page changes, so `render()`/`tag()` only touch the DOM when something differs. Otherwise the page re-scans forever. The observer also ignores mutations of our own `.mlens-tag` / `.mlens-cover` elements.
- **Storage:** `chrome.storage.local`, one `l:<listing id>` key per listing: `{ f firstSeen, s lastSeen, t title, i image, price, value, h: [{t,p,v}] (last 20 prices), c lastPriceChange }`, plus `settings`, `errors` and `update`. Never rename these keys without a migration.
- **Errors:** every user-facing error has an `ML-###` code in `src/shared/errors.js`, documented in `ERRORS.md`; `scripts/check-errors.sh` enforces this.
- **Testing:** `node tests/content.test.mjs`, plus the two pages in `tests/` (see README). In an embedded or background browser that isn't painting frames, IntersectionObserver never fires, so take screenshots to drive rendering when automating.
- **Releases:** bump `manifest.json` version + `RELEASE_NOTES.txt`, push to `main`; the Action builds `updates/`.
