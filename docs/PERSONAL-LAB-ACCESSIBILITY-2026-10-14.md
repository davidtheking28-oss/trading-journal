# Personal Lab accessibility and usability review — 2026-10-14

Target: local Personal Lab preview, desktop/tablet. Skills: impeccable (product, distill, polish) and design accessibility-review.

## Changes

- One current measure and one primary next action; comparisons and monetary results remain in a native expandable disclosure.
- Template selection is a short list of full-width native buttons; no new question flow or added dependencies.
- Same Heebo font and journal theme tokens. Fixed, readable type hierarchy, restrained color and consistent spacing.
- Native details/summary keyboard behavior, visible focus outlines, logical focus after choosing/back/creation and a direct action to open missing documentation.
- Disclosure choices survive journal rerenders, preventing updates from closing the section a user was reading.
- Actions and disclosure headings have at least 44px touch height. Content reflows at tablet size and 200% font zoom without overflowing the lab region.

## Verification scope

Playwright exercises Hebrew/English, light/dark, desktop and tablet viewports, keyboard Enter navigation, focus, privacy mode, disclosure persistence and zoom. axe-core checks contrast, labels and button names, including the expanded comparison view. Existing journal-wide keyboard/contrast regression checks also run.

Automated tests and keyboard simulation do not replace a physical device or NVDA/VoiceOver review; neither was performed in this pass. This is not a certification of full WCAG conformance.

The implementation leaves the server and trade data unchanged. Automatic personal-rule verification is outside this UI pass.

Final full-browser results are appended after completion.

Final verification: 262 logic tests and 39 browser tests passed, including expanded-view contrast, labels, keyboard actions, 44px primary action height, preserved disclosures and 200% font zoom at tablet width. Screenshots were visually inspected. No runtime page errors in the three local preview modes. Local preview asset URLs now use source timestamps so service-worker cache entries from an older preview cannot mask edits.
