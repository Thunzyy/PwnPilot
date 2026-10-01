from pydantic import BaseModel, ConfigDict


class CommandCategoryBase(BaseModel):
    name: str
    sort_order: int | None = None


class CommandCategoryCreate(CommandCategoryBase):
    pass


class CommandCategoryUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class CommandCategoryResponse(CommandCategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scope: str
    project_id: str | None
