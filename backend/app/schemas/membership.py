from pydantic import BaseModel, ConfigDict


class MembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    project_id: str
    role: str
    status: str
    source: str
    username: str | None = None
    display_name: str | None = None
    email: str | None = None
    team: str | None = None

class InviteRequest(BaseModel):
    username_or_email: str
    role: str = "member"


class MembershipUpdate(BaseModel):
    role: str | None = None
    status: str | None = None
