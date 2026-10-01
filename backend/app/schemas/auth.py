from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class SignupRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    email: EmailStr | None = None
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    email: str | None
    display_name: str | None = None
    team: str | None = None
    timezone: str | None = None
    signature: str | None = None
    language: str = "fr"
    notifications: dict = Field(default_factory=dict)
    shortcuts: dict = Field(default_factory=dict)
    is_super_admin: bool

class LoginRequest(BaseModel):
    username_or_email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserUpdate(BaseModel):
    display_name: str | None = None
    team: str | None = None
    timezone: str | None = None
    signature: str | None = None
    language: str | None = None
    notifications: dict | None = None
    shortcuts: dict | None = None
