# Quarto post-render adapter

`octavo-post-render.ts` runs Octavo on every HTML file a Quarto project writes. Quarto runs it with its bundled Deno, so nothing else needs installing besides `octavo` on `PATH`.

Add it to `_quarto.yml`:

```yaml
project:
  post-render: octavo-post-render.ts

format:
  html:
    embed-resources: true
```

Octavo needs self-contained pages, so `embed-resources: true` is required. Each page is optimized on its own. A file that Octavo rejects, such as a page that still links to files in `site_libs`, is left exactly as Quarto wrote it.

| Environment variable | Values | Default |
|---|---|---|
| `OCTAVO_LEVEL` | `safe`, `scripts` or `packed` | `packed` |
