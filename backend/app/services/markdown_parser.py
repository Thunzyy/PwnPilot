import hashlib
import re
from pathlib import Path

import frontmatter

from app.services.base import BaseService

_WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


class MarkdownParser(BaseService):
    def __init__(self):
        super().__init__("service.markdown_parser")

    def parse(self, file_path: str | Path, vault_root: str | Path) -> dict:
        file_path = Path(file_path)
        vault_root = Path(vault_root)

        raw_content = file_path.read_text(encoding="utf-8-sig")

        content_hash = hashlib.sha256(raw_content.encode("utf-8")).hexdigest()

        post = frontmatter.loads(raw_content)

        meta = dict(post.metadata) if post.metadata else {}
        body = post.content

        title = meta.get("title") or file_path.stem

        raw_tags = meta.get("tags", [])
        if isinstance(raw_tags, str):
            tags = [t.strip() for t in raw_tags.split(",") if t.strip()]
        elif isinstance(raw_tags, list):
            tags = [str(t).strip() for t in raw_tags if str(t).strip()]
        else:
            tags = []

        date = meta.get("date")

        wikilinks = []
        for match in _WIKILINK_RE.finditer(raw_content):
            target = match.group(1).strip()
            display = match.group(2).strip() if match.group(2) else None
            wikilinks.append({"target": target, "display": display})

        relative_path = file_path.relative_to(vault_root).as_posix()

        return {
            "title": title,
            "tags": tags,
            "date": date,
            "body": body,
            "wikilinks": wikilinks,
            "relative_path": relative_path,
            "content_hash": content_hash,
            "frontmatter": meta,
        }
