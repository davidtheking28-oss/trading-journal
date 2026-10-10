# Automatic closed-trade chart — 2026-10-10

The generated chart now appears inside the existing screenshots modal opened by the existing camera icon. The separate trade-chart column was removed. A fully closed stock trade shows only its wide automatic chart. Clicking the chart enlarges it. The drag/drop area and upload/capture buttons are removed. Previously uploaded attachments remain stored but are not displayed in this modal. The automatic image has no delete control.

The image uses the same Lightweight Charts 4.2.0 engine as the screener: thin white OHLC bars, gray volume, right price axis, daily time axis and fixed 14px right padding. A six-month daily window at 960x436 matches the density of three-month screener cards; long-held trades extend the window to preserve entry. Only blue entry and gold exit arrows mark the transaction. Execution prices/dates and horizontal trade price lines are hidden.

Images are generated when the screenshots window opens, using the existing per-symbol OHLC request cache. Up to 100 derived PNGs are cached in memory, scoped to account/language/trade fingerprint. Session, modal render sequence, active trade, database identity and fingerprint guard all asynchronous writes. Opening or closing the window clears old DOM images so a previously viewed trade cannot flash during loading. Sign-out/account changes clear the cache and close both screenshots and lightbox.

Manual screenshots remain in the existing IndexedDB store. No schema, real-account data or screener Edge Function was changed. The vendored chart library has Apache license and notice files under assets/vendor/ and is precached by the service worker.

Validation: 235 logic checks passed. The browser suite checks the real dashboard and vendored chart library; focused regressions cover existing camera integration, enlargement, updated exit dates, retained manual photos, partial closes, unavailable data/retry and two regular synthetic accounts using the real authenticated market request path. Desktop layout and accessibility checks passed. No actual trading accounts or physical Safari/iPad were used.

Limitations: images are derived, not permanently uploaded. The current shared provider supports at most one year of daily bars; unsupported/out-of-range history displays unavailable/retry. Non-session dates attach the arrow to the nearest bar within three days. Deployment is gated by the GitHub Pages workflow regression checks.
