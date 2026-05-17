# Audit Report — leghrib-pharmacy-previsionnelle

**Date:** 2026-05-17
**Audited files:** `app.js`, `PharmaPlanV4.html`, `styles.css`, `sw.js`, `manifest.json`, `tests.js`, `tests.html`, `CONTRIBUTING.md`

---

## CRITICAL

### C-1 — `escAttr` does not escape backslashes → JS injection via `onclick`
**`app.js` lines 22, 1046, 1170, 1225–1229, 1438, 1598**

```js
const escAttr = s => s.replace(/'/g,"\\'").replace(/"/g,'&quot;');
// Used as:
onclick="showDetail('${escAttr(p.name)}')"
```

A product name like `PROD\') alert(1)//` passes through `escAttr` unchanged (backslash not escaped). The HTML parser strips the backslash before the JS engine sees it, so the single-quote closes the string and the rest executes as JS. The Chifa AI Excel file is third-party — its `designation` field is not sanitized for backslashes.

**Fix:** Use `data-*` attributes and `addEventListener` instead of inline `onclick`, exactly like the DCI key encoding already done at line 1419 with `btoa(encodeURIComponent(name))`.

---

### C-2 — ABC classification is computed *after* `targetStock`/`suggestedPurchase` — ABC-differentiated target months are a no-op
**`app.js` lines 671–771**

Step 5 (the main metrics loop, line 724) reads `p.abc` to look up `DB.settings.targetMonths[p.abc + p.xyz]`, but `p.abc` is only assigned *after* the loop at line 771. Every product calculates its `targetStock` and `suggestedPurchase` using ABC=`'C'`, defaulting all products to CX/CY/CZ months (1–2 months). High-value A-class products never get their 3-month stock target.

**Fix:** Move the `allExitsValues` sort-and-assign block to *before* Step 5, or split Step 5 into two passes (build revenue totals → assign ABC → compute targets).

---

## HIGH

### H-1 — No Content Security Policy
**`PharmaPlanV4.html`**

No `<meta http-equiv="Content-Security-Policy">` or server-side CSP. Any XSS that lands has unrestricted DOM and localStorage/IndexedDB access. At minimum, add `object-src 'none'`, `base-uri 'self'`, and `connect-src 'none'`.

