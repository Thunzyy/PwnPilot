import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.terminal_session import TerminalSessionDB, SessionViewerDB, ViewerRoleDB
from app.database import Base


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_terminal_session_creation(db_session):
    session = TerminalSessionDB(
        id="test-123",
        project_id="proj-1",
        name="Test Terminal",
        master_token="master-token",
        viewer_token="viewer-token",
    )
    db_session.add(session)
    db_session.commit()

    result = db_session.query(TerminalSessionDB).first()
    assert result.id == "test-123"
    assert result.is_alive is True


def test_session_viewer_creation(db_session):
    session = TerminalSessionDB(
        id="test-123",
        project_id=None,
        name="Test",
        master_token="m",
        viewer_token="v",
    )
    viewer = SessionViewerDB(
        session_id="test-123",
        role=ViewerRoleDB.MASTER,
    )
    db_session.add_all([session, viewer])
    db_session.commit()

    result = db_session.query(SessionViewerDB).first()
    assert result.role == ViewerRoleDB.MASTER


def test_cascade_delete(db_session):
    """Test that viewers are deleted when session is deleted"""
    session = TerminalSessionDB(
        id="test-cascade",
        project_id=None,
        name="Cascade Test",
        master_token="m",
        viewer_token="v",
    )
    viewer = SessionViewerDB(
        session_id="test-cascade",
        role=ViewerRoleDB.VIEWER,
    )
    db_session.add_all([session, viewer])
    db_session.commit()

    # Verify viewer exists
    assert db_session.query(SessionViewerDB).count() == 1

    # Delete session
    db_session.delete(session)
    db_session.commit()

    # Verify viewer was cascade deleted
    assert db_session.query(SessionViewerDB).count() == 0


def test_session_viewer_relationship(db_session):
    """Test bidirectional relationship between session and viewers"""
    session = TerminalSessionDB(
        id="test-rel",
        project_id="proj-1",
        name="Relationship Test",
        master_token="m",
        viewer_token="v",
    )
    viewer1 = SessionViewerDB(session_id="test-rel", role=ViewerRoleDB.MASTER)
    viewer2 = SessionViewerDB(session_id="test-rel", role=ViewerRoleDB.VIEWER)

    db_session.add_all([session, viewer1, viewer2])
    db_session.commit()

    # Test relationship from session to viewers
    result = db_session.query(TerminalSessionDB).first()
    assert len(result.viewers) == 2

    # Test relationship from viewer to session
    viewer = db_session.query(SessionViewerDB).first()
    assert viewer.session.id == "test-rel"
