# Corpus report

Tier full, 1 documents, levels serve, portable, archive, browser Chromium (chromium). 2 documents at a time, 2 threads each.

## Overall by level

| Level | Docs | Input MiB | Output MiB | Brotli q11 MiB | Gzip 9 MiB | Output as % of input | Octavo seconds | MiB/s |
|---|---|---|---|---|---|---|---|---|
| serve | 1 | 0.3 | 0.3 | 0.0 | 0.0 | 100.0% | 0.0 | 19.43 |
| portable | 1 | 0.3 | 0.3 | 0.0 | 0.0 | 100.0% | 0.0 | 11.25 |
| archive | 1 | 0.3 | 0.3 | 0.0 | 0.0 | 100.0% | 0.0 | 15.28 |

## Browser verification

Scenarios: serve: desktop-light, desktop-dark, mobile, tablet, motion, no-js, print; portable: desktop-light, mobile, no-js; archive: desktop-light, mobile, no-js.

| Stage | Seconds |
|---|---|
| capture original | 21.3 |
| capture optimized | 20.0 |
| compare | 0.0 |
| cached | 0.0 |

Verdict cache: 0 of 3 comparisons served from the cache by Chromium 157.0.8103.0 /usr/bin/chromium 533058960-c620e14927d98bd65fe92a90 channel= args=["--allow-file-access-from-files","--disable-dev-shm-usage"].
Capture cache: 0 of 7 original captures served from the cache.

| Category / level | Docs | Input KiB | Output KiB | Brotli q11 KiB | Gzip 9 KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |
|---|---|---|---|---|---|---|---|---|---|---|
| parsing / archive | 1 | 293.1 | 293.1 | 0.1 | 0.6 | 1.00 | 19 | 19 | 293.1 | 0.1 |
| parsing / portable | 1 | 293.1 | 293.1 | 0.1 | 0.6 | 1.00 | 25 | 25 | 293.1 | 0.1 |
| parsing / serve | 1 | 293.1 | 293.1 | 0.1 | 0.6 | 1.00 | 15 | 15 | 293.1 | 0.1 |

## Slowest
- parsing-very-long-line (portable): 25 ms for 293.1 KiB
- parsing-very-long-line (archive): 19 ms for 293.1 KiB
- parsing-very-long-line (serve): 15 ms for 293.1 KiB

## Excluded (upstream render was not self-contained)
None.

## Problems
None.

## Limits
None.

## Cached verdicts
None.

Total browser verification: 41.3 s for 3 comparisons (0 cached) by Chromium 157.0.8103.0 /usr/bin/chromium 533058960-c620e14927d98bd65fe92a90 channel= args=["--allow-file-access-from-files","--disable-dev-shm-usage"].

## Browser checks

Engine Chromium (chromium) compared the scenarios desktop-light, desktop-dark, mobile, tablet, motion, no-js, print.
Forced hover, focus, focus-visible and active states were checked with real pointer and keyboard events in scenarios with scripts. Hidden and unreachable targets are recorded in the compared state.
Checked 0 elements: hover applied to 0, focus to 0, focus visible to 0, active to 0.

Incomplete checks: none.
Unreachable elements: original 0, optimized 0.
Unreachable states: original 0 hover, 0 focus, 0 focus-visible, 0 active; optimized 0 hover, 0 focus, 0 focus-visible, 0 active.
Unreachable details: none.
