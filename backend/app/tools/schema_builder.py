"""Auto-generate Pydantic models from function type hints."""
from __future__ import annotations

import inspect
from typing import Any, get_type_hints

from pydantic import BaseModel, create_model


def build_params_model(
    fn: Any,
    exclude: set[type] | None = None,
) -> type[BaseModel]:
    """Build a Pydantic model from a function's type hints.

    Excludes parameters whose annotation is in `exclude` set
    (used to filter out ToolContext).
    """
    exclude = exclude or set()
    hints = get_type_hints(fn)
    sig = inspect.signature(fn)

    fields: dict[str, Any] = {}
    for name, param in sig.parameters.items():
        if name == "return":
            continue
        hint = hints.get(name, Any)
        # Skip excluded types (ToolContext, etc.)
        if hint in exclude:
            continue
        if param.default is inspect.Parameter.empty:
            fields[name] = (hint, ...)
        else:
            fields[name] = (hint, param.default)

    model_name = f"{fn.__name__}_Params"
    return create_model(model_name, **fields)
