# Engine Redesign: Host-Neutral Core, Orthogonal Options, and Reconciled Reports

## Executive Summary

Octavo's core engine redesign addresses architectural coupling and API constraints across `crates/octavo` and `crates/octavo-cli`. The primary objective is to transform the library into a clean, host-neutral, auditable HTML optimization engine capable of embedding into larger Rust toolchains without requiring filesystem access, global runtime state, process execution, or hardcoded generator-specific assumptions.

The redesign preserves Octavo's user value, performance, and deterministic output byte contract while establishing clear internal boundaries, strong typing, comprehensive error reporting, and orthogonal configuration axes.

---

## Current Structure

### Library Architecture (`crates/octavo`)

The core library is currently structured around a document scan, parallel analysis stages, and a linear edit-application pipeline:

- `lib.rs`: Exposes the public API (`optimize`, `simplify`, `Mode`, `Options`, `Output`, `Simplified`, `Applied`, `Skipped`, `Warning`, `Error`). Coordinates stage execution through `rayon::join`.
- `doc.rs`: Encapsulates document scanning, tag collection, word extraction, and edit management (`Doc`, `Edit`, `SkippedEdit`, `Edits`, `WordParts`). Implements non-overlapping slice editing with winner-takes-all collision resolution.
- `html.rs`: Lexical scanning and parsing of HTML elements (`<script>`, `<style>`, `<link>`, `<img>`, `<svg>`), attribute tokenization, and tag closing detection.
- `css.rs`: Evaluates CSS rule reachability against document words, strips unused rules, minifies stylesheets, and prepares font face definitions.
- `js.rs`: JavaScript minification and license comment preservation.
- `quarto.rs`: Detects unused Quarto 1 runtime libraries (Bootstrap, Tippy, Popper, ClipboardJS, AnchorJS) and produces removal edits.
- `fonts.rs`: Font subsetting via Skera and WOFF2 conversion.
- `images.rs`: Lossless WebP re-encoding via `oxipng` and optional lossy AVIF/WebP encoding.
- `pack.rs`: Compression of scripts and stylesheets into DEFLATE/Brotli payload with JavaScript bootstrap unpacking logic.
- `embed.rs`: Inlines linked stylesheets, scripts, images, and fonts via host-provided `Resources` trait.
- `cache.rs`: On-disk caching of re-encoded fonts using filesystem directories.
- `check.rs`: Input validation checking whether input is HTML and self-contained.

### CLI Application (`crates/octavo-cli`)

- `main.rs`: CLI argument parsing via `clap`, terminal presentation via `anstream`/`anstyle`, progress indicators via `indicatif`, filesystem discovery, and network resource fetching via `ureq`.
- Implements `FsResources` to fulfill `Resources` by resolving file paths across candidate directories and downloading remote URLs when permitted.
- Executes two primary commands: optimization (file rewrite via atomic staging) and audit (breakdown of byte savings per transformation).

---

## Identified Problems

### 1. Stringly Typed Code

- **Resource Referencing**: Resources, stylesheets, fonts, and selectors are frequently tracked as raw `String` instances. `Target::Resource(String)` conflates element IDs, font family names, image paths, and CSS selectors into an opaque string, preventing downstream consumers from distinguishing target categories programmatically.
- **Media and MIME Types**: `Loaded::content_type` and `embed::media_type` rely on raw `String` matching (`"text/css"`, `"text/javascript"`, `"image/png"`). Missing or malformed MIME headers risk silent fallbacks or incorrect decoding branches.
- **Markers and Delimiters**: CSS rule isolation uses string markers (`__octavo`, `__octavo_keep_`) injected into the stylesheet stream and later recovered via string replacement, introducing fragility if user stylesheets contain matching substrings.
- **Library Signatures**: Runtime library detection matches hardcoded text signatures (`"Bootstrap v5"`, `"clipboard.js v"`) and filename prefixes (`"quarto-html-"`) directly inside script text.
- **CLI Error Propagation**: `crates/octavo-cli` passes errors across `read`, `write`, `prepare`, `run`, and `audit` as formatted `String` values (`Result<T, String>`), discarding structured error variants and root causes.

### 2. Boolean Options and Flags

- **Monolithic All-or-Nothing Switches**: `Options::subset_text_fonts: bool` enforces a document-wide binary policy. It does not permit per-face granularity (`Off`, `Auto`, `Force`), which is needed when certain dynamic fonts cannot be statically verified.
- **Binary Image Policies**: `Options::keep_png: bool` acts as a negative override rather than an explicit format strategy (`Preserve`, `LosslessWebp`, `Optimal`).
- **Function Parameter Proliferation**: Internal functions historically passed multiple boolean flags (`strip_licenses: bool`, `fetch: bool`, `collect: bool`, `inlinable: bool`, `text: bool`), muddying intent at call sites. While PR 111 addressed internal parser flags, public `Options` remains heavily reliant on loose booleans.

