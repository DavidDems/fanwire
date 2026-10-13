"""Re-export of app.events.errors.UnrecognizedTeamError, nothing else.

Exists only because backend/scripts/load_nba_history.py (outside EVENTS-003's
paths) still imports the error from here. It goes with EVENTS-004, which
replaces that loader.
"""

from __future__ import annotations

from app.events.errors import UnrecognizedTeamError

__all__ = ["UnrecognizedTeamError"]
