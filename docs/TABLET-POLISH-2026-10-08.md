# Tablet layout and accessibility follow-up

## Changes

- At 768–900px on touch devices, the overview uses two equal columns and the final odd KPI fills the remaining row. Other KPI groups and desktop layouts retain their own rules.
- Stock and investment tables get a localized horizontal-scroll hint only when their contents actually overflow, at touch widths 769–1180px. The 768px card layout does not show the hint.
- Overflow tracking batches row/style changes once per animation frame, watches both the wrapper and current table, and stops observing old tables when they are replaced.
- Monthly statistics tracker can receive keyboard focus for scrolling.
- Light-theme calendar summary text uses a darker foreground for contrast.

## Validation

- Automated axe scan: eight tabs × dark/light themes at 820×1180 with mocked authentication and empty fixtures; no WCAG 2 A/AA or 2.1 AA violations detected after fixes.
- Layout checks: populated overview at 768/820, real overflow and fit cases, English hint translation, and focus on monthly tracker.
- Tablet matrix: five tests passed across four viewport sizes, empty/populated states, dark/light themes and the quick trade dialog.
- Real Chart.js 820px matrix passed; the populated light overview was visually inspected.
- Logic: 228 tests passed. Existing browser regression: 11 tests passed.
- These are local checks, not certification or physical iPad/VoiceOver testing. Embedded screener contents remain outside the journal's mocked accessibility fixture.

## Local timing reference

At 820×1180, five rounds of overview/stocks/statistics rendering with 200 synthetic trades produced maximum synchronous render times of 18.1ms, 146.8ms and 47.8ms respectively. Charts and network were mocked. Measurements do not represent total load time, real tablet CPU performance or an improvement relative to an earlier release. Raw samples are in the local `docs/tablet-render-timings.json` artifact.

The stock table is the first candidate for a separate pagination or incremental rendering investigation if actual-device measurements confirm slow interaction.

## Publication

This follow-up is local; the previously published tablet and screener scan-button fixes remain live.
