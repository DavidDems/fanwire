"""Round-trip tests for the events/ models against a real Postgres, per
AGENTS.md TDD workflow. Written before app/events/models.py exists.

See wiki/CodeContext/Modules/0x02-events.md for the Team/Game schema.
EVENTS-004 added Player and PlayerGameStats (the box score) and Game's label,
sub-label, series game number and line scores, and dropped
Game.player_stats; those tests were written before that change.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import UniqueConstraint, select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Player, PlayerGameStats, Team


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_team(**overrides):
    defaults = {
        "nba_team_id": 12,
        "name": "Boston Celtics",
        "abbreviation": "BOS",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    return Team(**defaults)


def test_team_and_game_round_trip(session_factory):
    with session_factory() as session:
        home = _make_team(nba_team_id=12, name="Boston Celtics", abbreviation="BOS")
        away = _make_team(
            nba_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
        )
        session.add_all([home, away])
        session.commit()

        game = Game(
            nba_game_id=5001,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime(2025, 11, 1, 19, 30, tzinfo=UTC),
            season="2025-26",
            home_score=112,
            away_score=108,
            venue="TD Garden",
            label="NBA Finals",
            sub_label="Game 5",
            series_game_number=5,
            home_line_score=[25, 25, 25, 25, 12],
            away_line_score=[24, 26, 25, 25, 8],
        )
        session.add(game)
        session.commit()

        fetched = session.scalar(select(Game).where(Game.nba_game_id == 5001))
        assert fetched is not None
        assert fetched.home_team_id == home.id
        assert fetched.away_team_id == away.id
        assert fetched.season == "2025-26"
        assert (fetched.label, fetched.sub_label) == ("NBA Finals", "Game 5")
        assert fetched.series_game_number == 5
        assert fetched.home_line_score == [25, 25, 25, 25, 12]
        assert fetched.away_line_score == [24, 26, 25, 25, 8]


def test_team_nba_team_id_is_unique(session_factory):
    with session_factory() as session:
        session.add(_make_team(nba_team_id=99))
        session.commit()

        session.add(_make_team(nba_team_id=99, name="Duplicate"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_game_home_team_id_requires_existing_team(session_factory):
    with session_factory() as session:
        session.add(
            Game(
                nba_game_id=1,
                home_team_id=999_999,
                away_team_id=999_998,
                date=datetime(2025, 11, 1, tzinfo=UTC),
                season="2025-26",
                home_score=1,
                away_score=0,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_game_has_no_player_stats():
    assert "player_stats" not in Game.__table__.c


def test_game_label_and_line_scores_are_optional(session_factory):
    with session_factory() as session:
        team = _make_team()
        session.add(team)
        session.commit()

        game = Game(
            nba_game_id=2,
            home_team_id=team.id,
            away_team_id=team.id,
            date=datetime(2025, 11, 1, tzinfo=UTC),
            season="2025-26",
            home_score=0,
            away_score=0,
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        assert game.label is None
        assert game.sub_label is None
        assert game.series_game_number is None
        assert game.home_line_score is None
        assert game.away_line_score is None


# --------------------------------------------------------------------- players


_STATS = {
    "field_goals_made": 10,
    "field_goals_attempted": 20,
    "three_pointers_made": 3,
    "three_pointers_attempted": 8,
    "free_throws_made": 5,
    "free_throws_attempted": 6,
    "offensive_rebounds": 2,
    "defensive_rebounds": 7,
    "rebounds": 9,
    "assists": 4,
    "steals": 1,
    "blocks": 2,
    "turnovers": 3,
    "personal_fouls": 2,
    "points": 28,
    "plus_minus": -4,
}


def _game_with_team(session) -> tuple[Game, Team]:
    team = _make_team()
    session.add(team)
    session.flush()
    game = Game(
        nba_game_id=7,
        home_team_id=team.id,
        away_team_id=team.id,
        date=datetime(2025, 11, 1, tzinfo=UTC),
        season="2025-26",
        home_score=0,
        away_score=0,
    )
    session.add(game)
    session.commit()
    return game, team


def test_player_round_trip(session_factory):
    with session_factory() as session:
        session.add(
            Player(
                nba_person_id=1628369,
                first_name="Jayson",
                last_name="Tatum",
                birth_date=date(1998, 3, 3),
                height_inches=80,
                weight_lbs=210,
                country="USA",
                school="Duke",
                jersey="0",
                position="F-G",
                draft_year=2017,
                draft_round=1,
                draft_number=3,
                first_season="2017-18",
                last_season="2025-26",
            )
        )
        session.commit()

        p = session.scalar(select(Player).where(Player.nba_person_id == 1628369))
        assert (p.first_name, p.last_name, p.birth_date) == ("Jayson", "Tatum", date(1998, 3, 3))
        assert (p.height_inches, p.weight_lbs, p.position) == (80, 210, "F-G")
        assert (p.draft_year, p.draft_round, p.draft_number) == (2017, 1, 3)
        assert (p.first_season, p.last_season) == ("2017-18", "2025-26")


def test_player_attributes_other_than_the_id_are_optional(session_factory):
    with session_factory() as session:
        session.add(Player(nba_person_id=1))
        session.commit()


def test_player_nba_person_id_is_unique(session_factory):
    with session_factory() as session:
        session.add(Player(nba_person_id=5, last_name="One"))
        session.commit()

        session.add(Player(nba_person_id=5, last_name="Two"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_player_game_stats_round_trip(session_factory):
    with session_factory() as session:
        game, team = _game_with_team(session)
        player = Player(nba_person_id=1628369, last_name="Tatum")
        session.add(player)
        session.flush()
        session.add(
            PlayerGameStats(
                game_id=game.id,
                player_id=player.id,
                team_id=team.id,
                starter=True,
                starting_position="F",
                seconds_played=2350,
                **_STATS,
            )
        )
        session.commit()

        row = session.scalar(select(PlayerGameStats).where(PlayerGameStats.game_id == game.id))
        assert (row.player_id, row.team_id) == (player.id, team.id)
        assert (row.starter, row.starting_position, row.seconds_played) == (True, "F", 2350)
        assert row.dnp_reason is None
        assert row.played is True
        for name, value in _STATS.items():
            assert getattr(row, name) == value, name


def test_a_dnp_row_has_no_minutes_and_is_not_played(session_factory):
    with session_factory() as session:
        game, team = _game_with_team(session)
        player = Player(nba_person_id=2, last_name="Bench")
        session.add(player)
        session.flush()
        session.add(
            PlayerGameStats(
                game_id=game.id,
                player_id=player.id,
                team_id=team.id,
                starter=False,
                seconds_played=None,
                dnp_reason="DNP - Coach's Decision",
                **dict.fromkeys(_STATS, 0),
            )
        )
        session.commit()

        row = session.scalar(select(PlayerGameStats))
        assert row.played is False
        assert row.starting_position is None


def test_player_game_stats_is_unique_per_game_and_player(session_factory):
    with session_factory() as session:
        game, team = _game_with_team(session)
        player = Player(nba_person_id=3, last_name="Twice")
        session.add(player)
        session.flush()
        for _ in range(2):
            session.add(
                PlayerGameStats(
                    game_id=game.id,
                    player_id=player.id,
                    team_id=team.id,
                    starter=False,
                    seconds_played=60,
                    **_STATS,
                )
            )
        with pytest.raises(IntegrityError):
            session.commit()


def test_player_game_stats_requires_existing_game_player_and_team(session_factory):
    with session_factory() as session:
        session.add(
            PlayerGameStats(
                game_id=999_999,
                player_id=999_999,
                team_id=999_999,
                starter=False,
                seconds_played=60,
                **_STATS,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_player_game_stats_is_indexed_by_player():
    """Career and game-log reads go by player; box-score reads by game are
    covered by the (game_id, player_id) unique constraint."""
    indexed = {tuple(c.name for c in index.columns) for index in PlayerGameStats.__table__.indexes}
    assert ("player_id",) in indexed
    uniques = {
        tuple(c.name for c in constraint.columns)
        for constraint in PlayerGameStats.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("game_id", "player_id") in uniques
