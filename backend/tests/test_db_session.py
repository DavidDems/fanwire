import pytest
from sqlalchemy import text
from testcontainers.postgres import PostgresContainer

from app.db import make_engine


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


def test_engine_connects_to_real_postgres(postgres_url):
    engine = make_engine(postgres_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        assert result.scalar() == 1
