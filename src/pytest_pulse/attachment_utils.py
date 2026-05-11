"""File attachment handling — copy artefacts into the pulse-report directory
and optionally compress images using Pillow (mirrors the JS compressAttachment helper)."""
from __future__ import annotations
import os
import re
import shutil
from pathlib import Path
from typing import Optional


def sanitize_name(name: str) -> str:
    """Replace path-unsafe characters with underscores."""
    return re.sub(r"[^a-zA-Z0-9_.\-]", "_", name)


def copy_attachment(
    src: str,
    dest_dir: str,
    index: int,
    timestamp: int,
    attachment_name: str,
) -> Optional[str]:
    """
    Copy *src* into *dest_dir* as ``{index}-{timestamp}-{safe_name}``.

    Returns the relative destination path (relative to ``dest_dir``'s parent
    directory, so callers can store it in the JSON report), or ``None`` on failure.
    """
    if not os.path.exists(src):
        return None

    os.makedirs(dest_dir, exist_ok=True)
    safe_name = sanitize_name(os.path.basename(attachment_name))
    unique_name = f"{index}-{timestamp}-{safe_name}"
    dest_path = os.path.join(dest_dir, unique_name)

    try:
        shutil.copy2(src, dest_path)
        _try_compress(dest_path)
        return dest_path
    except Exception as exc:
        print(f"PulseReport: failed to copy attachment {src!r}: {exc}")
        return None


def _try_compress(path: str) -> None:
    """In-place image compression using Pillow when available."""
    try:
        from PIL import Image
    except ImportError:
        return  # Pillow not installed — skip compression

    lower = path.lower()
    if not any(lower.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif")):
        return

    try:
        img = Image.open(path)
        original_size = os.path.getsize(path)

        if lower.endswith(".png"):
            img.save(path, "PNG", optimize=True, compress_level=9)
        elif lower.endswith((".jpg", ".jpeg")):
            img.save(path, "JPEG", quality=75, optimize=True)
        elif lower.endswith(".webp"):
            img.save(path, "WEBP", quality=75)
        else:
            img.save(path, optimize=True)

        if os.path.getsize(path) >= original_size:
            # Compression made it larger — restore from the original copy
            img.save(path)
    except Exception:
        pass


def find_playwright_artifacts(
    pw_output_dir: str,
    node_id: str,
    browser_name: str = "",
) -> dict:
    """
    Scan pytest-playwright's output directory for artefacts belonging to
    *node_id*.  Returns a dict with keys ``screenshots``, ``videos``,
    ``trace``.

    pytest-playwright names the test folder like:
        {file_stem}-{test_name}-{browser}
    but the exact naming varies by version, so we do a fuzzy scan.
    """
    result = {"screenshots": [], "videos": [], "trace": None}

    if not pw_output_dir or not os.path.isdir(pw_output_dir):
        return result

    # Build candidate folder-name fragments from nodeid
    fragments = _nodeid_fragments(node_id, browser_name)

    try:
        for entry in os.scandir(pw_output_dir):
            if not entry.is_dir():
                continue
            folder_lower = entry.name.lower()
            if any(f in folder_lower for f in fragments):
                _collect_from_folder(entry.path, result)
                break
    except (FileNotFoundError, PermissionError):
        pass

    return result


def _nodeid_fragments(node_id: str, browser_name: str) -> list:
    """Return a list of lowercase substrings to match against folder names."""
    # Strip parameter brackets, normalise separators
    clean = re.sub(r"\[.*?\]", "", node_id)
    clean = clean.replace("::", "-").replace("/", "-").replace("\\", "-")
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", clean).lower()

    parts = [p for p in clean.split("-") if p and len(p) > 2]
    fragments = parts[-3:] if len(parts) >= 3 else parts  # use last 3 meaningful parts
    if browser_name:
        fragments.append(browser_name.lower())
    return fragments


def _collect_from_folder(folder: str, result: dict) -> None:
    if not os.path.isdir(folder):
        return
    try:
        for entry in os.scandir(folder):
            if not entry.is_file():
                continue
            name_lower = entry.name.lower()
            if name_lower.endswith(".png") or name_lower.endswith(".jpg") or name_lower.endswith(".jpeg"):
                result["screenshots"].append(entry.path)
            elif name_lower.endswith(".webm") or name_lower.endswith(".mp4"):
                result["videos"].append(entry.path)
            elif name_lower == "trace.zip":
                result["trace"] = entry.path
    except (FileNotFoundError, PermissionError):
        pass
