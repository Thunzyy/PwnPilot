"""Generate .gitignore content for pentest vaults."""


def generate_pentest_gitignore() -> str:
    """Generate a .gitignore file content tailored for pentest vaults.

    Includes rules for sensitive directories, credential files,
    and environment files commonly found in penetration testing projects.

    Returns:
        String content suitable for writing to a .gitignore file
    """
    return """\
# PwnPilot - Pentest Vault .gitignore
# Auto-generated — do not commit sensitive data

# Sensitive directories
client-data/
credentials/
creds/
loot/
exfil/
dumps/
scans/

# Environment files
.env
.env.*

# Credential / key files
*.kdbx
*.key
*.pem
*.pfx
"""
