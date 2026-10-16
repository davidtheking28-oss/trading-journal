# Experimental pre-entry structure review

This is an uncalibrated heuristic, not full VCP/SEPA recognition, a Minervini-endorsed model, or personal-rule compliance. It does not change the existing 20-bar recurring-observation summaries, saved setups or trade records.

The optional Lab disclosure examines up to 60 daily bars strictly before entry day. At least 25 valid recent bars are required. Duplicate days, invalid OHLC, gaps over 7 days and close discontinuities above 35% cause abstention. Entry-day volume is deliberately excluded because it can include activity after execution.

Swing highs/lows require strict extrema against two bars on each side. Consecutive extrema of the same kind retain the more extreme value. The last three confirmed high-to-low legs must each be at least 1%; each successive depth must be below 80% of the previous depth, and the last no wider than 8%. The final close must be within 5% below the last leg's high, with no later high exceeding it by more than 2%. That high is an estimated pivot only. These are implementation thresholds, not a claim about Minervini's exact rules.

Volume dry-up compares the last 5 bars with the preceding 20. A ratio at most 60% is flagged. Missing, zero or invalid volume produces unknown volume rather than a negative verdict. Price structure and volume remain separate findings; a structure candidate is not a confirmed VCP.

Additional reference diagnostics (`experimental-swings-v2`): the last three confirmed swing lows are compared for strictly rising prices; fewer than three means unknown. The pre-entry 21-bar simple moving average is compared with its value five sessions earlier (26 bars required for direction); the last pre-entry close is compared with the latest average. This is explicitly labelled SMA, not a presumed user choice between SMA and EMA, and does not change candidate classification. On crypto, these are daily bars rather than exchange trading sessions.

Not assessed: prior uptrend/Trend Template, market context, actual planned pivot, continuation-entry classification, execution-time breakout volume, intraday triggers or personal risk rules. Fixed swing parameters can miss valid patterns or identify false positives. Before broader claims, independently label real examples, preserve an unseen validation set, and measure false positives, false negatives and abstentions by asset type. Winning/losing outcome is not a setup label.

Validation currently uses synthetic fixtures for shrinking pullbacks, missing history, unsupported shorts, duplicate days, absent volume, monotonic trends, reversed input and future-bar invariance. This does not establish real-world classifier accuracy.
