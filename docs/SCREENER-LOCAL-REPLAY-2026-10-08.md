# Stale device watchlist replay

After authentication loading was repaired, the user reported removed tickers returning. A synthetic regression reproduced a second persistence path: legacy `sepa_wl_dirty` caused `loadUserData` to upload every ticker in the device's `sepa_wl` snapshot absent from the cloud. This treated a deletion on another device as an unsaved addition.

The loader now imports only explicit `sepa_wl_pending_adds` created by new pre-auth additions. Removing a pre-auth ticker cancels its pending addition. Legacy snapshots remain local but are not automatically uploaded. Migration acknowledgement clears the pending list; failures retain it for retry. This deliberately avoids guessing whether a legacy local-only ticker is a new addition or a previously removed ticker.

The added browser regression failed before the source change and passed afterward. Existing migration, synchronized additions/removals, stale reads, write ordering and 350 frontend checks passed. No real-account entries were deleted during this work. Entries already re-imported into the cloud require the user to remove them again after both devices load the new version.
