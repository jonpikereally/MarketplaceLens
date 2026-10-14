# Marketplace Lens

A browser extension for Brave, Chrome, Edge and other Chromium browsers that **hides Facebook Marketplace listings you've already seen**, unless the price has changed.

Marketplace keeps showing the same listings. Marketplace Lens remembers every listing you've looked at, and on later visits it hides the ones you've seen, so the feed shows what's new.

## What it does

- **Remembers what you've seen.** A listing counts as seen once the *whole* card (photo, price and title) has been on screen for about a second. Cards cut off at the edge of the window don't count. Opening a listing counts too.
- **Hides seen listings on your next visit**, or after a reload. It doesn't hide while you're scrolling, so the page never jumps under you. (Settings has an option to hide them as soon as you scroll past.)
- **You choose how they're hidden** (Settings → Hidden listings):
  - **Blur them** (default): the listing keeps its spot in the grid, blurred, with "Seen 3 days ago · Click to show" on top. A **Blur strength** slider sets how blurred, from light to unreadable.
  - **Cover them**: the same, with a solid panel instead of a blur.
  - **Remove them**: they disappear from the grid, so new listings move up.

  Clicking a blurred or covered listing shows it for the rest of that visit, without opening it.
- **Shows price changes.** If a seen listing comes back at a different price, it stays visible with a tag: **↓ was CA$500** (green) or **↑ was CA$200** (orange). Once you've seen the new price, it's hidden again next time. The popup lists recent price changes.
- **Toolbar badge** shows how many listings are hidden on the current page.
- **Peek** at hidden listings (less blur, see-through covers, or faded) from the popup, or switch hiding off entirely.
- **Show seen listings again** after 7, 30 or 90 days, if you like (default: never).
- **Backup and restore** what you've seen (Settings → Export / Import).

## Privacy

Everything stays in your browser (`chrome.storage.local`). Marketplace Lens has no server, no account and no analytics. It only runs on facebook.com and only acts on Marketplace pages. For each listing it stores the listing number, title, price history, photo link and when you saw it. It never reads messages, your profile, or anything you type. The only other network request is a check of this repo's `updates/latest.json` for new versions.

## Install (Brave)

1. Download the latest [MarketplaceLens.zip](https://github.com/jonpikereally/MarketplaceLens/raw/main/updates/MarketplaceLens.zip) and unzip it somewhere permanent (not Downloads). Or clone this repo.
2. Open `brave://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `MarketplaceLens` folder (the one containing `manifest.json`).
4. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to Marketplace Lens.

The same steps work in Chrome (`chrome://extensions`) and Edge (`edge://extensions`).

## Updating

Marketplace Lens checks this repo for new versions at startup and every 6 hours, and shows a banner in the popup when one exists. You can also check by hand in Settings → Check for Updates…. To install an update, either `git pull` or replace the folder with the new zip, then click ↻ on Marketplace Lens in `brave://extensions`. What you've seen is kept, because it lives in the browser, not the folder. Don't *remove* the extension, though: that deletes its data. Export a backup first if you need to.

## If Facebook changes its layout

Marketplace Lens recognises listing cards by their links (`/marketplace/item/<number>/`) and the label Facebook attaches to them ("Title, CA$120, Toronto, ON, listing 123…"). Both have been stable, but if listings stop being hidden or prices read wrong, please [open an issue](https://github.com/jonpikereally/MarketplaceLens/issues).

## Errors

Every error Marketplace Lens shows has a code (e.g. `ML-301`) and a **Copy Error Details** button. See [ERRORS.md](ERRORS.md) for the full list.

## Development

No build step: plain JavaScript (Manifest V3).

| Path | What it is |
|---|---|
| `manifest.json` | Extension manifest; `version` here is the release version |
| `src/content.js` | Runs on facebook.com; tracks seen cards, hides them, tags price changes |
| `src/background.js` | Service worker; toolbar badge and update checks |
| `src/shared/errors.js` | Error code catalogue (keep in sync with `ERRORS.md`) |
| `app/` | The popup |
| `tests/fake-marketplace.html` | A stand-in Marketplace feed that runs the real content script, with buttons for "next visit", price drops and peek |
| `tests/popup-harness.html` | The popup with sample data |

To try the test pages: `python3 -m http.server 8793` in the repo root, then open `/tests/fake-marketplace.html` or `/tests/popup-harness.html`. Unit tests: `node tests/content.test.mjs`.

**Releasing:** bump `version` in `manifest.json`, write `RELEASE_NOTES.txt`, and push to `main`. The GitHub Action builds `updates/MarketplaceLens.zip` and `updates/latest.json`. Don't edit `updates/` by hand.

## License

MIT
