# Collaboration and project access

```mermaid
sequenceDiagram
    autonumber
    participant Admin
    participant FE as Team panel / dashboard
    participant API as Membership routes
    participant ACL as Project access checks
    participant MS as Membership service
    participant DB as SQLite
    participant Invitee
    Admin->>FE: Open project team settings
    FE->>API: GET /projects/:id/memberships
    API->>ACL: require_admin(project_id, current_user)
    API->>MS: list_memberships(project_id)
    MS->>DB: Select memberships and users
    DB-->>FE: Members with identity fields
    Admin->>FE: Invite username/email with a role
    FE->>API: POST /projects/:id/invites
    API->>ACL: require_admin(project_id, current_user)
    API->>MS: invite_user(project_id, username_or_email, role)
    MS->>DB: Insert active membership
    DB-->>FE: Membership response
    Invitee->>FE: Reload dashboard
    FE->>API: GET /projects
    API->>ACL: list_projects_for_user(current_user)
    ACL->>DB: Filter by active memberships
    DB-->>FE: Shared project is visible
```

The team panel displays readable identity fields while preserving user IDs. Membership administration is restricted to project administrators. Dashboard visibility depends on active memberships. Separate access-request flows allow an administrator to approve or reject an outsider's request; see the [collaboration feature](../features/collaboration.md).
