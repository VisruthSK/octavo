import { repeat } from "./common.mjs";

const rule = (selector, body) => `${selector}{${body}}`;

export const bootstrapCss = ({ density = 1 } = {}) => {
  const columns = 12;
  const grid = [];
  for (let column = 1; column <= columns; column += 1) {
    const width = ((column / columns) * 100).toFixed(6).replace(/\.?0+$/, "");
    grid.push(rule(`.col-${column}`, `flex:0 0 auto;width:${width}%`));
    grid.push(rule(`.col-md-${column}`, `flex:0 0 auto;width:${width}%`));
    grid.push(rule(`.col-lg-${column}`, `flex:0 0 auto;width:${width}%`));
    grid.push(rule(`.col-xl-${column}`, `flex:0 0 auto;width:${width}%`));
    grid.push(rule(`.col-sm-${column}`, `flex:0 0 auto;width:${width}%`));
    grid.push(rule(`.offset-${column}`, `margin-left:${width}%`));
  }
  const spacing = [];
  for (let step = 0; step <= 5 * density; step += 1) {
    const value = step * 0.5;
    for (const side of ["top", "bottom", "start", "end", "x", "y"]) {
      spacing.push(rule(`.m${side}-${step}`, `margin-${side}:${value}rem!important`));
      spacing.push(rule(`.p${side}-${step}`, `padding-${side}:${value}rem!important`));
    }
  }
  const colors = ["primary", "secondary", "success", "danger", "warning", "info", "light", "dark"];
  const variants = [];
  for (const color of colors) {
    variants.push(rule(`.btn-${color}`, `color:#fff;background-color:var(--bs-${color});border-color:var(--bs-${color})`));
    variants.push(rule(`.bg-${color}`, `background-color:var(--bs-${color})!important`));
    variants.push(rule(`.text-${color}`, `color:var(--bs-${color})!important`));
    variants.push(rule(`.btn-outline-${color}`, `color:var(--bs-${color});border-color:var(--bs-${color})`));
    variants.push(rule(`.alert-${color}`, `color:var(--bs-${color});border-color:var(--bs-${color})`));
  }
  const display = [];
  for (const mode of ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"]) {
    display.push(rule(`.d-${mode}`, `display:${mode}!important`));
  }
  const sizes = [];
  for (let step = 1; step <= 6 * density; step += 1) {
    sizes.push(rule(`.fs-${step}`, `font-size:${(0.75 + step * 0.1).toFixed(2)}rem!important`));
    sizes.push(rule(`.lh-${step}`, `line-height:${(1 + step * 0.1).toFixed(2)}!important`));
    sizes.push(rule(`.gap-${step}`, `gap:${step * 0.25}rem!important`));
  }
  for (const weight of ["light", "normal", "medium", "bold", "bolder"]) {
    sizes.push(rule(`.fw-${weight}`, `font-weight:${weight}!important`));
  }
  for (const size of ["25", "50", "75", "100", "auto"]) {
    sizes.push(rule(`.w-${size}`, `width:${size}%!important`));
    sizes.push(rule(`.h-${size}`, `height:${size}%!important`));
  }
  for (const placement of ["static", "relative", "absolute", "fixed", "sticky"]) {
    sizes.push(rule(`.position-${placement}`, `position:${placement}!important`));
  }
  for (const overflow of ["auto", "hidden", "visible", "scroll"]) {
    sizes.push(rule(`.overflow-${overflow}`, `overflow:${overflow}!important`));
  }
  for (const radius of ["0", "1", "2", "3", "4", "5"]) {
    sizes.push(rule(`.rounded-${radius}`, `border-radius:${radius * 0.25}rem!important`));
  }
  return [
    rule(":root", "--bs-blue:#0d6efd;--bs-indigo:#6610f2;--bs-body-font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif"),
    rule("*,*::before,*::after", "box-sizing:border-box"),
    rule("html", "-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent"),
    rule("body", "margin:0;font-family:var(--bs-body-font-family);font-size:1rem;line-height:1.5;color:#212529;background-color:#fff"),
    rule("h1,h2,h3,h4,h5,h6", "margin-top:0;margin-bottom:.5rem;font-weight:500;line-height:1.2"),
    rule("h1", "font-size:2.25rem"), rule("h2", "font-size:1.8rem"), rule("h3", "font-size:1.5rem"),
    rule("h4", "font-size:1.2rem"), rule("h5", "font-size:1rem"), rule("h6", "font-size:.85rem"),
    rule("p", "margin-top:0;margin-bottom:1rem"),
    rule("a", "color:#0d6efd;text-decoration:underline"),
    rule("a:hover", "color:#0a58ca"),
    rule("hr", "margin:1rem 0;border:0;border-top:1px solid #dee2e6"),
    rule("pre", "display:block;font-size:.875em;color:#212529;word-wrap:normal;white-space:pre;margin:0"),
    rule("code,kbd,pre,samp", "font-family:var(--bs-font-monospace);font-size:1em"),
    rule("img,svg", "vertical-align:middle"),
    rule("table", "caption-side:bottom;border-collapse:collapse"),
    rule("th,td", "padding:.5rem;vertical-align:top;border-top:1px solid #dee2e6"),
    rule("thead th", "vertical-align:bottom;border-bottom:2px solid #dee2e6"),
    rule(".container,.container-fluid,.container-sm,.container-md,.container-lg", "width:100%;padding-right:.75rem;padding-left:.75rem;margin-right:auto;margin-left:auto"),
    rule(".row", "display:flex;flex-wrap:wrap;margin-right:-.75rem;margin-left:-.75rem"),
    ...grid,
    ...spacing,
    ...variants,
    ...display,
    ...sizes,
    rule(".btn", "display:inline-block;padding:.375rem .75rem;font-size:1rem;line-height:1.5;border-radius:.25rem;text-align:center;vertical-align:middle;cursor:pointer;user-select:none;border:1px solid transparent"),
    rule(".btn:hover", "filter:brightness(.94)"),
    rule(".btn-sm", "padding:.25rem .5rem;font-size:.875rem;border-radius:.2rem"),
    rule(".btn-lg", "padding:.5rem 1rem;font-size:1.25rem;border-radius:.3rem"),
    rule(".card", "position:relative;display:flex;flex-direction:column;min-width:0;word-wrap:break-word;background-color:#fff;background-clip:border-box;border:1px solid rgba(0,0,0,.175);border-radius:.375rem"),
    rule(".card-body", "flex:1 1 auto;padding:1rem"),
    rule(".card-title", "margin-bottom:.5rem"),
    rule(".card-subtitle", "margin-top:-.25rem;margin-bottom:0"),
    rule(".card-header", "padding:.5rem 1rem;margin-bottom:0;background-color:rgba(0,0,0,.03);border-bottom:1px solid rgba(0,0,0,.175)"),
    rule(".card-footer", "padding:.5rem 1rem;background-color:rgba(0,0,0,.03);border-top:1px solid rgba(0,0,0,.175)"),
    rule(".alert", "position:relative;padding:1rem;margin-bottom:1rem;border:1px solid transparent;border-radius:.375rem"),
    rule(".alert-heading", "color:inherit"),
    rule(".badge", "display:inline-block;padding:.35em .65em;font-size:.75em;font-weight:700;line-height:1;color:#fff;text-align:center;white-space:nowrap;vertical-align:baseline;border-radius:.375rem"),
    rule(".navbar", "position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:.5rem 1rem"),
    rule(".navbar-brand", "padding-top:.3125rem;padding-bottom:.3125rem;margin-right:1rem;font-size:1.25rem;text-decoration:none;white-space:nowrap"),
    rule(".navbar-nav", "display:flex;flex-direction:column;padding-left:0;margin-bottom:0;list-style:none"),
    rule(".nav", "display:flex;flex-wrap:wrap;padding-left:0;margin-bottom:0;list-style:none"),
    rule(".nav-link", "display:block;padding:.5rem 1rem;color:#0d6efd;text-decoration:none;background:none;border:0;cursor:pointer"),
    rule(".dropdown-menu", "position:absolute;z-index:1000;display:none;min-width:10rem;padding:.5rem 0;margin:0;font-size:1rem;color:#212529;text-align:left;list-style:none;background-color:#fff;border:1px solid rgba(0,0,0,.15);border-radius:.375rem"),
    rule(".dropdown-menu.show", "display:block"),
    rule(".dropdown-item", "display:block;width:100%;padding:.25rem 1rem;clear:both;font-weight:400;color:#212529;text-align:inherit;text-decoration:none;white-space:nowrap;background-color:transparent;border:0"),
    rule(".modal", "position:fixed;top:0;left:0;z-index:1055;display:none;width:100%;height:100%;overflow-x:hidden;overflow-y:auto;outline:0"),
    rule(".modal.show", "display:block"),
    rule(".modal-dialog", "position:relative;width:auto;margin:.5rem;pointer-events:none"),
    rule(".modal-content", "position:relative;display:flex;flex-direction:column;width:100%;pointer-events:auto;background-color:#fff;border:1px solid rgba(0,0,0,.2);border-radius:.5rem"),
    rule(".modal-header", "display:flex;flex-shrink:0;align-items:center;justify-content:space-between;padding:1rem;border-bottom:1px solid #dee2e6"),
    rule(".modal-body", "position:relative;flex:1 1 auto;padding:1rem"),
    rule(".modal-footer", "display:flex;flex-wrap:wrap;flex-shrink:0;align-items:center;justify-content:flex-end;padding:.75rem;border-top:1px solid #dee2e6"),
    rule(".tooltip", "position:absolute;z-index:1080;display:block;margin:0;font-family:inherit;font-style:normal;font-weight:400;line-height:1.5;text-align:left;text-align:start;text-decoration:none;text-shadow:none;text-transform:none;letter-spacing:normal;word-break:normal;word-spacing:normal;white-space:normal;opacity:0"),
    rule(".tooltip.show", "opacity:.9"),
    rule(".popover", "position:absolute;top:0;left:0;z-index:1070;display:block;max-width:276px;font-family:inherit;font-size:1rem;font-style:normal;font-weight:400;line-height:1.5;text-align:left;text-align:start;text-decoration:none;text-shadow:none;text-transform:none;letter-spacing:normal;word-break:normal;word-spacing:normal;white-space:normal;background-color:#fff;border:1px solid rgba(0,0,0,.2);border-radius:.375rem"),
    rule(".accordion-button", "position:relative;display:flex;align-items:center;width:100%;padding:1rem 1.25rem;font-size:1rem;color:#212529;text-align:left;background-color:#fff;border:0;overflow-anchor:auto"),
    rule(".accordion-body", "padding:1rem 1.25rem"),
    rule(".list-group", "display:flex;flex-direction:column;padding-left:0;margin-bottom:0;border-radius:.375rem"),
    rule(".list-group-item", "position:relative;display:block;padding:.5rem 1rem;color:#212529;text-decoration:none;background-color:#fff;border:1px solid rgba(0,0,0,.125)"),
    rule(".pagination", "display:flex;padding-left:0;margin-bottom:0;list-style:none"),
    rule(".page-link", "position:relative;display:block;padding:.375rem .75rem;color:#0d6efd;text-decoration:none;background-color:#fff;border:1px solid #dee2e6"),
    rule(".spinner-border", "display:inline-block;width:2rem;height:2rem;vertical-align:-.125em;border:.25em solid currentColor;border-right-color:transparent;border-radius:50%;animation:.75s linear infinite spinner-border"),
    rule(".form-control", "display:block;width:100%;padding:.375rem .75rem;font-size:1rem;font-weight:400;line-height:1.5;color:#212529;background-color:#fff;border:1px solid #ced4da;border-radius:.375rem"),
    rule(".form-select", "display:block;width:100%;padding:.375rem 2.25rem .375rem .75rem;border:1px solid #ced4da;border-radius:.375rem"),
    rule(".form-label", "margin-bottom:.5rem"),
    rule(".input-group", "position:relative;display:flex;flex-wrap:wrap;align-items:stretch;width:100%"),
    rule(".table", "width:100%;margin-bottom:1rem;color:#212529;vertical-align:top;border-color:#dee2e6"),
    rule(".table>thead", "vertical-align:inherit;border-color:#dee2e6"),
    rule(".table-striped>tbody>tr:nth-of-type(odd)>*", "--bs-table-accent-bg:rgba(0,0,0,.05)"),
    rule(".visually-hidden", "position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important"),
    rule("[data-bs-theme=dark]", "--bs-body-color:#dee2e6;--bs-body-bg:#212529"),
  ].join("\n");
};