### 3. Error Types and Failure Handling

- **Under-specified Public Errors**: `octavo::Error` contains only two variants: `NotHtml` and `NotSelfContained(Vec<Url>)`.
- **Silent Degradation**: Critical stage operations (font subsetting errors, image decoding failures, invalid CSS constructs, packing issues) silently swallow errors or fall back to original bytes without reporting structured diagnostics or warnings.
- **Missing Diagnostic Granularity**: `embed_resources` returns an `Embedded` struct without error channels. If a resource fails to parse or decode, the host receives no structured diagnostic indicating why the resource was skipped.
- **CLI Exit Classification**: Because CLI errors are collapsed to strings, exit codes cannot differentiate between input validation errors, network failures, I/O permissions, and unrecoverable internal failures.

### 4. Options and Mode API

- **Coupled Dimensions in `Mode`**: `Mode` (`Serve`, `Portable`, `Archive`) conflates three orthogonal concerns:
  1. *Packaging*: plain HTML elements, compressed script blocks, or single packed bootstrap blob.
  2. *Effort*: compression speed versus ratio trade-offs.
  3. *Evidence/Risk*: strictly verified semantics-preserving transforms versus generator-specific heuristic pruning.
- **Misleading Safety Invariant**: `Mode::Serve` implies conservative execution, yet `simplify` executes aggressive Quarto 1 dead-code removal, font subsetting, and CSS pruning before `pack` is called. The safety profile is dictated by `simplify`, not `Mode`.
- **Monolithic `Options`**: `Options` mixes execution tuning (`woff2_quality`, `png_preset`, `brotli_quality`), host caching paths (`cache_directory: Option<PathBuf>`), and document transformation policies into a single struct.

### 5. Report Types and Audit Traceability

- **Incomplete Transformation Metadata**: `Applied` captures `(transform, target, before, after)`. It lacks the authorizing rule identifier, stage attribution, and evidence category (proven vs heuristic vs generator-specific).
- **Distorted Metrics**: When static fonts are retained whole to avoid rendering divergences, a synthetic `Transform::FontKeptWhole` entry is added to `Applied` with `before == after`. This artificially inflates applied transformation counts while representing an untouched resource.
- **Skipped Edit Attribution**: `Skipped` records the losing and winning `Transform`, but omits byte spans, target details, and specific conflict reasons.
- **Unstructured Audit Output**: CLI auditing produces human-oriented terminal text without a structured JSON or machine-readable export suitable for CI regression tracking or external tool consumption.

### 6. I/O Boundaries and Host Coupling

- **Filesystem Dependencies in Core**: `cache.rs` performs filesystem operations (`fs::create_dir_all`, `fs::write`, `fs::read`, `fs::rename`) and path resolution directly inside `octavo`. This prevents the library from compiling to pure WASM or running in sandboxed, read-only host environments.
- **Global Concurrency Assumptions**: Multi-threading is achieved by calling `rayon::join` and `par_iter` directly on Rayon's global thread pool. The library provides no mechanism for an embedding host to inject its own executor, bound worker counts locally, or execute deterministically on a single thread.
- **Path Confinement and Traversal**: `embed::Resources` relies on string references. Without strict resource root validation, relative references such as `../../etc/passwd` risk escaping intended directory boundaries during offline resolution.
- **Site Optimization Entanglement**: Directory traversal, cross-document analysis, asset rewriting, and file system writes were historically executed in an intertwined loop rather than staged in-memory.

---

## Target Design

