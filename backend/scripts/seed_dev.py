"""Dev-stack seeding for `backend-dev` (docker-compose.yml): today it seeds
nothing, and says how to get games into a dev database instead.

It used to insert a handful of fixture teams and games keyed by API-SPORTS
ids. That path is retired (EVENTS-003): a Team or Game is keyed by its
nba.com id alone, and games come from the NBA dataset loader,
`scripts/load_nba_history.py` (EVENTS-004 replaces it with the loader for
the new dataset). Inventing nba.com ids for fixture rows here would put
fake data under real keys, so this script writes no Team or Game rows.

Kept, rather than deleted, so the documented dev-stack command still works:
    docker compose exec backend-dev python scripts/seed_dev.py
It touches no database and always exits 0.
"""

from __future__ import annotations

_INSTRUCTIONS = """\
seed_dev.py seeds no teams or games: they come from the NBA dataset loader.

To load games into the dev database, put the dataset's CSV files in a
directory the backend-dev container can read, then run:

    docker compose exec backend-dev python scripts/load_nba_history.py --help
    docker compose exec backend-dev python scripts/load_nba_history.py --data-dir <dir>
"""


def main() -> None:
    print(_INSTRUCTIONS, end="")


if __name__ == "__main__":
    main()
