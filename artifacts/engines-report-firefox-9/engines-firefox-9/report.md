# Corpus report

Tier full, 1 documents, levels serve, portable, archive, browser Firefox (firefox). 2 documents at a time, 2 threads each.

## Overall by level

| Level | Docs | Input MiB | Output MiB | Brotli q11 MiB | Gzip 9 MiB | Output as % of input | Octavo seconds | MiB/s |
|---|---|---|---|---|---|---|---|---|
| serve | 1 | 0.6 | 0.6 | 0.0 | 0.1 | 99.9% | 0.0 | 32.60 |
| portable | 1 | 0.6 | 0.6 | 0.0 | 0.1 | 99.9% | 0.8 | 0.85 |
| archive | 1 | 0.6 | 0.6 | 0.0 | 0.1 | 99.9% | 0.7 | 0.87 |

## Browser verification

Scenarios: serve: desktop-light, desktop-dark, mobile, tablet, motion, no-js, print; portable: desktop-light, mobile, no-js; archive: desktop-light, mobile, no-js.

| Stage | Seconds |
|---|---|
| capture original | 86.9 |
| capture optimized | 85.9 |
| compare | 565.3 |
| cached | 0.0 |

Verdict cache: 0 of 3 comparisons served from the cache by Firefox 141.0 /home/runner/.cache/ms-playwright/firefox-1490/firefox/firefox 577944-4403e4df9e39e64bb2ca4f39 channel= args=[].
Capture cache: 0 of 7 original captures served from the cache.

| Category / level | Docs | Input KiB | Output KiB | Brotli q11 KiB | Gzip 9 KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |
|---|---|---|---|---|---|---|---|---|---|---|
| scale / archive | 1 | 654.3 | 653.3 | 25.7 | 56.0 | 1.00 | 736 | 736 | 634.8 | 26.2 |
| scale / portable | 1 | 654.3 | 653.3 | 25.7 | 56.0 | 1.00 | 753 | 753 | 634.8 | 26.2 |
| scale / serve | 1 | 654.3 | 653.3 | 25.7 | 56.0 | 1.00 | 20 | 20 | 634.8 | 26.2 |

## Slowest
- twenty-thousand-paragraphs (portable): 753 ms for 654.3 KiB
- twenty-thousand-paragraphs (archive): 736 ms for 654.3 KiB
- twenty-thousand-paragraphs (serve): 20 ms for 654.3 KiB

## Excluded (upstream render was not self-contained)
None.

## Problems

- twenty-thousand-paragraphs (serve): [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] desktop-dark: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-dark: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] tablet: check incomplete: screenshot pixels not compared on load: 768x700016, tile count limit 512; [firefox] tablet: check incomplete: screenshot pixels not compared on load: 768x700016, tile count limit 512; [firefox] motion: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] motion: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] print: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] print: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (portable): [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (archive): [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] desktop-light: check incomplete: screenshot pixels not compared on resize: 1280x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] mobile: check incomplete: screenshot pixels not compared on load: 390x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512; [firefox] no-js: check incomplete: screenshot pixels not compared on load: 1280x700016, tile count limit 512

## Limits

- twenty-thousand-paragraphs (desktop-light, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, original, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-dark, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-dark, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, original, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, optimized, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (tablet, original, load): screenshot incomplete at 768x700016: tile count limit 512.
- twenty-thousand-paragraphs (tablet, optimized, load): screenshot incomplete at 768x700016: tile count limit 512.
- twenty-thousand-paragraphs (motion, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (motion, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (print, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (print, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, original, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, original, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, optimized, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, original, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (desktop-light, optimized, resize): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, original, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (mobile, optimized, load): screenshot incomplete at 390x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, original, load): screenshot incomplete at 1280x700016: tile count limit 512.
- twenty-thousand-paragraphs (no-js, optimized, load): screenshot incomplete at 1280x700016: tile count limit 512.

## Cached verdicts
None.

Total browser verification: 738.1 s for 3 comparisons (0 cached) by Firefox 141.0 /home/runner/.cache/ms-playwright/firefox-1490/firefox/firefox 577944-4403e4df9e39e64bb2ca4f39 channel= args=[].

## Browser checks

Engine Firefox (firefox) compared the scenarios desktop-light, desktop-dark, mobile, tablet, motion, no-js, print.
Forced hover, focus, focus-visible and active states were checked with real pointer and keyboard events in scenarios with scripts. Hidden and unreachable targets are recorded in the compared state.
Checked 0 elements: hover applied to 0, focus to 0, focus visible to 0, active to 0.

Incomplete checks: 26.
- twenty-thousand-paragraphs (desktop-light, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-light, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-dark, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-dark, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, original): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, optimized): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (tablet, original): screenshot pixels not compared on load: 768x700016, tile count limit 512
- twenty-thousand-paragraphs (tablet, optimized): screenshot pixels not compared on load: 768x700016, tile count limit 512
- twenty-thousand-paragraphs (motion, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (motion, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (print, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (print, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-light, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-light, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, original): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, optimized): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-light, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (desktop-light, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512, screenshot pixels not compared on resize: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, original): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (mobile, optimized): screenshot pixels not compared on load: 390x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, original): screenshot pixels not compared on load: 1280x700016, tile count limit 512
- twenty-thousand-paragraphs (no-js, optimized): screenshot pixels not compared on load: 1280x700016, tile count limit 512
Unreachable elements: original 0, optimized 0.
Unreachable states: original 0 hover, 0 focus, 0 focus-visible, 0 active; optimized 0 hover, 0 focus, 0 focus-visible, 0 active.
Unreachable details: none.
