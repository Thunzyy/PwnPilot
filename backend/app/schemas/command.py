from pydantic import BaseModel, ConfigDict, Field


class CommandBase(BaseModel):
    name: str
    category: str
    command: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    is_custom: bool = True


class CommandCreate(CommandBase):
    pass


class CommandUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    command: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    is_custom: bool | None = None


class CommandResponse(CommandBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scope: str
    project_id: str | None