### H-2 — CDN scripts loaded without Subresource Integrity hashes
**`PharmaPlanV4.html` lines 15–16, `sw.js` lines 9–10**

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
```

No `integrity="sha384-..."`. A compromised or MITM'd CDN response gets full DOM/storage access. XLSX in particular could exfiltrate data via crafted Excel output.

**Fix:** Generate SRI hashes (`openssl dgst -sha384 -binary file.js | openssl base64 -A`) and add `integrity` + `crossorigin="anonymous"` to both tags.

### H-3 — `Object.assign(DB.settings, data.settings)` enables prototype pollution
**`app.js` lines 1488, 1758, 1771**

`data.settings` is taken directly from `JSON.parse(e.target.result)` (a user-imported corrections file) and spread onto `DB.settings`. A crafted JSON with `{"__proto__":{"isAdmin":true}}` would poison `Object.prototype`. This is realistic since corrections files are shared between pharmacy branches.

**Fix:** Whitelist-assign only known keys:
```js
const ALLOWED = ['alert_rupture','alert_securite','stock_cible','surstock','prix_perime_mois','growth_global','growth_categories','targetMonths'];
for (const k of ALLOWED) if (k in data.settings) DB.settings[k] = data.settings[k];
```

### H-4 — Supplier comparison search box re-renders on every keystroke but applies zero filtering
**`app.js` line 1163**

The search input calls `renderSuppliers()` on every `oninput`, but `renderSuppliers` builds its product list from `DB.products` with no reference to the input value. The search is fully non-functional and wastes a full DOM replacement per keystroke.

---

## MEDIUM

### M-1 — `escAttr` used on `placeholder` attribute — inconsistent with `escHTML` elsewhere
**`app.js` line 1426**

`escAttr` doesn't escape `<`/`>`/`&`. Using `escHTML` everywhere uniformly would be safer and less error-prone.

### M-2 — Service Worker caches CDN responses without integrity verification
**`sw.js` lines 36–41**

A compromised CDN response is cached and served for the entire cache lifetime (until `CACHE_NAME` changes on deploy). There is no expiry.

**Fix:** Pair with SRI (H-2). At SW level, either skip caching CDN responses (let HTTP cache + integrity handle it) or validate response size is within a reasonable bound.

### M-3 — SW offline fallback returns `undefined` for non-document requests
**`sw.js` lines 43–48**

When a cached CDN asset is missing offline, the handler returns `undefined`, causing a `TypeError: Failed to fetch` at the SW level.

**Fix:**
```js
.catch(() => event.request.destination === 'document'
  ? caches.match('PharmaPlanV4.html')
  : new Response('Offline', {status: 503, statusText: 'Service Unavailable'})
);
```

### M-4 — Product initialization object copy-pasted three times
**`app.js` lines 512–521, 526–535, 548**

The 15-field product template (with `daysRemaining:9999`, `bestPrice:Infinity`, `alertLevel:'dead'`, etc.) is duplicated verbatim in three places. A field change must be applied in all three; the line-548 inline version is a 400-character single-line that's easy to miss.

**Fix:** Extract `function makeProduct(name, overrides={}) { return {...defaults, name, ...overrides}; }`.

### M-5 — `getClientFlag` computed twice per client per render
**`app.js` lines 1521–1525 and 1578–1582**

`renderClients` and `updateClientsTable` both independently map `DB.clients` calling `getClientFlag` and date arithmetic. For 500 clients = 1000 calls and 2000 date subtractions per table refresh.

**Fix:** Compute enriched client list once in `renderClients`, store in a module-level `_clientsEnriched`, and have `updateClientsTable` operate on that.

### M-6 — Purchase filter logic duplicated between `renderPurchase` and `exportPurchase`
**`app.js` lines 1188–1192 and 1291–1294**

Both functions independently filter `DB.products` with the same three-step chain. Adding a new filter criterion to one silently diverges from the other.

**Fix:** Extract `getFilteredPurchaseList(filter)` and call from both.

### M-7 — `g.labo` and `g.type` are always `undefined` on generic suggestion objects
**`app.js` lines 1107, 1269–1270, 1298**

`buildDCIIndex` creates entries without `labo` or `type`. The purchase export (line 1298) produces visible `"BRANDNAME (undefined)"` strings in the output.

**Fix:** Add `labo: item.labo || ''` and `type: item.type || ''` to the index entry object.

### M-8 — `computeAll` calls `persistSettings()` unconditionally even when settings haven't changed
**`app.js` line 875**

Every file import and every DCI correction deletion triggers `computeAll`, which writes settings to both `localStorage` and IndexedDB unnecessarily.

**Fix:** Remove `persistSettings()` from `computeAll` — it's already called by the functions that actually mutate settings.

---

## LOW

### L-1 — `Object.values(DB.products)` called 14 times across render functions
**`app.js` lines 896, 950, 959, 1036, 1147, 1188, 1193, 1291, 1321–1323, 1374, 1410, 1663**

For 5000 products, each call allocates a fresh 5000-element array. Many calls happen in sequence.

**Fix:** Cache as `DB._productsArray` at the end of `computeAll`, invalidate on reset.

### L-2 — Dashboard monthly chart sums all raw transaction rows on every render
**`app.js` line 992**

`DB.monthly[mk].reduce(...)` runs over every raw monthly transaction on each dashboard navigation. These totals are constant post-import.

**Fix:** Precompute `DB._monthlyTotals` once in `computeAll`.

### L-3 — `renderDashboard` creates 4 `new Chart()` instances on every navigation without destroying old ones
**`app.js` lines 989–998**

Chart.js retains event listeners keyed by canvas ID. Re-creating canvases with the same IDs causes memory leaks and "Canvas already in use" warnings.

**Fix:** Store references in `DB._charts = {}` and call `.destroy()` before re-creating.

### L-4 — Magic sentinel `9999` and `9e3` used interchangeably for "infinite days"
**`app.js` lines 517, 720, 786, 803, 838, 1052, 1056, 1095, 1098, 1120**

`9999 !== 9000` — a product with 9500 days remaining passes the `> 9e3` check but is not the `9999` sentinel.

**Fix:** `const INFINITE_DAYS = Infinity;` and check with `=== Infinity`.

### L-5 — Test suite covers only 5 string-parsing utilities; core business logic is entirely untested
**`tests.js`**

`detectAndImport`, `importRotation/Monthly/Nomenclature/ChifaDCI`, `computeAll`, `matchProductToDCI`, `buildDCIIndex`, `getClientFlag`, all render functions, and all persistence functions have zero test coverage. The C-2 critical bug above would have been caught by a `computeAll` fixture test.

**Suggested additions:** (a) `matchProductToDCI` unit tests with mocked `DB._brandIndex`, (b) `computeAll` smoke test with small fixture data, (c) `escHTML`/`escAttr` edge-case tests (backslash, ampersand, null).

### L-6 — No graceful degradation when CDN scripts fail to load on first visit
**`PharmaPlanV4.html` lines 15–16**

If cdnjs is unreachable before the SW has cached anything, `XLSX` and `Chart` are `undefined`. `app.js` fails with uncaught `ReferenceError` and the user sees a blank page.

**Fix:**
```js
if (typeof XLSX === 'undefined' || typeof Chart === 'undefined') {
  document.getElementById('mainContent').textContent =
    'Erreur: bibliothèques non chargées. Vérifiez votre connexion.';
}
```

### L-7 — Ephemeral computed indexes mixed into `DB` with no clear boundary
**`app.js` entire file**

Properties like `DB.retraits`, `DB._withdrawnBrands`, `DB._brandIndex`, `DB._byCode`, `DB._mergedProducts` are not declared in the initial `const DB = {...}` object and must be manually enumerated in `clearAll`. Any new computed property is easy to forget.

**Suggestion:** Move all computed/ephemeral indexes to a separate `const CACHE = {}` that `computeAll` fully rebuilds, keeping `DB` as the canonical data-only store.

### L-8 — Tab switching rebuilds full page HTML on every click for Suppliers, Expiry, DCI Match pages
**`app.js` lines 1161, 1335–1337, 1390–1393**

Unlike the Alerts page (which correctly splits a one-time `renderAlerts` from a reusable `updateAlertsTable`), the other tabbed pages do a full `el.innerHTML` replacement on every tab click.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 4 |
| Medium | 8 |
| Low | 8 |
| **Total** | **22** |

The two criticals — **C-1** (backslash injection via `escAttr`) and **C-2** (ABC classification ordering bug that silently mis-computes every product's purchase target) — should be addressed before the next production deploy.
