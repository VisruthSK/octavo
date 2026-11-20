# Exact Level: Next Expansion

Design note on candidate semantics-preserving transforms for `Mode::Exact`, their equivalence oracles, and implementation coverage.

## Scope and Equivalence Model

`Mode::Exact` requires every transform to be semantics-preserving by construction. Rewrites are admitted only when an independent equivalence oracle confirms that the rewritten content possesses identical semantic value according to the underlying specifications (WHATWG HTML, CSS Syntax and Values, ECMAScript, SVG, W3C WOFF2).

## Transform Inventory and Oracle Classification

| Transform Class | Operations | Equivalence Oracle | Oracle Type | Status |
|---|---|---|---|---|
| Base64 / data-URI re-encoding | Re-encode `data:` URL payloads canonically (`STANDARD` base64), eliminating internal whitespace, missing/extra padding, and non-canonical alphabet casing. | `oracle::Base64`: Decoded payload equality. | Round-trip serialization equality | Covered (E1) |
| Lossless CSS minification | CSS comment removal (`/* ... */`). | `oracle::Css`: Token stream equivalence modulo comments and formatting whitespace. | Parse-and-compare CSSOM equality | Covered (E5) |
| Lossless CSS minification | CSS zero-length unit stripping (`0px` -> `0`, `0em` -> `0`). Excludes `calc()`, custom properties, and time/angle/frequency units. | `oracle::Css`: Token stream equality with normalized zero-length dimension keys. | Parse-and-compare CSSOM equality | Covered in exact-next |
| Lossless CSS minification | CSS whitespace normalisation around structural tokens (`{`, `}`, `;`, `:`, `,`). | `oracle::Css`: Token stream equality with normalized space tokens. | Parse-and-compare CSSOM equality | Covered in exact-next |
| Lossless CSS minification | CSS number canonicalisation (`0.5` -> `.5`, `1.0` -> `1`, leading `+` removal) and hex colour shortening (`#aabbcc` -> `#abc`). | `oracle::Css`: Token stream equality with parsed numeric scales and 8-digit RGBA hex matching. | Parse-and-compare CSSOM equality | Covered in exact-next |
| Redundant default attribute removal | Removing `type="text/javascript"` on `<script>` and `type="text/css"` on `<style>`. | `oracle::DefaultAttr`: Tag attribute parsing and validation of default type omission per HTML5 spec §4.12.1 and §4.6.1. | Parse-and-compare DOM attribute equality | Covered in exact-next |
| Whitespace and attribute normalisation | HTML inter-element whitespace collapse and boolean attribute minimization. | DOM tree and computed inline box equality. | Parse-and-compare DOM equality | Uncovered (deferred: risk of inter-tag inline box whitespace shifts) |
| JS comment and whitespace removal | Removing JS comments and redundant whitespace outside literals/regexes in `<script>`. | AST equality via oxc parser. | Parse-and-compare AST equality | Uncovered (deferred: low byte payoff on corpus fixtures) |
| SVG path precision-preserving rewrites | Stripping redundant SVG path command letters and canonicalising coordinate numbers. | SVG path segment AST equality and rasterisation comparison. | Round-trip serialization equality | Uncovered (deferred: low frequency in fixture set) |
| Font subsetting | Stripping unreferenced glyphs from `@font-face`. | Visual glyph rendering comparisons. | Rendering comparison | Excluded (dynamic scripts can inject characters; not semantics-preserving by construction) |

## Selected Highest-Value Transforms

Measurements across the 320 fixtures in `corpus/.cache/docs` identified the three highest-value uncovered transforms:
1. CSS zero-length unit stripping: 10,926 bytes saved.
2. CSS whitespace normalisation: 3,369 bytes saved.
3. Redundant default attribute removal: 2,484 bytes saved.
