# Corpus report

Tier full, 0 documents, levels serve, portable, archive, browser WebKit (webkit). 2 documents at a time, 2 threads each.

## Overall by level

| Level | Docs | Input MiB | Output MiB | Brotli q11 MiB | Gzip 9 MiB | Output as % of input | Octavo seconds | MiB/s |
|---|---|---|---|---|---|---|---|---|

## Browser verification

Scenarios: serve: desktop-light, desktop-dark, mobile, tablet, motion, no-js, print; portable: desktop-light, mobile, no-js; archive: desktop-light, mobile, no-js.

| Stage | Seconds |
|---|---|
| capture original | 0.0 |
| capture optimized | 0.0 |
| compare | 0.0 |
| cached | 0.0 |

Verdict cache: 0 of 0 comparisons served from the cache by WebKit 26.0 /home/runner/.cache/ms-playwright/webkit-2203/pw_run.sh 3049-a85baad3d8c07173ac387a59 channel= args=[].
Capture cache: 0 of 0 original captures served from the cache.

| Category / level | Docs | Input KiB | Output KiB | Brotli q11 KiB | Gzip 9 KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |
|---|---|---|---|---|---|---|---|---|---|---|

## Slowest

## Excluded (upstream render was not self-contained)
None.

## Problems
None.

## Limits

- WebKit: computed style for ::placeholder is unavailable; screenshot pixel comparison remains active.

## Cached verdicts
None.

Total browser verification: 0.0 s for 0 comparisons (0 cached) by WebKit 26.0 /home/runner/.cache/ms-playwright/webkit-2203/pw_run.sh 3049-a85baad3d8c07173ac387a59 channel= args=[].

## Browser checks

Engine WebKit (webkit) compared the scenarios .
Forced hover, focus, focus-visible and active states were checked with real pointer and keyboard events in scenarios with scripts. Hidden and unreachable targets are recorded in the compared state.
Checked 0 elements: hover applied to 0, focus to 0, focus visible to 0, active to 0.

Incomplete checks: none.
Unreachable elements: original 0, optimized 0.
Unreachable states: original 0 hover, 0 focus, 0 focus-visible, 0 active; optimized 0 hover, 0 focus, 0 focus-visible, 0 active.
Unreachable details: none.
