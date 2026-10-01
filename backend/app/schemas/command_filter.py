from pydantic import BaseModel, ConfigDict


class CommandFilterBase(BaseModel):
    name: str
    sort_order: int | None = None


class CommandFilterCreate(CommandFilterBase):
    pass


class CommandFilterUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class CommandFilterResponse(CommandFilterBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scope: str
    project_id: str | None
