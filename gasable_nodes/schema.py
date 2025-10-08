from pydantic import BaseModel, Field, HttpUrl, validator
from typing import Dict, List, Literal, Optional, Any, Union


class RateLimit(BaseModel):
    unit: Literal["second", "minute", "hour", "day"] = "minute"
    limit: int = 60


class Retries(BaseModel):
    max: int = 5
    backoff: Literal["exponential", "fixed"] = "exponential"
    max_delay_sec: int = 30


class IOField(BaseModel):
    type: Literal["string", "number", "boolean", "object", "array", "file", "any"] = "string"
    required: bool = False
    default: Optional[Any] = None
    items: Optional["IOField"] = None
    description: Optional[str] = None


IOField.update_forward_refs()


class AuthSpec(BaseModel):
    type: Literal["none", "token", "oauth2"] = "none"
    provider: Optional[str] = None
    scopes: List[str] = []


class ImplOpenAPI(BaseModel):
    type: Literal["http"] = "http"
    openapi_provider: str
    operation_id: str
    base_url: Optional[str] = None


class ImplPython(BaseModel):
    type: Literal["python"] = "python"
    module: str
    function: str = "run"


Impl = Union[ImplOpenAPI, ImplPython]


class NodeSpec(BaseModel):
    name: str
    version: str = "1.0.0"
    title: str
    category: str
    doc: Optional[str] = None
    auth: AuthSpec = AuthSpec()
    inputs: Dict[str, IOField] = Field(default_factory=dict)
    outputs: Dict[str, IOField] = Field(default_factory=dict)
    rate_limit: RateLimit = RateLimit()
    retries: Retries = Retries()
    impl: Impl

    @validator("name")
    def name_must_have_dot(cls, v):
        if "." not in v:
            raise ValueError("name should be namespaced like provider.action")
        return v


