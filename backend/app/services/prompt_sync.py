"""Prompt template synchronization service.

Syncs JSON template files from disk to database for performance.
Runs at startup and when templates are modified via API.
"""

import hashlib
import json
import re
from pathlib import Path

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIPromptTemplate

# Base directory for prompts
PROMPTS_DIR = Path(__file__).parent.parent.parent / "data" / "prompts"

# Category display names
CATEGORY_NAMES = {
    "general": "General",
    "recon": "Reconnaissance",
    "web": "Web Security",
    "network": "Network",
    "privesc": "Privilege Escalation",
    "ad": "Active Directory",
    "cloud": "Cloud",
    "mobile": "Mobile",
    "post": "Post-Exploitation",
    "reporting": "Reporting",
    "ctf": "CTF",
}


def _compute_file_hash(content: str) -> str:
    """Compute SHA256 hash of file content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _parse_path(relative_path: Path) -> tuple[str, str | None, str | None]:
    """Parse a relative path to extract type, category, and user_id.

    Returns (type, category, user_id)

    Examples:
    - system/general.json -> ("system", "general", None)
    - templates/web/sqli.json -> ("template", "web", None)
    - user/system/abc123/custom.json -> ("system", None, "abc123")
    - user/templates/abc123/my-template.json -> ("template", None, "abc123")
    """
    parts = relative_path.parts

    if parts[0] == "system":
        # system/general.json -> category from filename
        category = relative_path.stem
        return ("system", category, None)

    elif parts[0] == "templates":
        # templates/web/sqli.json -> category from folder
        if len(parts) >= 2:
            category = parts[1]
        else:
            category = "general"
        return ("template", category, None)

    elif parts[0] == "user":
        # user/system/{user_id}/file.json
        # user/templates/{user_id}/file.json
        prompt_type = "system" if parts[1] == "system" else "template"
        user_id = parts[2] if len(parts) >= 3 else None
        return (prompt_type, None, user_id)

    return ("template", "general", None)


def _slugify(text: str) -> str:
    """Convert text to a URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")


async def sync_prompt_templates(db: AsyncSession) -> dict[str, int]:
    """Synchronize all JSON template files to the database.

    Returns dict with counts: {"added": N, "updated": N, "deleted": N}
    """
    if not PROMPTS_DIR.exists():
        logger.warning(f"Prompts directory not found: {PROMPTS_DIR}")
        return {"added": 0, "updated": 0, "deleted": 0}

    stats = {"added": 0, "updated": 0, "deleted": 0}
    existing_paths: set[str] = set()

    # Get all existing templates from DB
    result = await db.execute(select(AIPromptTemplate))
    existing_templates = {t.file_path: t for t in result.scalars().all()}

    # Scan all JSON files
    for json_file in PROMPTS_DIR.rglob("*.json"):
        # Skip user directory during startup sync
        relative_path = json_file.relative_to(PROMPTS_DIR)
        if relative_path.parts[0] == "user":
            existing_paths.add(str(relative_path))
            continue

        try:
            content = json_file.read_text(encoding="utf-8")
            file_hash = _compute_file_hash(content)
            path_str = str(relative_path)
            existing_paths.add(path_str)

            # Check if update needed
            existing = existing_templates.get(path_str)
            if existing and existing.file_hash == file_hash:
                continue  # No change

            # Parse JSON
            data = json.loads(content)
            prompt_type, category, user_id = _parse_path(relative_path)

            # Use category from file or path
            final_category = data.get("category", category or "general")

            if existing:
                # Update existing
                existing.name = data["name"]
                existing.description = data.get("description")
                existing.category = final_category
                existing.variables = data.get("variables", [])
                existing.content = data["content"]
                existing.file_hash = file_hash
                stats["updated"] += 1
                logger.debug(f"Updated prompt template: {path_str}")
            else:
                # Create new
                template = AIPromptTemplate(
                    user_id=user_id,
                    type=prompt_type,
                    category=final_category,
                    name=data["name"],
                    description=data.get("description"),
                    variables=data.get("variables", []),
                    content=data["content"],
                    file_path=path_str,
                    file_hash=file_hash,
                    is_default=False,
                )
                db.add(template)
                stats["added"] += 1
                logger.debug(f"Added prompt template: {path_str}")

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in {json_file}: {e}")
        except KeyError as e:
            logger.error(f"Missing required field {e} in {json_file}")
        except Exception as e:
            logger.error(f"Error processing {json_file}: {e}")

    # Delete orphaned entries (file removed from disk)
    for path_str, template in existing_templates.items():
        # Don't delete user templates
        if path_str.startswith("user/"):
            continue
        if path_str not in existing_paths:
            await db.delete(template)
            stats["deleted"] += 1
            logger.debug(f"Deleted orphaned template: {path_str}")

    await db.commit()

    logger.info(
        f"Prompt sync complete: {stats['added']} added, "
        f"{stats['updated']} updated, {stats['deleted']} deleted"
    )

    return stats


async def save_user_template(
    db: AsyncSession,
    user_id: str,
    prompt_type: str,
    name: str,
    description: str | None,
    category: str,
    variables: list[str],
    content: str,
) -> AIPromptTemplate:
    """Save a user-created template to disk and database.

    Returns the created/updated AIPromptTemplate.
    """
    # Generate file path
    slug = _slugify(name)
    type_dir = "system" if prompt_type == "system" else "templates"
    relative_path = f"user/{type_dir}/{user_id}/{slug}.json"
    full_path = PROMPTS_DIR / relative_path

    # Ensure directory exists
    full_path.parent.mkdir(parents=True, exist_ok=True)

    # Prepare JSON data
    data = {
        "name": name,
        "description": description,
        "category": category,
        "variables": variables,
        "content": content,
    }

    # Write file
    json_content = json.dumps(data, indent=2, ensure_ascii=False)
    full_path.write_text(json_content, encoding="utf-8")

    # Calculate hash
    file_hash = _compute_file_hash(json_content)

    # Check if exists in DB
    result = await db.execute(
        select(AIPromptTemplate).where(
            AIPromptTemplate.file_path == relative_path
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.name = name
        existing.description = description
        existing.category = category
        existing.variables = variables
        existing.content = content
        existing.file_hash = file_hash
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        template = AIPromptTemplate(
            user_id=user_id,
            type=prompt_type,
            category=category,
            name=name,
            description=description,
            variables=variables,
            content=content,
            file_path=relative_path,
            file_hash=file_hash,
            is_default=False,
        )
        db.add(template)
        await db.commit()
        await db.refresh(template)
        return template


async def delete_user_template(db: AsyncSession, template: AIPromptTemplate) -> bool:
    """Delete a user template from disk and database.

    Returns True if deleted, False if template was not user-created.
    """
    if template.user_id is None:
        return False  # Cannot delete system templates

    # Delete file
    full_path = PROMPTS_DIR / template.file_path
    if full_path.exists():
        full_path.unlink()

    # Delete from DB
    await db.delete(template)
    await db.commit()

    return True


def get_category_name(category_id: str) -> str:
    """Get display name for a category ID."""
    return CATEGORY_NAMES.get(category_id, category_id.title())
