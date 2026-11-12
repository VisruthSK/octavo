import { fontFace } from "../fonts.mjs";
import { page, repeat } from "../spec.mjs";

const prices = repeat(
  12,
  (row) =>
    `<tr><td>Item ${row + 1}</td><td class="n">${(1111.11 * (row + 1)).toFixed(2)}</td><td class="n">${(row + 1) * 1000 + 111}</td></tr>`,
);

const pairs = "To Ta AV Te Yo Tw We LT PA VA Ty Wa Fo Ve Ky";

const documents = (name, family) => [
  {
    id: `fonts-${name}-tabular-numbers`,
    category: "fonts",
    tier: name === "fira-sans" ? "smoke" : "full",
    expect: { outcome: "optimizes", retains: ["Ledger of numbers"] },
    build: () =>
      page(
        `<style>${fontFace(name)}body{font-family:'${family}';font-size:18px}table{border-collapse:collapse}td{padding:2px 12px}.n{text-align:right;font-variant-numeric:tabular-nums}</style>`,
        `<h1>Ledger of numbers</h1><table>${prices}</table>`,
      ),
  },
  {
    id: `fonts-${name}-feature-settings`,
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["Stylistic alternates"] },
    build: () =>
      page(
        `<style>${fontFace(name)}body{font-family:'${family}';font-size:22px}.a{font-feature-settings:"ss01","ss02"}.b{font-feature-settings:"case","tnum"}.c{font-feature-settings:"frac","sups"}.d{font-feature-settings:"liga" 0,"calt" 0}</style>`,
        `<h1>Stylistic alternates</h1><p class="a">Stylistic set one and two: agility 0123456789</p><p class="b">Case sensitive forms (A-B) [x] {y} 1111 0000</p><p class="c">Fractions 1/2 3/4 7/8 and superscripts x2 m3</p><p class="d">Ligatures off: fi fl ffi ffl -> =&gt; ==</p>`,
      ),
  },
  {
    id: `fonts-${name}-small-caps-and-variants`,
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["Small caps and variants"] },
    build: () =>
      page(
        `<style>${fontFace(name)}body{font-family:'${family}';font-size:20px}.a{font-variant-caps:small-caps}.b{font-variant-caps:all-small-caps}.c{font-variant-numeric:oldstyle-nums proportional-nums}.d{font-variant-numeric:lining-nums slashed-zero}.e{font-variant-position:super}.f{font-kerning:none}</style>`,
        `<h1>Small caps and variants</h1><p class="a">Small caps for Headings and Names</p><p class="b">All small caps for Acronyms like HTML and CSS</p><p class="c">Old style numbers 1234567890 in 2026</p><p class="d">Lining and slashed zero 1234567890 0</p><p class="e">Superscript 123</p><p class="f">Kerning off: ${pairs}</p>`,
      ),
  },
];

export default [...documents("fira-sans", "Fira Sans"), ...documents("inter", "Inter")];