```
+-------------------------------------------------------------------+
|                        Embedding Host / CLI                       |
|  - CLI Parser / Config        - DiskCache (impl Cache)            |
|  - FsResourceLoader           - Concurrency Pool / Runner         |
+---------------------------------+---------------------------------+
                                  |
                        Options / Interfaces
                                  |
+---------------------------------v---------------------------------+
|                       octavo (Pure Library)                       |
|                                                                   |
|   +-------------------+  +-------------------+  +---------------+ |
|   |    Packaging      |  |      Effort       |  |   Evidence    | |
|   |  Plain | Scripts  |  | Fast | Balanced   |  | Exact/Proven  | |
|   |     | Packed      |  |    | Maximum      |  | Generic | Q1  | |
|   +-------------------+  +-------------------+  +---------------+ |
|                                                                   |
|   +-------------------------------------------------------------+ |
|   |                      Document Pipeline                      | |
|   |  Scan -> Rules/Transforms -> Transaction Log (Edits)        | |
|   +-------------------------------------------------------------+ |
|                                                                   |
|   +-------------------------------------------------------------+ |
|   |                       Audit & Reports                       | |
|   |  Applied (Rule, Evidence, Target, Delta)                    | |
|   |  Skipped (Candidate, Winner, Span, Reason)                  | |
|   |  Coverage (Font Faces: Auto | Force | Off)                  | |
|   +-------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### 1. Host-Neutral Core Architecture

- **Zero Host I/O**: `crates/octavo` performs no filesystem calls, network requests, environment variable inspection, or clock access.
- **Pluggable Cache Trait**:
  ```rust
  pub trait Cache: Send + Sync {
      fn get(&self, key: &str) -> Option<Vec<u8>>;
      fn set(&self, key: &str, data: &[u8]);
  }
  ```
  The CLI provides `DiskCache`, while in-memory, distributed, or no-op implementations can be supplied by alternative hosts.
- **Root-Confined Resource Loading**:
  ```rust
  pub trait ResourceLoader {
      fn load(&self, reference: &ResourceRef) -> Result<ResourceData, ResourceError>;
  }
  ```
  Resolutions enforce sandbox containment against configured roots, preventing directory traversal.

### 2. Orthogonal Configuration Dimensions

Replace monolithic `Mode` and tangled `Options` with three orthogonal configurations:

1. **Packaging**: Controls output format representation:
   - `Packaging::Plain`: Unpacked HTML elements (styles and scripts stay in standard DOM tags).
   - `Packaging::Scripts`: Scripts compressed into embedded data payload; stylesheets remain standard CSS.
   - `Packaging::Packed`: Complete document resources (scripts, styles, SVG, images) compressed into a bootstrap loader blob.
2. **Effort**: Controls CPU time and compression thoroughness:
   - `Effort::Fast`: Quickest compression, lowest compressor levels.
   - `Effort::Balanced`: Default trade-off between execution speed and byte savings.
   - `Effort::Maximum`: Exhaustive search, highest Brotli/oxipng settings.
3. **Evidence**: Dictates authorization for transformations:
   - `Evidence::Exact`: Only transformations verified by formal equality or translation validation (JS token stream equivalence, whitespace proofs).
   - `Evidence::Generic`: Standards-compliant optimizations safe for any HTML5 document (CSS selector reachability, lossless image recompression).
   - `Evidence::Quarto1`: Heuristic optimizations tailored to Quarto 1 output (pruning unused Bootstrap, Tippy, Popper, ClipboardJS, and search indexes).

`Mode` is retained as a non-breaking preset mapping to canonical combinations of Packaging, Effort, and Evidence.

### 3. Strongly Typed Domain Models

- **Target Specialization**:
  ```rust
  #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
  pub enum Target {
      Library(Library),
      Stylesheet(ResourceRef),
      Script(ResourceRef),
      Font(FontRef),
      Image(ResourceRef),
      Resources(NonZeroUsize),
  }
  ```
- **Font Policy per Face**:
  ```rust
  #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
  pub enum FontPolicy {
      #[default]
      Auto,
      Force,
      Off,
  }
  ```
- **Image Policy**:
  ```rust
  #[derive(Clone, Debug, PartialEq, Eq)]
  pub enum ImageOptimization {
      Lossless,
      KeepOriginal,
      Lossy(ImageEncoding),
  }
  ```

### 4. Comprehensive Error and Diagnostic Reporting

- Expand `octavo::Error` to capture specific operational failures:
  ```rust
  #[derive(Clone, Debug, PartialEq, Eq)]
  #[non_exhaustive]
  pub enum Error {
      NotHtml,
      NotSelfContained(Vec<Url>),
      InvalidEncoding(String),
      ResourceResolutionFailed(String),
      TransformFailed { rule: String, detail: String },
  }
  ```
- Detailed Warning and Audit types capturing rule IDs, evidence classifications, and byte reconciliations:
  - `Applied::rule`: Identifier of the rule that produced the edit.
  - `Applied::evidence`: `EvidenceClass` authorizing the transformation.
  - `Skipped::reason`: Detailed collision cause (overlapping byte range with higher-priority rule).

---

## Migration Steps as Small Mergeable PRs

The migration is sequenced into targeted, reviewable pull requests aligned with Issue #40. Each step maintains passing tests, identical output bytes on existing fixtures, and clean clippy/fmt verification.

```
Step 3 (First Slice): Independent Packaging, Effort, Evidence settings & Audit Records with Rule/EvidenceClass
  │
Step 4: Generator Isolation - Explicit Quarto 1 Profile from Generator Tag
  │
Step 5: Resource Confinement - Root Sandboxing, <base> href & Module Script Support
  │
Step 6: Site Mode - In-Memory Site Planning, Reference Verification & Staged Promotion
  │
Step 7: Host Neutrality - Pluggable Cache Trait in Core, DiskCache in CLI, Configurable Threads
  │
