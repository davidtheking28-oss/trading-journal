# Landing-page review — 2026-10-09

Read-only review of the current Hebrew landing page at desktop 1440 and tablet 820. No product files changed. Automated WCAG A/AA checks reported zero violations, keyboard focus was available, and neither viewport overflowed. Six public Hebrew/English landing/legal pages also passed the automated checks with 200% simulated zoom. These checks do not certify accessibility or conversion performance.

## Prioritized improvements

1. Registration links currently point to the same `dashboard.html` as login; the auth default is login. Give registration CTAs an explicit supported registration entry point while preserving normal login and authenticated-user behavior.
2. The initial product visual shows branding/login rather than the main value. Use a populated statistics/product screen as the poster and early video frames, with demonstration data identified. Let visitors enlarge the demo to read it.
3. Provide visible pause/play for the looping hero video and stop playback outside the viewport or in a hidden document. Reduced-motion behavior already exists. The WebM is approximately 1 MB; reducing unnecessary playback matters more than claiming an unmeasured speed improvement.
4. Reduce vertical gaps between broker trust, setup steps and features, especially on tablets. The full-page captures are approximately 6453 px high on desktop and 6768 px on tablet; assess whether shorter spacing improves comprehension without compressing Hebrew text.
5. Replace the broad feature heading “שכח מטבלאות” with a concrete benefit and add small actual examples for the screener, market themes and portfolio. The journal supports tables; the copy should explain what analysis adds to them.
6. State clearly that manual trade entry is also available, so broker setup does not appear mandatory. Avoid specific setup-time promises unless measured.

Typography is already coherent; preserve the Hebrew font family and focus on comfortable line lengths and readable secondary text rather than another font change. Local screenshots may show missing SVG icons because the audit helper serves SVG as generic binary; that artifact is not reported as a live defect. The testimonial image is lazy-loaded, so full-page capture alone is insufficient to judge its loaded tablet state.

Evidence: `LANDING-REVIEW-2026-10-09.json`, `landing-review-2026-10-09-output.json`, and `landing-2026-10-09-{1440,820}.png` in the session visualization directory. Recommendations are editorial/design judgments, not measured conversion gains. No live-account or real-device checks were performed.
