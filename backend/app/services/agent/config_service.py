"""Service helpers for agent configuration CRUD."""
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_env_vars, get_or_create_key
from app.models.agent_config import AgentConfig
from app.schemas.agent_config import AgentConfigResponse


def config_to_response(config: AgentConfig) -> AgentConfigResponse:
    """Convert an AgentConfig model to a response schema (secrets masked).

    The api_key/env_vars ciphertext is never exposed; instead we return
    ``has_api_key``, ``has_env_vars``, and ``env_var_keys`` (just the key
    names, not values).
    """
    env_var_keys: list[str] = []
    if config.env_vars_encrypted is not None:
        try:
            key = get_or_create_key()
            env_dict = decrypt_env_vars(config.env_vars_encrypted, key)
            if env_dict:
                env_var_keys = list(env_dict.keys())
        except Exception:
            pass  # decryption failure -> empty keys

    return AgentConfigResponse(
        id=config.id,
        user_id=config.user_id,
        project_id=config.project_id,
        agent_type=config.agent_type,
        display_name=config.display_name,
        binary_path=config.binary_path,
        default_model=config.default_model,
        max_turns=config.max_turns,
        has_api_key=config.api_key_encrypted is not None,
        has_env_vars=config.env_vars_encrypted is not None,
        env_var_keys=env_var_keys,
        is_default=config.is_default,
        system_prompt=config.system_prompt,
        description=config.description,
        is_template=config.is_template,
        command_template=config.command_template,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


async def handle_default_flag(
    db: AsyncSession,
    user_id: str,
    project_id: str | None,
) -> None:
    """Unset is_default on all other agent configs in the same scope.

    Scope is defined by (user_id, project_id).  When project_id is None
    the scope is "global" configs; otherwise it's project-scoped.
    """
    stmt = (
        update(AgentConfig)
        .where(
            AgentConfig.user_id == user_id,
            AgentConfig.project_id == project_id,
        )
        .values(is_default=False)
    )
    await db.execute(stmt)


async def instantiate_template(
    template: AgentConfig,
    user_id: str,
    project_id: str | None,
    db: AsyncSession,
) -> AgentConfig:
    """Clone a template into a usable agent config.

    Copies all fields EXCEPT encrypted secrets (api_key, env_vars).
    The user must set credentials on the instantiated config separately.
    """
    config = AgentConfig(
        user_id=user_id,
        project_id=project_id,
        agent_type=template.agent_type,
        display_name=template.display_name,
        binary_path=template.binary_path,
        default_model=template.default_model,
        max_turns=template.max_turns,
        system_prompt=template.system_prompt,
        description=template.description,
        command_template=template.command_template,
        api_key_encrypted=None,   # NEVER clone secrets
        env_vars_encrypted=None,  # NEVER clone secrets
        is_template=False,
        is_default=False,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


# =========================================================================
# Built-in pentest templates
# =========================================================================

BUILT_IN_TEMPLATES = [
    {
        "display_name": "Recon Agent",
        "description": "Automated reconnaissance and enumeration",
        "agent_type": "claude_code",
        "system_prompt": (
            "You are a reconnaissance specialist for penetration testing. "
            "Your primary goals are: enumerate services, identify open ports, "
            "discover subdomains, and gather OSINT. Use nmap, amass, subfinder, "
            "and similar tools. Document all findings in the project timeline."
        ),
        "max_turns": 30,
    },
    {
        "display_name": "Web Enum Agent",
        "description": "Web application enumeration and vulnerability scanning",
        "agent_type": "claude_code",
        "system_prompt": (
            "You are a web application security tester. Focus on: directory "
            "enumeration, parameter fuzzing, technology fingerprinting, and "
            "identifying common vulnerabilities (SQLi, XSS, SSRF, etc.). "
            "Use tools like gobuster, ffuf, nikto, and nuclei. Log findings "
            "to the project timeline with severity ratings."
        ),
        "max_turns": 50,
    },
    {
        "display_name": "PrivEsc Agent",
        "description": "Local privilege escalation enumeration",
        "agent_type": "claude_code",
        "system_prompt": (
            "You are a privilege escalation specialist. Enumerate the local "
            "system for escalation vectors: SUID binaries, cron jobs, writable "
            "paths, kernel exploits, service misconfigurations. Use linpeas, "
            "linux-exploit-suggester, and manual enumeration. Report findings "
            "with exploitation steps."
        ),
        "max_turns": 40,
    },
]


async def seed_builtin_templates(
    user_id: str, db: AsyncSession
) -> list[AgentConfig]:
    """Seed built-in pentest templates for a user if they don't exist yet.

    Checks by display_name + is_template + user_id to avoid duplicates.
    Returns the list of created templates (empty if all already exist).
    """
    created: list[AgentConfig] = []
    for tmpl_data in BUILT_IN_TEMPLATES:
        stmt = select(AgentConfig).where(
            AgentConfig.user_id == user_id,
            AgentConfig.is_template == True,  # noqa: E712
            AgentConfig.display_name == tmpl_data["display_name"],
        )
        result = await db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            continue  # Already seeded

        config = AgentConfig(
            user_id=user_id,
            is_template=True,
            **tmpl_data,
        )
        db.add(config)
        created.append(config)

    if created:
        await db.commit()
        for c in created:
            await db.refresh(c)

    return created
