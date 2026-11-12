# Engine redesign: scope and plan

This scopes the engine refactor brief against the code on the top of the pull request stack. It records what was checked, where the brief is adjusted and the plan that follows. It is a proposal for review, not a statement of what exists.

## What the code confirms

| Brief claim | Checked | Result |
|---|---|---|
| `Edits::new` silently drops overlapping edits and the report is built before that | `doc.rs`, `lib.rs` `simplify` | True. Fixed on its own in the pull request "Report only the edits that were applied" (into `main`). |
| `safe` is not a conservative mode, because `simplify` runs first | `lib.rs` | True. `Mode` only selects packaging (`Safe`, `Scripts`, `Packed`); pruning and Quarto removal run for every mode. The name overstates it. |
| The library needs filesystem, process and global thread state | `crates/octavo/src` | Mostly false. The only filesystem and process use is the disk cache (`cache.rs`, plus the `cache_directory` option). Threading is `rayon` on its global pool in eight modules. There is no environment, clock or network access in the library; remote files are fetched by the CLI. |
| Linked-resource loading goes through a host-provided interface | `embed.rs` | True already. `Resources` and `Loaded` take bytes and a content type. The CLI owns paths and downloads. |
| Site mode mixes discovery, planning and writing | `site.rs` | True. `optimize_directory` walks, plans and writes in one function. |
| Font subsetting is one document-wide switch | `fonts.rs`, `css.rs` | True. `Options::subset_text_fonts` is a boolean. The decision per face already exists internally (`decide`), but is not reported. |

## Where the plan departs from the brief

1. **Size.** The library is about 5,600 lines. Ten pull requests that rewrite the public surface are out of proportion to what is actually wrong. The plan below is six changes, each tied to a defect or a measured need.
2. **No `analyze`, `plan`, `apply` pipeline for a single document.** The in-memory call already exists (`optimize`, `simplify`). A plan/apply split is justified for site mode, where nothing may be written until the whole tree is valid. Elsewhere it adds types without removing a defect.
3. **Remote files.** The brief makes remote fetching opt-in and asks for an SSRF policy. Octavo's output files are always offline, so the CLI fetches stylesheets, fonts and images by default, with a size and time limit and `--no-fetch`. A private-network block was tried and dropped: Octavo is a local tool run by an author on their own documents, and the policy cost hundreds of lines and a flag for a threat that does not apply. It would be worth revisiting only if Octavo is ever run on documents from people other than the user.
4. **Skera.** The brief says to treat the Skera replacement as given. It is still an evaluation (#18). The font coverage work depends on the outcome and is sequenced after it.
5. **Quarto 2.** Nothing here targets it. The only portability rule kept is the cheap one: transformations take bytes and policy, and the host owns files, network, cache and threads.
6. **Evidence taxonomy.** Kept, but as a field on each audit record, not as a type hierarchy. The audit has to say which rule fired and whether it was a heuristic. A full proof-obligation framework would be unused by every current transform.

## Plan

| Step | Change | Why | Owner |
|---|---|---|---|
| 1 | Report only applied edits | Phantom entries in the audit | Done (pull request into `main`) |
| 2 | Edit engine: reject conflicts explicitly and report them as skipped, with the transform that lost; byte deltas in the report sum to the final size | The report must agree with the output | Claude (critical) |
| 3 | Replace `Mode` with independent settings: packaging (`plain`, `scripts`, `packed`), effort (`fast`, `balanced`, `maximum`), evidence (`generic`, `quarto1`), with `Safe` removed as a name; audit records carry the rule and its evidence class | `safe` does not mean safe; effort and risk must not be coupled | Claude designs the types, opencode migrates call sites and tests |
| 4 | Isolate the Quarto 1 rules (`quarto.rs`, word-index pruning) behind the `quarto1` evidence profile, detected from the generator tag | Heuristics must not apply to unknown HTML | opencode, reviewed |
| 5 | Embedding: containment of local paths to the resource roots, `<base>` and `type=module` cases in tests | Correctness of the new embedding path | opencode, reviewed |
| 6 | Site mode: plan in memory, write to a staging directory, verify references, then promote; symlink policy; no stale files from an earlier build | Partial or stale output | opencode, reviewed |
| 7 | Cache and threads: move the cache behind a trait owned by the CLI; take a thread count in the options instead of using the global pool where tests need determinism | Host ownership | opencode |
| 8 | Fonts: per-face coverage report and `off`, `auto`, `force`, after the Skera decision | Explain every subset or keep | opencode after #18 |
| 9 | CLI: the new flag set from steps 3 to 8, JSON audit with a schema version, exit codes | One coherent surface | opencode, reviewed |

## Open decisions

- Remote fetching default (this plan: on, with the security policy; brief: off).
- Whether to keep the name `Mode` for packaging only, or rename it.
- Whether the JSON audit schema should be stable from 0.1 or marked unstable until 0.2.
