# Landing improvements — 2026-10-09

Implemented the approved review recommendations in Hebrew and English. Registration CTAs point to `dashboard.html?mode=register`; bootstrap selects the existing registration mode while authenticated users retain normal startup. Login links retain the login destination.

The hero shows the existing populated statistics image, labeled demonstration data, before any video downloads. Playback is explicit, with play/pause and accessible image enlargement through a native dialog. Escape and close return focus to the enlargement button. Video pauses when hidden/offscreen or reduced-motion becomes active and does not restart automatically. The existing clips and their brand intro are unchanged when the user chooses playback.

Added the manual-entry explanation, concrete feature copy, small market/screener previews, asset-category examples and tighter section spacing. Supplemental feature pictures have a bounded preview height. New shared landing assets are precached with matching URLs in the service worker.

Validation: a new registration-link regression failed before implementation and passed afterward. The browser run passed 13 tests including the existing journal regressions, registration mode, Hebrew/English preview controls, real video play/pause, dialog Escape/close and focus restoration. All 230 logic checks passed. Final Hebrew desktop (1440) and tablet (820) automated WCAG A/AA checks reported no violations, no root overflow and no JavaScript errors; final desktop output was visually inspected. CSS/JavaScript MIME types were corrected in the dedicated local audit helper before the final audit.

No claim of conversion gains or physical tablet validation is made. This request implemented the changes locally; no deployment was initiated by this work. Unrelated dashboard/legal modifications in the shared checkout were preserved.
