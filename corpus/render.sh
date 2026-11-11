#!/usr/bin/env bash
cd "$(dirname "$0")"
for split in train test; do
  mkdir -p "html/$split"
  for f in src/$split/*.qmd; do
    n=$(basename "$f" .qmd)
    if quarto render "$f" --output-dir "../../html/$split" >"html/$split/$n.log" 2>&1; then
      echo "ok   $split/$n"
    else
      echo "FAIL $split/$n"
    fi
  done
done
