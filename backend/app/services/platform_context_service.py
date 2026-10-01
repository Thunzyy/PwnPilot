"""Platform context enrichment for project URL imports."""

from __future__ import annotations

import re
from html import unescape
from urllib.parse import urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.base import BaseService
from app.services.settings_service import SettingsService

HACK_THE_BOX_HOSTS = {
    "hackthebox.com",
    "www.hackthebox.com",
    "app.hackthebox.com",
    "academy.hackthebox.com",
    "ctf.hackthebox.com",
}


class PlatformContextService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.platform_context")
        self.db = db
        self.settings_service = SettingsService(db)

    async def import_from_url(self, raw_url: str) -> dict:
        normalized_url = self._trim(raw_url)
        if not normalized_url:
            return {
                "context": {},
                "source": "unsupported",
                "messages": ["No URL was provided."],
            }

        try:
            parsed = urlparse(normalized_url)
        except ValueError:
            return {
                "context": {},
                "source": "unsupported",
                "messages": ["The URL could not be parsed."],
            }

        host = parsed.hostname.lower() if parsed.hostname else ""
        if host in HACK_THE_BOX_HOSTS:
            return await self._import_hack_the_box(parsed)

        return {"context": {}, "source": "unsupported", "messages": []}

    async def _import_hack_the_box(self, parsed) -> dict:
        slug = self._extract_machine_slug(parsed.path)
        if not slug:
            return {"context": {}, "source": "unsupported", "messages": []}

        settings_obj = await self.settings_service.get_or_create()
        token = self.settings_service.get_platform_api_token(
            "htb", settings_obj=settings_obj
        )

        if token:
            api_result = await self._import_htb_via_api(slug, token)
            if api_result is not None:
                return api_result

        public_result = await self._import_htb_via_public_page(slug)
        if public_result is not None:
            return public_result

        return {
            "context": {
                "platform_name": "Hack The Box",
                "platform_content_type": "machine",
                "platform_target_slug": slug,
                "platform_target_name": self._humanize_slug(slug),
            },
            "source": "url_parse",
            "messages": [],
        }

    async def _import_htb_via_api(self, slug: str, token: str) -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    f"https://labs.hackthebox.com/api/v4/machine/profile/{slug}",
                    headers={"Authorization": f"Bearer {token}"},
                )
            response.raise_for_status()
        except httpx.HTTPError:
            return None

        info = response.json().get("info") or {}
        if not info:
            return None

        context = self._build_htb_context(
            slug=slug,
            name=self._trim(info.get("name")) or self._humanize_slug(slug),
            difficulty=self._trim(info.get("difficultyText")),
            os_name=self._trim(info.get("os")),
            synopsis=self._trim(info.get("synopsis")),
            ip_address=self._trim(info.get("ip")),
        )
        messages = ["Hack The Box metadata imported via API token."]
        if not context["target_ip"]:
            messages.append(
                "No live machine IP was returned by Hack The Box for this machine."
            )
        return {"context": context, "source": "htb_api", "messages": messages}

    async def _import_htb_via_public_page(self, slug: str) -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    f"https://www.hackthebox.com/machines/{slug.lower()}"
                )
            response.raise_for_status()
        except httpx.HTTPError:
            return None

        html = response.text
        if not html:
            return None

        title_match = re.search(
            r"<title>\s*(.*?)\s*\((.*?)\)\s*\|\s*Hack The Box\s*</title>",
            html,
            re.IGNORECASE | re.DOTALL,
        )
        name = self._extract_html_text(
            title_match.group(1) if title_match else None
        ) or self._extract_html_text(
            self._first_match(
                html,
                r'<h3[^>]*class="[^"]*font-weight600[^"]*"[^>]*>(.*?)</h3>',
            )
        )
        difficulty = self._extract_html_text(
            title_match.group(2) if title_match else None
        ) or self._extract_html_text(
            self._first_match(
                html,
                r'class="[^"]*machine-difficulty[^"]*".*?<span[^>]*>(.*?)</span>',
            )
        )
        os_name = self._extract_html_text(
            self._first_match(
                html,
                r'class="[^"]*machine-os[^"]*".*?<span[^>]*>(.*?)</span>',
            )
        )
        synopsis = self._extract_html_text(
            self._first_match(
                html,
                r'<meta[^>]+name="description"[^>]+content="([^"]*)"',
            )
        )

        context = self._build_htb_context(
            slug=slug,
            name=name or self._humanize_slug(slug),
            difficulty=difficulty,
            os_name=os_name,
            synopsis=synopsis,
            ip_address="",
        )
        return {
            "context": context,
            "source": "htb_public_page",
            "messages": [
                "Hack The Box metadata imported from the public machine page.",
                "No live machine IP was available from the public page.",
            ],
        }

    def _build_htb_context(
        self,
        *,
        slug: str,
        name: str,
        difficulty: str | None,
        os_name: str | None,
        synopsis: str | None,
        ip_address: str | None,
    ) -> dict[str, str]:
        return {
            "engagement_kind": "platform_lab",
            "platform_name": "Hack The Box",
            "platform_content_type": "machine",
            "platform_target_name": name,
            "platform_target_slug": slug,
            "platform_difficulty": difficulty or "",
            "os": os_name or "",
            "target_ip": ip_address or "",
            "notes": synopsis or "",
        }

    @staticmethod
    def _extract_machine_slug(path: str) -> str:
        segments = [
            segment.strip()
            for segment in path.split("/")
            if segment and segment.strip()
        ]
        normalized_segments = [segment.lower() for segment in segments]
        for marker in ("machine", "machines"):
            if marker in normalized_segments:
                index = normalized_segments.index(marker)
                if index + 1 < len(segments):
                    return segments[index + 1]
        return ""

    @staticmethod
    def _humanize_slug(value: str) -> str:
        normalized = re.sub(r"[_-]+", " ", value.strip())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if not normalized:
            return ""
        return re.sub(r"\b\w", lambda match: match.group(0).upper(), normalized)

    @staticmethod
    def _trim(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _first_match(content: str, pattern: str) -> str | None:
        match = re.search(pattern, content, flags=re.IGNORECASE | re.DOTALL)
        return match.group(1) if match else None

    @staticmethod
    def _extract_html_text(value: str | None) -> str:
        if not value:
            return ""
        without_tags = re.sub(r"<[^>]+>", " ", value)
        normalized = re.sub(r"\s+", " ", unescape(without_tags)).strip()
        return normalized
