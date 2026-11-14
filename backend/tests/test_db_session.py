from sqlalchemy import text

from app.db import make_engine


def test_engine_connects_to_real_postgres(postgres_url):
    engine = make_engine(postgres_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        assert result.scalar() == 1
