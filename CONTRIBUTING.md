# Contributing

Thanks for helping improve this project.

## Getting started

1. Open `PharmaPlanV4.html` in a browser.
2. Use sample XLSX files or your own test data.
3. Run `tests.html` in a browser to verify core algorithms pass.

## Code style

- Keep JavaScript in `app.js` and CSS in `styles.css`.
- Prefer small, focused functions.
- Add comments only for non-obvious logic.
- Use `escHTML()` for any user-supplied data inserted via innerHTML.
- Use `escTrunc()` for truncated product/client names in tables.

## Testing

- Open `tests.html` in a browser to run the unit test suite.
- If you change parsing logic (dosage extraction, brand extraction, DCI matching), add corresponding test cases in `tests.js`.
- Verify all tests pass before submitting changes.

## Persistence

- Settings and corrections are saved to both localStorage (fast fallback) and IndexedDB (robust).
- Use `persistSettings()`, `persistDCICorrections()`, and `persistCategories()` instead of raw `localStorage.setItem()`.

## Suggestions

- If you change parsing or matching, add a short note in the PR description about expected input formats.
- If you change UI, include a screenshot when possible.

## Submitting changes

1. Create a branch from main.
2. Commit with a clear message.
3. Open a pull request and describe what changed and why.
