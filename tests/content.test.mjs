// Run: node tests/content.test.mjs
// Checks how listing cards are read, without a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
const pick = (re) => src.match(re)[0];
const { readCard, priceValue } = new Function(
  pick(/  const MONEY = .*\n/) + pick(/  function priceValue[\s\S]*?\n  }\n/) + pick(/  function readCard[\s\S]*?\n  }\n/) + "return { readCard, priceValue };"
)();

for (const [t, v] of [["CA$6,000", 6000], ["$20", 20], ["FREE", 0], ["Free", 0], ["€1.299,50", 1299.5], ["£12.50", 12.5], ["CA$1,200", 1200], [null, null]]) {
  assert.equal(priceValue(t), v, String(t));
}

const fakeLink = (label, text, href) => ({ getAttribute: (n) => (n === "aria-label" ? label : href), innerText: text, querySelector: () => null });
let c = readCard(fakeLink("2006 Suzuki gsxr, CA$6,000, Toronto, ON, listing 1844168883435292", "CA$6,000\n2006 Suzuki gsxr\nToronto, ON", "/marketplace/item/1844168883435292/?ref=x"));
assert.deepEqual([c.id, c.title, c.price, c.value], ["1844168883435292", "2006 Suzuki gsxr", "CA$6,000", 6000]);
// Commas in the title.
c = readCard(fakeLink("MSI Gaming Laptop - i7, RTX 3060, CA$900, Toronto, ON, listing 5", "", "/marketplace/item/5/"));
assert.deepEqual([c.title, c.price], ["MSI Gaming Laptop - i7, RTX 3060", "CA$900"]);
// No label: fall back to card text (dropped price shows both on line one).
c = readCard(fakeLink("", "CA$400CA$500\nRoad bike\nToronto, ON", "/marketplace/item/7/"));
assert.deepEqual([c.price, c.value, c.title], ["CA$400", 400, "Road bike"]);
c = readCard(fakeLink("Free Hot tub, FREE, Guelph, ON, listing 8", "FREE\nFree Hot tub\nGuelph, ON", "/marketplace/item/8/"));
assert.deepEqual([c.price, c.value, c.title], ["FREE", 0, "Free Hot tub"]);
assert.equal(readCard(fakeLink("x", "", "/marketplace/category/vehicles/")), null);
console.log("All content tests passed.");

// "Seen … ago" wording.
const { ago } = new Function(pick(/  const unit = .*\n/) + pick(/  function ago\(t\)[\s\S]*?\n  }\n/) + "return { ago };")();
const now = Date.now(), S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
for (const [dt, want] of [[0, "0 seconds ago"], [1 * S, "1 second ago"], [45 * S, "45 seconds ago"], [1 * M, "1 minute ago"], [12 * M + 30 * S, "12 minutes ago"],
  [1 * H, "1 hour ago"], [3 * H + 20 * M, "3 hours 20 minutes ago"], [1 * D, "1 day ago"], [2 * D + 4 * H + 5 * M, "2 days 4 hours ago"], [40 * D, "40 days ago"]]) {
  assert.equal(ago(now - dt), want, want);
}
console.log("All 'seen ago' tests passed.");
