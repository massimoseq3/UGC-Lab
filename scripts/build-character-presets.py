#!/usr/bin/env python3
"""Builds the Characters starter-preset library from a folder of DNA exports.

Reads a folder of paired `<slug>.json` / `<slug>.jpeg` files — each JSON a
character's DNA in the app's own nested `jsonProfile` shape, each JPEG the
portrait that prompt produced — and writes:

  public/presets/library.json     one flat row per starter
  public/presets/thumbs/<id>.webp one card cover each
  public/presets/full/<id>.webp   one full-size portrait each

Same reasoning as `build-vault.py`: the starters are identical for every
member and read-only, so they ship as static files rather than as bank rows,
and the committed output is the source of truth (the source folder lives
outside the repo). Re-run it when the folder grows.

    python3 scripts/build-character-presets.py [source-folder]
"""

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "public" / "presets"
DEFAULT_SRC = Path.home() / "Downloads" / "download" / "_UGC-OS-Import"

# Two tiers, both measured on the LONG edge, and the split is the whole point.
#
# The cover started at 400 and came out 223x400: a picker card is ~155 CSS px
# wide, which is 310 device px on the 2x screens these are looked at on, so
# every face in the library was being upscaled from a picture smaller than the
# hole it sat in. It was reported as simply looking low quality. 900 covers the
# same card on a 3x screen with room over, at ~30KB.
#
# The portrait is the source's own 768x1376, so nothing is resampled. It stopped
# being only a picture in August 2026: saving a template to the Characters bank
# stores THIS file as the character's portrait, which is then the reference
# image every downstream app renders from. It is fetched only when a member
# actually saves one, which is why the card doesn't pay its ~100KB.
THUMB_PX = 900
THUMB_Q = 80
FULL_PX = 1376
FULL_Q = 85

# The curated scene facet. Keyed by the numeric prefix the source folder files
# each character under, because the profile's own `location` is free text —
# 43 distinct values across 78 characters — and makes no facet at all.
SETTINGS = {
    "01": "Handheld Mic",
    "02": "Car",
    "03": "Kitchen",
    "04": "Bedroom",
    "05": "Desk & Office",
    "06": "Outdoors",
    "07": "Gym",
    "08": "Bathroom GRWM",
    "09": "Podcast Studio",
    "10": "Holding Product",
    "11": "Talking Head",
}


def flatten(profile: dict) -> dict:
    """Nested `{Physical: {...}, Style: {...}}` → one flat field map.

    The app's form is flat (28 keys, no sections), so the sections are a
    grouping for the prompt writer's benefit only. Flattening here rather than
    at runtime keeps the picker's own code down to a lookup.
    """
    flat = {}
    for section in profile.values():
        if isinstance(section, dict):
            for key, value in section.items():
                if isinstance(value, str) and value.strip():
                    flat[key] = value.strip()
    return flat


def encode(src: Path, dest: Path, px: int, q: int) -> bool:
    """Puts a `px`-long-edge webp at `dest`. True if one is there afterwards."""
    if dest.exists():
        return True
    # sips resizes and hands PNG to cwebp — sips has no webp encoder and cwebp
    # no resampler. Same two-step as build-vault.py.
    tmp = dest.with_suffix(".png")
    subprocess.run(
        ["sips", "-Z", str(px), "-s", "format", "png", str(src), "--out", str(tmp)],
        capture_output=True,
    )
    if tmp.exists():
        subprocess.run(["cwebp", "-quiet", "-q", str(q), str(tmp), "-o", str(dest)], capture_output=True)
        tmp.unlink(missing_ok=True)
    return dest.exists()


def main() -> int:
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src_dir.is_dir():
        print(f"No source folder at {src_dir}", file=sys.stderr)
        return 1

    thumbs_dir = OUT / "thumbs"
    full_dir = OUT / "full"
    for d in (thumbs_dir, full_dir):
        d.mkdir(parents=True, exist_ok=True)

    rows, skipped = [], []
    for path in sorted(src_dir.glob("*.json")):
        stem = path.stem
        if stem == "MATCHES":
            continue
        # The source folder keeps a weaker second take of two characters,
        # suffixed __alt. A near-duplicate face is worth less in a picker than
        # the row it displaces, so the alternates don't ship.
        if stem.endswith("__alt"):
            skipped.append(f"{stem} (alternate take)")
            continue

        data = json.loads(path.read_text())
        image = src_dir / (data.get("image") or f"{stem}.jpeg")
        if not image.exists():
            skipped.append(f"{stem} (no image)")
            continue

        profile = flatten(data.get("jsonProfile") or {})
        if not profile.get("gender"):
            skipped.append(f"{stem} (no DNA)")
            continue
        # aspectRatio is a profile field in the app but sits outside jsonProfile
        # in the export, because it isn't part of the written prompt.
        profile["aspectRatio"] = data.get("aspectRatio") or "9:16"

        preset_id = re.sub(r"[^a-zA-Z0-9_-]", "_", stem)
        if not encode(image, thumbs_dir / f"{preset_id}.webp", THUMB_PX, THUMB_Q):
            skipped.append(f"{stem} (thumb failed)")
            continue
        if not encode(image, full_dir / f"{preset_id}.webp", FULL_PX, FULL_Q):
            skipped.append(f"{stem} (portrait failed)")
            continue

        rows.append({
            "id": preset_id,
            # The descriptive name the export carries ("Braided Blonde on the
            # Sofa"). It stops being the card's label below, but stays on the
            # row: it's the tooltip, and it's what a search for "braided"
            # matches.
            "title": data.get("name") or stem,
            "setting": SETTINGS.get(stem[:2], "Other"),
            "gender": profile["gender"],
            "shotType": profile.get("shotType", ""),
            "note": data.get("shotNote", ""),
            "profile": profile,
        })

    # Ordered by setting (the folder's own numbering), then Female before Male,
    # then by the source name — so the unfiltered grid reads as the shot list it
    # was shot as, and the numbering below is stable across re-runs.
    order = {label: n for n, label in enumerate(SETTINGS.values())}
    rows.sort(key=lambda r: (order.get(r["setting"], 99), r["gender"], r["title"]))

    # The card's label is what the picker is filtered BY — scene and gender —
    # numbered within its group. "Braided Blonde on the Sofa" describes the
    # picture you can already see; "Handheld Mic Female 1" tells you where it
    # sits in a library you are scanning by scene. The number is always there,
    # including on a group of one, so a row of cards reads as one series rather
    # than a mix of two naming schemes.
    seen: dict[tuple[str, str], int] = {}
    for row in rows:
        key = (row["setting"], row["gender"])
        seen[key] = seen.get(key, 0) + 1
        row["name"] = f"{row['setting']} {row['gender']} {seen[key]}"

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "library.json").write_text(json.dumps(rows, separators=(",", ":")))

    lib_kb = (OUT / "library.json").stat().st_size / 1024
    mb = lambda d: sum(f.stat().st_size for f in d.glob("*.webp")) / 1e6
    print(
        f"{len(rows)} presets → library.json ({lib_kb:.0f} KB), "
        f"{mb(thumbs_dir):.2f} MB of covers, {mb(full_dir):.2f} MB of portraits"
    )
    if skipped:
        print("skipped: " + ", ".join(skipped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
