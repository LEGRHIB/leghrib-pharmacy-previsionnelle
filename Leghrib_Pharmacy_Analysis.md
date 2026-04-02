# Full Analysis — Leghrib Pharmacy V4: Gestion Prévisionnelle des Stocks

## 1. Project Overview

**Leghrib Pharmacy V4** is a single-page web application built for a pharmacy in Algeria. It provides inventory forecasting and stock management, combining Excel data imports, ABC/XYZ classification, DCI (Dénomination Commune Internationale) matching, supplier analysis, expiry tracking, and automated purchase list generation.

The application is designed to run entirely in the browser with no backend server — all data processing happens client-side using vanilla JavaScript.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| Excel I/O | SheetJS (xlsx.js v0.18.5, loaded from CDN) |
| Charts | Chart.js v4.4.1 (loaded from CDN) |
| Styling | CSS3 with CSS custom properties, Flexbox, Grid |
| Persistence | localStorage (settings, DCI corrections) |
| Font | Google Fonts — Poppins |
| Backend | None — fully client-side |

---

## 3. Project Structure

```
├── PharmaPlanV4.html    — Entry point, HTML shell with sidebar navigation
├── app.js               — All application logic (1,651 lines)
├── styles.css           — Complete stylesheet (146 lines)
├── README.md            — Project documentation (French)
└── CONTRIBUTING.md       — Contributor guidelines
```

The entire application lives in **3 files** — the HTML is minimal (60 lines) and serves as a shell, while `app.js` contains all business logic, rendering, and state management.

---

## 4. Architecture & Data Flow

### Global State

A single `DB` object acts as the application's in-memory database, holding all imported data, computed products, settings, and indexes. This is a straightforward but effective approach for a single-user tool.

### Data Pipeline

1. **Import** — User drags Excel files; SheetJS parses them. The app auto-detects file type (nomenclature, rotation, monthly sales, Chifa DCI database, client data) based on column headers.
2. **Compute** — `computeAll()` is the central engine (~400 lines) that:
   - Builds a product index from nomenclature (stock), rotation (metadata), and monthly data (sales history)
   - Matches products to the national Chifa AI DCI database using brand + dosage
   - Applies manual DCI corrections
   - Detects and merges duplicate products (same brand + dosage)
   - Computes per-product metrics: seasonality, trend, ABC/XYZ classification, days remaining, target stock, risk score
   - Groups products by DCI + dosage for interchangeability analysis
   - Calculates alert levels and supplier rankings
3. **Render** — Each page (Dashboard, Alerts, DCI Match, etc.) renders directly to `innerHTML` with inline event handlers.

### Page Navigation

A sidebar-based SPA with 9 pages, each rendered by a dedicated function. Navigation uses `showPage()` which swaps content in `#mainContent`.

---

## 5. Key Features

### 5.1 Smart Excel Import
- Auto-detects file type from column headers — no manual selection needed
- Handles multiple simultaneous uploads
- Supports: ERP nomenclature, monthly sales, annual rotation, Chifa AI DCI database, client situation

### 5.2 ABC/XYZ Classification
- **ABC** (Pareto): Products classified by cumulative yearly revenue (A = top 80%, B = next 15%, C = rest)
- **XYZ** (Variability): Based on coefficient of variation of monthly sales (X < 0.3, Y < 0.6, Z ≥ 0.6)
- Configurable target stock months per ABC/XYZ combination (e.g., AX = 3 months, CZ = 1 month)

### 5.3 DCI Matching Engine
- Extracts brand name and dosage from product names using regex-based parsers
- Handles complex pharmaceutical dosage formats (compound: 400MG/20MG, percentages: 0.05%, European thousand separators: 200.000UI)
- Progressive matching: full brand → first 2 words → first word
- Strict dosage matching with multiple fallback strategies
- Manual correction interface with autocomplete from the national DCI database

### 5.4 DCI Group Coverage
- Groups products by DCI + normalized dosage
- If a DCI group has sufficient stock across generics, individual products are marked as "covered" — no purchase needed
- Shows available generics from the national database that the pharmacy doesn't carry

### 5.5 Withdrawn Products Detection
- Reads "retraits" (withdrawals) from secondary sheets in the DCI database
- Marks withdrawn products with strikethrough styling
- Prevents purchase suggestions for withdrawn medications

### 5.6 Risk Scoring (0-100)
Multi-factor composite score considering: days remaining, ABC classification, DCI coverage, XYZ variability, near-expiry quantity.

### 5.7 Supplier Analysis
- Tracks supplier prices over time per product
- Identifies best and second-best supplier by latest price
- Flags stale prices (configurable threshold)
- Calculates potential monthly savings from switching suppliers

### 5.8 Purchase List Generation
- Automated purchase suggestions based on target stock - effective stock
- Filters: urgent only, all below safety, or full restocking
- Export to Excel with per-supplier sheets
- Excludes DCI-covered and withdrawn products

### 5.9 Client Credit Management
- Tracks unpaid amounts per client
- Flags: Critique (>4 months), À relancer (>2 months), Récent (<2 months)
- Export to Excel for follow-up

### 5.10 Expiry Management
- Separates expired vs. near-expiry (3 months) vs. dead stock
- Calculates months to deplete near-expiry stock based on consumption rate
- Values expired and near-expiry stock in DA (Algerian Dinar)

