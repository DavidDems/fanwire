"""Put `.ai/` on sys.path so `agentlib` imports without an install step.

The agent infrastructure is deliberately dependency-free stdlib Python (see
`.ai/docs/architecture.md`, "Zero-dependency deterministic core"), so there is
no package to `pip install -e`. Tests need pytest and nothing else.
"""

import sys
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))
