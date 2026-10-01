from sqlalchemy import create_engine, inspect

from app.database import Base
import app.models  # noqa: F401  # ensure models are registered on Base


def test_command_management_tables_exist():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    expected_tables = {
        "commands",
        "command_favorites",
        "command_categories",
        "command_filters",
        "command_variables",
    }

    assert expected_tables.issubset(tables)


def test_command_management_columns_exist():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)

    command_columns = {col["name"] for col in inspector.get_columns("commands")}
    assert {"scope", "project_id"}.issubset(command_columns)

    favorite_columns = {col["name"] for col in inspector.get_columns("command_favorites")}
    assert {"id", "user_id", "command_id", "project_id"}.issubset(favorite_columns)

    category_columns = {col["name"] for col in inspector.get_columns("command_categories")}
    assert {"id", "name", "scope", "project_id", "sort_order"}.issubset(category_columns)

    filter_columns = {col["name"] for col in inspector.get_columns("command_filters")}
    assert {"id", "name", "scope", "project_id", "sort_order"}.issubset(filter_columns)

    variable_columns = {col["name"] for col in inspector.get_columns("command_variables")}
    assert {"id", "user_id", "key", "value"}.issubset(variable_columns)
