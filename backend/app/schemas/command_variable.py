from pydantic import RootModel


class CommandVariablesResponse(RootModel[dict[str, str]]):
    pass


class CommandVariablesUpdate(RootModel[dict[str, str]]):
    pass
