"""Optimize bundled Doro WebP frames for desktop/web package size.

Resizes oversized 640x566 frames down to desktop-appropriate retina resolution
(default max width 320px -> 320x283, >2x the default 147px pet width and ~1.45x
the max 221px XL width), re-encodes as WebP (quality=80, method=5), and updates
the SHA-256 entries in channel/web/static/vendor/doro/manifest.json.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

DORO_ROOT = Path(__file__).resolve().parents[1] / "channel" / "web" / "static" / "vendor" / "doro"


def optimize_frame(
    root: Path,
    rel_path: str,
    max_width: int,
    quality: int,
    method: int,
) -> tuple[str, int, int, str]:
    target = root / rel_path
    orig_bytes = target.read_bytes()
    orig_size = len(orig_bytes)

    with Image.open(io.BytesIO(orig_bytes)) as im:
        im = im.convert("RGBA")
        w, h = im.size
        if w > max_width:
            new_h = max(1, round(h * (max_width / w)))
            im = im.resize((max_width, new_h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=quality, method=method)
        new_bytes = buf.getvalue()

    if len(new_bytes) < orig_size:
        target.write_bytes(new_bytes)
        final_bytes = new_bytes
    else:
        final_bytes = orig_bytes

    digest = hashlib.sha256(final_bytes).hexdigest()
    return rel_path, orig_size, len(final_bytes), digest


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimize bundled Doro WebP animation frames.")
    parser.add_argument("--max-width", type=int, default=320, help="Target max width in pixels (default: 320).")
    parser.add_argument("--quality", type=int, default=80, help="WebP quality 0-100 (default: 80).")
    parser.add_argument("--method", type=int, default=5, help="WebP compression effort 0-6 (default: 5).")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent worker threads (default: 8).")
    args = parser.parse_args()

    manifest_path = DORO_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tracks = manifest.get("tracks", {})
    frame_paths = [p for frames in tracks.values() for p in frames]

    orig_total = 0
    new_total = 0
    sha256_map = dict(manifest.get("sha256", {}))

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [
            pool.submit(optimize_frame, DORO_ROOT, rel_path, args.max_width, args.quality, args.method)
            for rel_path in frame_paths
        ]
        for fut in concurrent.futures.as_completed(futures):
            rel_path, before, after, digest = fut.result()
            orig_total += before
            new_total += after
            sha256_map[rel_path] = digest

    # Prune sha256 entries for any removed non-runtime files and refresh remaining metadata hashes.
    for key in list(sha256_map.keys()):
        target = DORO_ROOT / key
        if not target.exists():
            sha256_map.pop(key, None)
        elif key not in frame_paths:
            sha256_map[key] = hashlib.sha256(target.read_bytes()).hexdigest()

    # Keep deterministic key order in manifest.
    ordered_sha256 = {k: sha256_map[k] for k in sorted(sha256_map.keys())}
    manifest["sha256"] = ordered_sha256
    manifest["optimization"] = {
        "maxWidth": args.max_width,
        "quality": args.quality,
        "method": args.method,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    saved_mb = (orig_total - new_total) / (1024 * 1024)
    pct = (1 - new_total / orig_total) * 100 if orig_total else 0.0
    print(
        f"Optimized {len(frame_paths)} Doro frames: "
        f"{orig_total / (1024 * 1024):.2f} MB -> {new_total / (1024 * 1024):.2f} MB "
        f"(saved {saved_mb:.2f} MB, -{pct:.1f}%)"
    )


if __name__ == "__main__":
    main()
