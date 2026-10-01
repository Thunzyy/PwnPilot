from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def init_fts_tables(conn) -> None:
    """Create FTS5 virtual table and auto-sync triggers for knowledge_docs."""
    await conn.execute(
        text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_docs_fts "
            "USING fts5(title, body, tags, content='knowledge_docs', "
            "content_rowid='rowid', tokenize='unicode61');"
        )
    )

    await conn.execute(
        text(
            "CREATE TRIGGER IF NOT EXISTS knowledge_docs_ai AFTER INSERT ON knowledge_docs "
            "BEGIN "
            "INSERT INTO knowledge_docs_fts(rowid, title, body, tags) "
            "VALUES (NEW.rowid, NEW.title, NEW.body, NEW.tags); "
            "END;"
        )
    )

    await conn.execute(
        text(
            "CREATE TRIGGER IF NOT EXISTS knowledge_docs_ad AFTER DELETE ON knowledge_docs "
            "BEGIN "
            "INSERT INTO knowledge_docs_fts(knowledge_docs_fts, rowid, title, body, tags) "
            "VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.tags); "
            "END;"
        )
    )

    await conn.execute(
        text(
            "CREATE TRIGGER IF NOT EXISTS knowledge_docs_au AFTER UPDATE ON knowledge_docs "
            "BEGIN "
            "INSERT INTO knowledge_docs_fts(knowledge_docs_fts, rowid, title, body, tags) "
            "VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.tags); "
            "INSERT INTO knowledge_docs_fts(rowid, title, body, tags) "
            "VALUES (NEW.rowid, NEW.title, NEW.body, NEW.tags); "
            "END;"
        )
    )


async def init_db() -> None:
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)
