# Personal Lab removed from the journal

On 2026-10-16 the user requested removal of the Lab for now.

Dashboard and statistics no longer include Lab mounts or entry points. Normal navigation does not load its module or initiate experiment requests. The service worker no longer precaches the module. Source and pure logic regressions are retained for possible restoration; no database records or policies were deleted.

Browser tests specifically named for the archived Lab inject their own test-only mounts. They validate dormant source, not production availability. The separate removal regression verifies that the real journal contains no Lab mounts and never requests its script during normal navigation. Trade snapshots and statistics remain active.
