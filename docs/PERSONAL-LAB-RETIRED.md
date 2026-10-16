# Personal Lab removed from the journal

On 2026-10-16 the user requested removal of the Lab for now.

Dashboard and statistics no longer include Lab mounts or entry points. The Lab loader, refresh/session hooks and experiment realtime subscription have been removed from active scripts. The trade-image modal no longer calls setup analysis. Its setup/VCP/coach functions and Lab styles have also been removed from production assets. The service worker no longer precaches the module. No database records or policies were deleted.

Legacy Lab source and retired browser scenarios are archived under `tests/archived/`, outside the published website. Pure legacy logic tests still read that archive, but retired UI scenarios are not part of the active browser suite. The removal regression verifies that the real journal contains no Lab mounts and never requests its script during normal navigation. A trade-chart regression verifies that no setup review appears under the image. Trade snapshots and statistics remain active.