export const quartoCss = ({ theme = "cosmo" } = {}) => {
  const palettes = {
    cosmo: ["#2980b9", "#2c3e50", "#f7f7f7", "#333333"],
    darkly: ["#375e7d", "#303030", "#222222", "#dddddd"],
    flatly: ["#2c3e50", "#e74c3c", "#f8f9fa", "#212529"],
  };
  const [primary, dark, light, text] = palettes[theme] ?? palettes.cosmo;
  return [
    rule(":root", `--bs-primary:${primary};--quarto-body-bg:${light};--quarto-body-color:${text}`),
    rule(".quarto-title-block", "display:flex;flex-direction:column;margin-bottom:1.25rem"),
    rule(".quarto-title", "font-size:2.25rem;font-weight:700;margin-bottom:.5rem"),
    rule(".quarto-subtitle", "font-size:1.25rem;color:#6c757d;margin-bottom:1rem"),
    rule(".quarto-title-meta", "font-size:.9rem;color:#6c757d;margin-bottom:1.5rem"),
    rule("main.content", "padding-top:1rem;padding-bottom:2rem;max-width:100%"),
    rule("article.quarto-article", "padding:1rem 2rem 2rem 2rem;max-width:100%"),
    rule(".quarto-header", "background-color:${dark};color:#fff;padding:.5rem 1rem"),
    rule(".quarto-header a", "color:#fff;text-decoration:none"),
    rule(".quarto-sidebar", "position:fixed;top:0;left:0;bottom:0;width:250px;padding:1rem;overflow-y:auto;background-color:#f1f1f1"),
    rule(".quarto-sidebar .quarto-margin-sidebar", "margin-top:1rem;font-size:.9rem"),
    rule(".quarto-document-content", "margin-left:0;padding-top:0"),
    rule("nav.anchored .anchored", "position:relative;color:#6c757d;text-decoration:none"),
    rule("nav.anchored .anchored:hover", "color:${primary}"),
    rule(".cell", "margin-bottom:1rem"),
    rule(".cell-output", "margin-bottom:1rem"),
    rule(".cell-output pre", "background-color:#f7f7f7;padding:.75rem;border-radius:.25rem;overflow-x:auto"),
    rule(".cell-output img", "max-width:100%;height:auto"),
    rule(".sourceCode", "font-size:.85rem;line-height:1.4"),
    rule("pre.sourceCode", "background-color:#f7f7f7;padding:.75rem;border-radius:.25rem"),
    rule("code.sourceCode", "font-family:var(--bs-font-monospace)"),
    rule(".quarto-code-cell", "margin-bottom:1rem"),
    rule(".quarto-code-cell .cell-code", "position:relative"),
    rule(".callout", "margin-bottom:1rem;border-radius:.25rem;padding:1rem;border-left:.25rem solid ${primary}"),
    rule(".callout-title", "font-weight:700;margin-bottom:.25rem"),
    rule(".callout-note", "border-left-color:#3c8dbc"),
    rule(".callout-warning", "border-left-color:#e8b317"),
    rule(".callout-important", "border-left-color:#e83e3e"),
    rule(".panel-tabset", "margin-bottom:1rem"),
    rule(".panel-tabset .nav-tabs", "border-bottom:1px solid #dee2e6"),
    rule(".panel-tabset .tab-pane", "padding-top:.75rem"),
    rule(".footnotes", "font-size:.9rem;margin-top:2rem;border-top:1px solid #dee2e6"),
    rule(".footnote-ref", "font-size:.8em;vertical-align:super"),
    rule(".citation", "font-size:.9rem"),
    rule("figure", "margin-bottom:1rem"),
    rule("figure img", "max-width:100%"),
    rule("figcaption", "font-size:.85rem;color:#6c757d"),
    rule(".gt_table", "width:100%;border-collapse:collapse;font-size:.9rem"),
    rule(".gt_table th", "text-align:left;border-bottom:2px solid #dee2e6;padding:.4rem"),
    rule(".gt_table td", "border-bottom:1px solid #dee2e6;padding:.4rem"),
    rule(".gt_table .gt_row", "background-color:#f8f9fa"),
    rule(".dataTables_wrapper", "overflow-x:auto"),
    rule(".quarto-search", "display:none"),
    rule(".nav-page", "display:flex;justify-content:space-between;margin-top:2rem;padding-top:1rem;border-top:1px solid #dee2e6"),
    rule(".nav-page-title", "font-weight:700"),
    rule(".reveal", "font-family:system-ui,sans-serif"),
    rule(".reveal .slides", "text-align:left"),
    rule(".reveal h1", "font-size:2.5rem"),
    rule(".reveal .title", "font-size:1.75rem"),
    rule(".reveal .subtitle", "font-size:1.1rem;color:#6c757d"),
    rule(".reveal .section-title", "font-size:1.2rem;text-transform:uppercase;letter-spacing:.05em;color:#6c757d"),
    rule(".dashboard", "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem"),
    rule(".dashboard .card", "border-radius:.5rem;padding:1rem"),
    rule(".dashboard .value", "font-size:2rem;font-weight:700"),
    rule(".dashboard .label", "font-size:.85rem;color:#6c757d"),
    rule(".quarto-title-block .description", "color:#6c757d;font-size:1.05rem"),
    rule(".math.display", "display:block;text-align:center;margin:1rem 0}"),
  ].join("\n");
};

export const highlightCss = () =>
  [
    rule(".hljs", "display:block;overflow-x:auto;padding:.75rem;background:#f7f7f7;color:#24292e"),
    rule(".hljs-keyword,.hljs-selector-tag,.hljs-literal", "color:#d73a49"),
    rule(".hljs-string,.hljs-title,.hljs-name", "color:#032f62"),
    rule(".hljs-comment,.hljs-quote", "color:#6a737d;font-style:italic"),
    rule(".hljs-number,.hljs-symbol", "color:#005cc5"),
    rule(".hljs-attr,.hljs-attribute", "color:#6f42c1"),
    rule(".hljs-built_in,.hljs-type", "color:#e36209"),
    rule(".code-header", "font-family:var(--bs-font-monospace);font-size:.75rem;color:#6c757d;padding:.25rem .75rem;background:#eee"),
  ].join("\n");
