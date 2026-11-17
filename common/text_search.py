"""Shared keyword search and snippet extraction for Markdown files."""

import os
from typing import Dict, List, Optional


def split_search_terms(query: str, max_terms: int = 8) -> List[str]:
    """Split a search query into deduplicated lowercase terms."""
    seen = set()
    terms: List[str] = []
    for raw in str(query or "").strip().split():
        term = raw.lower()
        if term and term not in seen:
            seen.add(term)
            terms.append(term)
            if len(terms) >= max_terms:
                break
    return terms


def _clip_line(line: str, terms: List[str], max_len: int = 160) -> str:
    text = line.strip()
    if len(text) <= max_len:
        return text
    lower = text.lower()
    pos = -1
    for term in terms:
        idx = lower.find(term)
        if idx >= 0 and (pos < 0 or idx < pos):
            pos = idx
    if pos <= 40:
        return text[: max_len - 1].rstrip() + "…"
    start = max(0, pos - 40)
    end = min(len(text), start + max_len - 2)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end].strip() + suffix


def score_markdown_file(
    file_path: str,
    terms: List[str],
    *,
    title: str = "",
    rel_path: str = "",
    max_snippets: int = 3,
    max_file_bytes: int = 2 * 1024 * 1024,
) -> Optional[Dict[str, object]]:
    """Score a Markdown/text file against ``terms`` and extract matching snippets.

    Returns ``None`` if any term fails to match across title, path, and content.
    """
    if not terms or not os.path.isfile(file_path):
        return None
    try:
        if os.path.getsize(file_path) > max_file_bytes:
            return None
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return None

    meta_text = f"{title} {rel_path}".lower()
    matched_terms = {t for t in terms if t in meta_text}
    title_hits = len(matched_terms)

    heading_hits = 0
    line_hits = 0
    candidates: List[tuple] = []

    for line_no, raw_line in enumerate(content.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        hits_on_line = [t for t in terms if t in lower]
        if not hits_on_line:
            continue
        matched_terms.update(hits_on_line)
        is_heading = stripped.startswith("#")
        if is_heading:
            heading_hits += len(hits_on_line)
        line_hits += len(hits_on_line)
        candidates.append((len(hits_on_line), is_heading, -line_no, line_no, stripped))

    if len(matched_terms) < len(terms):
        return None

    candidates.sort(reverse=True)
    snippets = [
        {"line": line_no, "text": _clip_line(text, terms)}
        for _, _, _, line_no, text in candidates[:max_snippets]
    ]
    score = title_hits * 10 + heading_hits * 3 + line_hits
    return {
        "score": score,
        "match_count": title_hits + line_hits,
        "snippets": snippets,
    }
