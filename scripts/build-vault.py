#!/usr/bin/env python3
"""Build the Outlier Vault's static payload from the 1000 Outliers corpus.

The vault is a curated, read-only library that ships WITH the app — same rows
for every member, no key needed to browse it — so its data is a static file
under public/ rather than anything in Postgres or R2. That is the whole reason
this is a build step and not a sync: the corpus only changes when Massimo
re-runs the harvest, and a static file costs nothing to serve and nothing to
operate.

Writes two things:
  public/vault/library.json     one JSON array, minified (~1.5MB, ~450KB gzipped)
  public/vault/thumbs/<id>.webp one 400px cover per row

Re-run it after adding rows to the corpus:

  python3 scripts/build-vault.py ["/path/to/1000 Outliers"]

Deliberately NOT emitted: the source's engagement total (likes + comments,
derivable), word_count, is_music, and the frame dimensions — every reel is 9:16
and the card letterboxes whatever it is handed. Each field below earns its place
on the card or in the detail modal.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SRC = Path.home() / "Documents" / "AI Shortcuts" / "1000 Outliers"
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "public" / "vault"

# Matches the source pipeline's own artifact build. 400px wide covers a ~260px
# card frame at 2x, and q58 webp lands each one around 10KB.
THUMB_PX = 400
THUMB_Q = 58


def sanitize_id(key: str) -> str:
    """A corpus key that is safe as a URL path segment.

    Most keys are Instagram shortcodes and pass through untouched. A handful
    are of the form `share:BANskzjs_f`, and a colon in a filename is a path
    separator's worth of trouble on the way to a CDN.
    """
    return "".join(c if (c.isalnum() or c in "-_") else "_" for c in key)


def build_thumb(src_dir: Path, cache_dir: Path, key: str, dest: Path) -> bool:
    """Puts a 400px webp cover at `dest`. True if one is there afterwards.

    Prefers the cache the source pipeline already built, so a re-run only pays
    for rows whose cover is genuinely new.
    """
    if dest.exists():
        return True

    cached = cache_dir / f"{key}.webp"
    if cached.exists():
        shutil.copyfile(cached, dest)
        return True

    jpg = src_dir / f"{key}.jpg"
    if not jpg.exists():
        return False

    # sips resizes and hands PNG to cwebp — the same two-step the source
    # pipeline uses, because sips has no webp encoder and cwebp no resampler.
    tmp = dest.with_suffix(".png")
    subprocess.run(
        ["sips", "-Z", str(THUMB_PX), "-s", "format", "png", str(jpg), "--out", str(tmp)],
        capture_output=True,
    )
    if tmp.exists():
        subprocess.run(
            ["cwebp", "-quiet", "-q", str(THUMB_Q), str(tmp), "-o", str(dest)],
            capture_output=True,
        )
        tmp.unlink(missing_ok=True)
    return dest.exists()


def main() -> int:
    src_root = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    corpus = src_root / "out" / "corpus.jsonl"
    if not corpus.exists():
        print(f"No corpus at {corpus}", file=sys.stderr)
        return 1

    thumbs_dir = OUT / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    rows = [json.loads(line) for line in corpus.open() if line.strip()]
    out_rows, no_thumb = [], []

    for r in rows:
        key = r["key"]
        vid = sanitize_id(key)
        has_thumb = build_thumb(
            src_root / "data" / "thumbs",
            src_root / "data" / f"thumbs_webp_{THUMB_PX}q{THUMB_Q}",
            key,
            thumbs_dir / f"{vid}.webp",
        )
        if not has_thumb:
            no_thumb.append(key)

        out_rows.append({
            "id": vid,
            "url": r["url"],
            "hook": r.get("hook") or "",
            "template": r.get("template") or "",
            "category": r.get("category") or "",
            "patterns": r.get("patterns") or [],
            "transcript": r.get("transcript") or "",
            "author": r.get("author") or "",
            "authorName": r.get("author_name") or "",
            "caption": r.get("caption") or "",
            # Unix seconds in the corpus; milliseconds everywhere in the app.
            "createdAt": (r.get("timestamp") or 0) * 1000,
            "likes": r.get("likes") or 0,
            "comments": r.get("comments") or 0,
            # engagement ÷ the set's median engagement — the number behind the
            # amber badge. Honest about its own denominator; see the vault's
            # service for how the copy says so.
            "multiple": r.get("outlier_score"),
            "percentile": r.get("engagement_percentile"),
            "hasThumb": has_thumb,
        })

    # Strongest first: the library's default order is the one that makes the
    # top of the grid worth reading, and every row already carries its rank.
    out_rows.sort(key=lambda r: r["multiple"] or 0, reverse=True)

    payload = OUT / "library.json"
    payload.write_text(json.dumps(out_rows, separators=(",", ":"), ensure_ascii=False))

    size = payload.stat().st_size
    thumb_bytes = sum(f.stat().st_size for f in thumbs_dir.glob("*.webp"))
    print(f"{len(out_rows)} rows → {payload.relative_to(REPO)} ({size/1e6:.2f} MB)")
    print(f"{len(list(thumbs_dir.glob('*.webp')))} thumbs → {thumb_bytes/1e6:.2f} MB")
    if no_thumb:
        print(f"no cover for {len(no_thumb)}: {', '.join(no_thumb[:10])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
