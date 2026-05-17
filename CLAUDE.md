# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step — open files directly in a browser:

```bash
# Run the app
open PharmaPlanV4.html

# Run unit tests
open tests.html
```

Service Worker requires HTTPS or `localhost`. For local dev, serve with any static file server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/PharmaPlanV4.html
```

## Architecture

**Stack:** Vanilla JS, SheetJS 0.18.5 (Excel parsing), Chart.js 4.4.1 (charts), PWA Service Worker. No framework, no bundler, no build toolchain.

**Single-page app structure:**
- `PharmaPlanV4.html` — shell with sidebar nav and `#mainContent` div. Pages render into this div via `showPage()`.
- `app.js` — monolithic ~1777-line application file containing all logic.
- `sw.js` — Service Worker; caches app shell + CDN assets for offline use.

**Global state** lives in the `DB` object at the top of `app.js`:
- `DB.rotation`, `DB.monthly`, `DB.nomenclature`, `DB.nationalDCI`, `DB.clients` — raw imported data
- `DB.products`, `DB.suppliers`, `DB.dciGroups` — computed output (populated by `computeAll()`)
- `DB.manualDCI`, `DB.manualCategories` — user corrections, persisted to storage
- `DB.settings` — alert thresholds, growth targets, stock target months per ABC/XYZ class

**Data pipeline:**

```
Excel upload → parseXLSX() → detectAndImport() → import{Rotation,Monthly,Nomenclature,ChifaDCI,Clients}()
                                                              ↓
                                                        computeAll()
                                                              ↓
                                              render{Alerts,Suppliers,Purchase,Expiry,...}()
```

`detectAndImport()` sniffs Excel column headers to route each file to the correct importer — no manual file-type selection needed.

`computeAll()` is the core engine: builds `DB.products` with ABC/XYZ classification, forecasts, risk scores, and DCI group matching. Everything downstream (alerts, purchase lists, supplier views) reads from `DB.products`.

**Persistence (dual-store):**
- IndexedDB is primary; localStorage is a fast fallback.
- Never use `localStorage.setItem()` directly — always call `persistSettings()`, `persistDCICorrections()`, or `persistCategories()`.
- `initApp()` loads from IndexedDB first, falls back to localStorage, and auto-migrates on first run.

## Key Conventions

**XSS protection:** All user-supplied data (product names, supplier names, client names from Excel) must be escaped before insertion via `innerHTML`. Use `escHTML(s)` for full values and `escTrunc(s, maxLen)` for truncated table cells. Never insert raw strings from imported data into HTML.

**ABC/XYZ classification:** Products are classified on two axes — A/B/C by revenue contribution, X/Y/Z by demand variability. The combination (e.g. `AX`, `BZ`) drives `targetMonths` for stock level calculations in `DB.settings.targetMonths`.

**DCI matching:** The Chifa AI database maps brand-name products to their generic DCI (active ingredient). `DB.dciGroups` groups products by DCI — when any product in a DCI group has sufficient stock, purchase suppression applies to the whole group. Manual corrections are stored in `DB.manualDCI`.

**UI language:** All user-facing text is in French. Keep it that way.

## Tests

70 unit tests in `tests.js` cover the core parsing algorithms: `extractDosage()`, `normalizeDosage()`, `extractBrand()`, `san()`, `excelDate()`, `monthKey()`. These functions are duplicated verbatim into `tests.js` so tests run standalone without the full app.

Run `tests.html` after any change to these functions and add test cases in `tests.js` when modifying parsing logic.
