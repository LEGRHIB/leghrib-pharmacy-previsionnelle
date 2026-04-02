[README.md](https://github.com/user-attachments/files/26448155/README.md)
# Leghrib Pharmacy V4 — Stock Management & Forecasting

A powerful, browser-based inventory management tool for pharmacies. Designed for the Leghrib Pharmacy in Algeria, it combines Excel data imports, automated ABC/XYZ classification, DCI matching, supplier analysis, and purchase list generation.

**No server required** — runs entirely in your browser. Works offline.

---

## Quick Start

1. **Open the app:**
   ```
   PharmaPlanV4.html
   ```

2. **Import your data** (Excel files):
   - Nomenclature ERP (daily stock)
   - Monthly sales history
   - Annual rotation (optional)
   - National DCI database (Chifa AI)
   - Client credit situation (optional)

3. **View insights:**
   - Dashboard with KPIs and charts
   - Stock alerts (ruptures, safety levels, overstocks)
   - Risk scoring and trend analysis
   - Supplier price comparison
   - Auto-generated purchase lists

4. **Manage corrections:**
   - Match products to DCI (drugs) manually
   - Tag articles/cosmetics
   - Track expiry dates
   - Export corrections as JSON

---

## Features

### 📊 Stock Analysis
- **ABC/XYZ Classification** — Identify critical products automatically
- **Seasonality** — Adjust forecasts by month
- **Days Remaining** — Real-time stock projection
- **Risk Scoring** — 0-100 composite risk metric

### 🔗 DCI Matching
- Auto-match products to national drug database (Chifa AI)
- Manual corrections with autocomplete
- Generic interchangeability detection
- Suppress purchases when DCI group has coverage

### 🏪 Supplier Management
- Track prices across multiple suppliers
- Identify best deals with date freshness
- Calculate monthly savings potential
- Detect stale pricing

### 📋 Purchase Lists
- Auto-generate shopping lists from forecasts
- Filter by urgency (ruptures, urgent, all)
- Export by supplier or product
- Suggest missing generics

### ⏰ Expiry Tracking
- Identify expired and near-expiry stock
- Calculate deplete time vs. consumption
- Value inventory at risk
- Suggest disposal actions

### 💳 Client Management
- Track unpaid invoices
- Flag critical clients (>4 months no payment)
- Export for follow-up calls

### 📱 Works Offline
- Installs as standalone app (desktop/mobile)
- Works without internet connection
- Caches all data locally

---

## Installation

### Local Testing
```bash
# No build required — just open:
PharmaPlanV4.html

# Run tests:
tests.html
```

### Production Deployment
1. Copy all files to your web server
2. HTTPS recommended (required for Service Worker)
3. Service Worker registers automatically on first load

### Required Files
```
PharmaPlanV4.html      — Main app
app.js                 — Application logic (177 KB)
styles.css             — Styling
sw.js                  — Service Worker (offline support)
manifest.json          — PWA configuration
icon.svg               — App icon
tests.html             — Unit test runner (optional)
tests.js               — Unit tests (optional)
```

---

## Usage

### Workflow

1. **Import** → Upload Excel files (drag & drop)
2. **Compute** → Click "Calculer les Prévisions"
3. **Review** → Check Dashboard for overview
4. **Manage** → Handle alerts, DCI, suppliers, expiry
5. **Export** → Generate purchase lists & reports

### Example Excel Formats

**Nomenclature (ERP stock):**
| Désignation/Nom commercial | Qté | P. Achat | Pér. |
|---|---|---|---|
| DOLIPRANE 500MG COMP | 150 | 8.50 | 2025-12-31 |

**Monthly Sales:**
| Désignation/Nom commercial | Date | Q.Entrée | Q.Sortie |
|---|---|---|---|
| DOLIPRANE 500MG COMP | 2026-03-01 | 100 | 45 |

**Chifa DCI Database:**
| DCI | Désignation | Code | Tarif |
|---|---|---|---|
| PARACETAMOL | DOLIPRANE 500MG COMP | 01A001 | 8.50 |

---

## Testing

### Run Unit Tests
```
Open: tests.html in browser
```

70 automated tests verify core algorithms:
- Dosage extraction (`extractDosage()`)
- Brand name extraction (`extractBrand()`)
- Dosage normalization (`normalizeDosage()`)
- Date parsing (`excelDate()`)

Green ✓ = pass, Red ✗ = fail

### Manual Testing Checklist
- [ ] Import Excel file → no errors
- [ ] DCI matching works → products identified
- [ ] ABC/XYZ classification applied
- [ ] Purchase list generated
- [ ] Settings saved (refresh page → data persists)
- [ ] Open in offline mode → still works

---

## Security Features

✅ **XSS Protection** — HTML escaping for all user data
✅ **Error Handling** — User-friendly alerts on failures
✅ **Data Validation** — Rejects malformed imports
✅ **Persistence** — IndexedDB + localStorage backup

---

## Browser Support

- Chrome/Edge 85+
- Firefox 78+
- Safari 14+
- Mobile browsers (iOS 14+, Android Chrome)

**Service Worker required for offline mode** — most modern browsers.

---

## Data Storage

- **LocalStorage** — Settings, DCI corrections (fast)
- **IndexedDB** — Backup persistence (robust)
- **No server** — All data stays in user's browser

Data exported as JSON for backup/sharing.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "Fichier non reconnu" | Check Excel column headers match format |
| DCI not matching | Import Chifa AI database first |
| Data lost after refresh | IndexedDB/localStorage may be disabled — check browser settings |
| Offline mode not working | Service Worker requires HTTPS (or localhost) |
| Tests failing | Run `tests.html` in modern browser; check console for errors |

---

## Development

### Adding Tests
Edit `tests.js` to add more test cases for core algorithms.

### Using Corrections Export
Use the DCI Matching page to export/import corrections as JSON:
```json
{
  "DOLIPRANE 500MG": {
    "dci": "PARACETAMOL",
    "dosage": "500MG"
  }
}
```

### Customizing Settings
Settings page allows:
- Alert thresholds (rupture, security, overstocks)
- Growth objectives by category
- Stock target months per ABC/XYZ group

---

## Support

For detailed implementation notes, see: `IMPLEMENTATION_SUMMARY.md`

For technical analysis, see: `Leghrib_Pharmacy_Analysis.md`

---

## License

Proprietary — Leghrib Pharmacy

---

**Version:** V4.1 (April 2026)
**Tech Stack:** Vanilla JavaScript, SheetJS, Chart.js, Service Worker
**Status:** Production Ready ✅