Step 8: Font Optimization - Per-Face Coverage Reports and Explicit Policy (Off, Auto, Force)
  │
Step 9: CLI Unification - Coherent CLI Flags, Comprehensive Error Taxonomy & Exit Codes
```

### Step 3 (First Slice): Independent Packaging, Effort, and Evidence Settings & Audit Records
- **Scope**:
  - Introduce orthogonal configuration enums: `Packaging` (`Plain`, `Scripts`, `Packed`), `Effort` (`Fast`, `Balanced`, `Maximum`), and `EvidenceClass` (`Exact`, `Generic`, `Quarto1`).
  - Introduce `Rule` identifying specific transformation rules (`QuartoDeadLibrary`, `ScriptMinified`, `StylesheetPruned`, `PngRecompressed`, `ImageReencoded`, `FontKeptWhole`, `PackResources`).
  - Map `Mode` to `Packaging` as a non-breaking convenience preset.
  - Enrich `Applied` with `rule: Rule` and `evidence: EvidenceClass`.
  - Enrich `Skipped` with `rule: Rule` and `evidence: EvidenceClass`.
  - Add `Simplified::package(&self, packaging: Packaging) -> Output` alongside `pack(&self, mode: Mode)`.
  - Update CLI audit to display rule and evidence classifications.
- **Verification**: Zero byte diff across all tests and fixtures; delta accounting remains exact; all doc-tests and unit tests pass.

### Step 4: Generator Isolation - Explicit Profile for Quarto 1
- **Scope**:
  - Check `<meta name="generator" content="quarto-...">` to detect Quarto 1 inputs automatically.
  - Gate `quarto.rs` library removal and word-index pruning behind `EvidenceClass::Quarto1`.
  - Documents without Quarto metadata run with generic rules unless explicitly configured.
- **Verification**: Quarto fixtures optimize identically; arbitrary HTML5 fixtures are not modified by Quarto-specific heuristics.

### Step 5: Resource Abstraction and Path Confinement
- **Scope**:
  - Enhance `Resources` trait with root-confinement validation to prevent path traversal outside document boundaries.
  - Implement `<base href>` handling and `type="module"` script reference resolution.
  - Reject paths attempting directory traversal outside configured roots.
- **Verification**: Resource loading tests pass; path traversal rejection tests pass.

### Step 6: Site Mode - In-Memory Staged Promotion
- **Scope**:
  - Decouple directory walk, cross-document asset analysis, optimization planning, and file writing.
  - Plan entire site in memory, write to staging area, verify internal links, and atomically promote.
- **Verification**: Site mode tests pass without in-place corruption on failure.

### Step 7: Host Neutrality - Pluggable Cache Trait and Thread Concurrency
- **Scope**:
  - Define `pub trait Cache` in `crates/octavo/src/cache.rs`.
  - Move filesystem reading/writing logic (`DiskCache`) into `crates/octavo-cli`.
  - Pass thread count and cache implementation through `Options` rather than relying on global process state.
- **Verification**: Font caching continues working identically in CLI; library contains no direct filesystem dependencies.

### Step 8: Font Optimization - Per-Face Coverage and Policies
- **Scope**:
  - Introduce `FontPolicy` (`Auto`, `Force`, `Off`) per font face.
  - Replace synthetic `FontKeptWhole` applied record with a first-class font coverage report.
  - Audit exposes which glyph ranges were kept and why faces were retained whole.
- **Verification**: Font subsetting output bytes remain identical across corpus fixtures.

### Step 9: CLI Unification - Coherent Flags, Error Taxonomy, and Exit Codes
- **Scope**:
  - Unify CLI argument parsing around orthogonal settings (`--packaging`, `--effort`, `--evidence`).
  - Expand `octavo::Error` to capture specific operational failures (`InvalidEncoding`, `ResourceResolutionFailed`, `TransformFailed`).
  - Replace `Result<T, String>` in CLI with structured CLI error types and distinct exit codes.
- **Verification**: CLI integration tests pass with structured diagnostics and reliable exit codes.

---

## Slice 1 Implementation Plan

The first implementation slice executes **Step 3**:
1. Adds `Packaging`, `Effort`, `EvidenceClass`, and `Rule` to `crates/octavo`.
2. Connects `Mode` as a non-breaking preset over `Packaging`.
3. Adds `package(&self, packaging: Packaging) -> Output` and `package_checked` to `Simplified`.
4. Extends `Applied` and `Skipped` with `rule` and `evidence` fields.
5. Updates internal stages (`doc.rs`, `css.rs`, `js.rs`, `images.rs`, `quarto.rs`) to track authorizing rules.
6. Updates `crates/octavo-cli` audit display to show evidence class.
7. Adds comprehensive unit, doc, and integration tests for the new types and audit fields without modifying any output bytes.
