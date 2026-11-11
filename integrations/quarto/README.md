# Quarto post-render adapter

Add to `_quarto.yml`:

```yaml
project:
  post-render: octavo-post-render.ts
```

`octavo` must be on `PATH`. Environment variables:

- `OCTAVO_LEVEL`: `safe`, `scripts` or `packed` (default `packed`).
- `OCTAVO_VERIFY`: command run per candidate, with `{original}` and `{optimized}` substituted; a non-zero exit steps down to the next less aggressive level and finally keeps the original.
