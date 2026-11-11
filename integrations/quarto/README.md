# Quarto post-render adapter

Add to `_quarto.yml`:

```yaml
project:
  post-render: octavo-post-render.ts
```

`octavo` must be on `PATH`. Environment variables:

- `OCTAVO_LEVEL`: `safe`, `scripts` or `packed` (default `packed`).
