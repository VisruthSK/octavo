import base64
import io
import re
import subprocess
from pathlib import Path
from fontTools.ttLib import TTFont

def main():
    docs_dir = Path("corpus/.cache/docs")
    orig_path = docs_dir / "fonts-inter-feature-settings.html"
    if not orig_path.exists():
        orig_path = Path("corpus/.cache/rendered/fonts-inter-feature-settings.html")
    
    with open(orig_path, "r", encoding="utf-8") as f:
        orig_html = f.read()

    out_dir = Path("out/variants")
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(out_dir / "original.html", "w", encoding="utf-8") as f:
        f.write(orig_html)

    m_orig = re.search(r"data:font/ttf;base64,([A-Za-z0-9+/=]+)", orig_html)
    if not m_orig:
        raise ValueError("Could not find data:font/ttf in original HTML")
    orig_ttf_b64 = m_orig.group(1)
    orig_ttf_bytes = base64.b64decode(orig_ttf_b64)

    font_orig = TTFont(io.BytesIO(orig_ttf_bytes))
    font_orig.flavor = "woff2"
    buf = io.BytesIO()
    font_orig.save(buf)
    orig_woff2_bytes = buf.getvalue()
    orig_woff2_b64 = base64.b64encode(orig_woff2_bytes).decode("ascii")

    v_woff2_no_octavo = orig_html.replace(
        f"data:font/ttf;base64,{orig_ttf_b64}",
        f"data:font/woff2;base64,{orig_woff2_b64}"
    ).replace("format('truetype')", 'format("woff2")')
    with open(out_dir / "woff2-no-octavo.html", "w", encoding="utf-8") as f:
        f.write(v_woff2_no_octavo)

    octavo_bin = Path("target/release/octavo")
    if not octavo_bin.exists():
        octavo_bin = Path("target/release/octavo.exe")
    if not octavo_bin.exists():
        octavo_bin = Path("C:/Users/visru/Documents/Github/octavo-wt/_target-embp-rel/release/octavo.exe")

    octavo_subset_path = out_dir / "octavo-subset-woff2.html"
    octavo_whole_path = out_dir / "octavo-whole-woff2.html"

    subprocess.run([str(octavo_bin), str(out_dir / "original.html"), str(octavo_subset_path), "--level", "safe", "--no-cache"], check=True)
    subprocess.run([str(octavo_bin), str(out_dir / "original.html"), str(octavo_whole_path), "--level", "safe", "--no-subset-fonts", "--no-cache"], check=True)

    with open(octavo_subset_path, "r", encoding="utf-8") as f:
        octavo_subset_html = f.read()

    with open(octavo_whole_path, "r", encoding="utf-8") as f:
        octavo_whole_html = f.read()

    v_octavo_ttf = re.sub(
        r'url\(data:font/woff2;base64,[A-Za-z0-9+/=]+\)\s*format\(["\']woff2["\']\)',
        f'url(data:font/ttf;base64,{orig_ttf_b64}) format("truetype")',
        octavo_subset_html
    )
    with open(out_dir / "octavo-ttf.html", "w", encoding="utf-8") as f:
        f.write(v_octavo_ttf)

    m_opt = re.search(r"data:font/woff2;base64,([A-Za-z0-9+/=]+)", octavo_subset_html)
    opt_subset_woff2_b64 = m_opt.group(1)
    opt_subset_woff2_bytes = base64.b64decode(opt_subset_woff2_b64)

    font_sub = TTFont(io.BytesIO(opt_subset_woff2_bytes))
    font_sub.flavor = None
    buf_sub = io.BytesIO()
    font_sub.save(buf_sub)
    opt_subset_ttf_b64 = base64.b64encode(buf_sub.getvalue()).decode("ascii")

    v_octavo_subset_ttf = re.sub(
        r'url\(data:font/woff2;base64,[A-Za-z0-9+/=]+\)\s*format\(["\']woff2["\']\)',
        f'url(data:font/ttf;base64,{opt_subset_ttf_b64}) format("truetype")',
        octavo_subset_html
    )
    with open(out_dir / "octavo-subset-ttf.html", "w", encoding="utf-8") as f:
        f.write(v_octavo_subset_ttf)

    print("Prepared all variants in", out_dir)

if __name__ == "__main__":
    main()