---

## 6. Code Quality Assessment

### Strengths

- **Domain expertise is deep.** The dosage extraction/normalization logic handles real pharmaceutical naming conventions (European thousands separators, compound dosages, salt suffix removal). This reflects significant real-world iteration.
- **Smart auto-detection.** File import auto-identifies data type from headers, making the UX frictionless.
- **Effective computation model.** The multi-step pipeline (import → enrich → compute → classify → group) is logically sound and handles edge cases like duplicate products and withdrawn medications.
- **DCI interchangeability is well-thought-out.** Grouping generics by DCI + dosage and checking coverage before suggesting purchases is a genuinely useful pharmacy optimization.
- **Practical UI.** Dark theme, risk-based color coding, badge counts in navigation, pagination, and sortable tables make this usable for daily operations.
- **Zero dependencies on a server.** Runs entirely offline after loading CDN scripts (or could be made fully offline).

### Weaknesses

- **Monolithic `app.js` (1,651 lines).** All business logic, rendering, and state management in one file. There's no separation of concerns — data processing, DOM manipulation, and UI templates are interleaved.
- **innerHTML-based rendering.** The entire page is re-rendered as HTML strings with inline `onclick` handlers. This is fragile — XSS risks from product names, no DOM diffing, and the search bar focus bug (that V4 partially fixed) is symptomatic of this approach.
- **No module system.** Everything is global functions and a global `DB` object. No imports/exports, no encapsulation.
- **Template strings as a rendering engine.** Complex table rows are built as concatenated strings with ternary operators, making them very hard to read and maintain (see the 20+ line template literals in `updateAlertsTable`).
- **No tests.** For a tool managing pharmacy stock and purchase decisions, the lack of any test coverage is a significant risk, especially for the dosage parsing and matching logic.
- **localStorage for persistence is fragile.** Clearing browser data loses all manual DCI corrections. There's no backup/restore for settings (corrections have export/import, which is good).
- **No error boundaries.** If `computeAll()` throws, there's no recovery. A malformed Excel file could crash the session.
- **Minified CSS.** The CSS uses compressed one-liners for variables and some rules, making it harder to maintain.
- **Memory concerns.** All data is held in memory in the `DB` object. Large pharmacies with extensive history could hit limits.
- **CONTRIBUTING.md references V3** (`pharmplanV3.html`), which is outdated.

---

## 7. Security Considerations

- **XSS risk:** Product names from Excel files are inserted via `innerHTML` without sanitization. The `escAttr` function only handles quotes, not full HTML escaping. A malicious Excel file with `<script>` tags in product names could execute arbitrary code.
- **No CSP headers** (though this is a static file, not served).
- **localStorage data** is unencrypted and accessible to any script on the same origin.

---

## 8. UX/Design

- **Dark theme** with a pharmacy-green brand accent — clean and professional.
- **Responsive** with a mobile breakpoint that hides the sidebar at 768px (though the app is clearly designed for desktop use).
- **Good visual hierarchy:** Risk bars, color-coded badges, trend arrows, and DCI coverage indicators communicate status at a glance.
- **Modal detail view** for products is comprehensive — monthly charts, supplier comparison with date freshness, DCI group view with available generics.

---

## 9. Recommendations for Improvement

### High Priority

1. **Add HTML escaping** for all user-supplied data inserted via innerHTML (product names, supplier names, client names). At minimum, escape `<`, `>`, `&`, `"`, `'`.
2. **Add unit tests** for the dosage extraction, brand extraction, DCI matching, and ABC/XYZ classification logic. These are the core algorithms and bugs here directly impact purchase decisions.
3. **Add error handling** around `computeAll()` and file imports with user-friendly error messages.

### Medium Priority

4. **Modularize app.js** — separate into: `state.js` (DB), `importers.js`, `compute.js`, `matching.js`, `renderers/` (one per page). Use ES modules.
5. **Move to a component-based rendering approach** — even a lightweight one like lit-html or Preact would eliminate the innerHTML/focus issues and reduce XSS surface.
6. **Add IndexedDB support** as a more robust persistence layer, with automatic backup of manual corrections.
7. **Add data validation** on Excel imports — validate expected column types, handle missing columns gracefully, report import quality.

### Low Priority

8. **Add PWA support** (service worker + manifest) so the app works fully offline.
9. **Add print/PDF export** for the dashboard view.
10. **Internationalize** — the app is hardcoded in French; adding i18n support would make it reusable.
11. **Fix CONTRIBUTING.md** to reference V4 instead of V3.

---

## 10. Summary

This is a well-conceived, domain-specific tool that solves a real operational problem for an Algerian pharmacy. The pharmaceutical domain logic — dosage parsing, DCI matching, generic interchangeability, ABC/XYZ classification, seasonal forecasting — is sophisticated and reflects deep understanding of pharmacy operations.

The main technical debt is architectural: a monolithic single-file JavaScript application with string-based rendering. For a tool used by one pharmacy, this is entirely acceptable and pragmatic. If the project were to scale (multiple pharmacies, team use), modularization, testing, and a proper frontend framework would become necessary.

**Overall verdict:** A capable, practical pharmacy management tool with strong domain logic, held back only by code organization and a lack of test coverage.
