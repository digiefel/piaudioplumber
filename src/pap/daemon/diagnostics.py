"""Diagnostics recorder — records explainable decisions for every inferred state.

Every time the system concludes something (source is active, volume set, etc.)
it records a Decision with its reason chain. This data is surfaced via the
/api/diagnostics/dump endpoint and the web debug drawer.
"""
from __future__ import annotations

import collections
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_MAX_DECISIONS = 200


@dataclass
class Decision:
    """A single recorded inference decision."""

    timestamp: float
    component: str
    subject: str
    conclusion: str
    reasons: list[str]
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.timestamp,
            "component": self.component,
            "subject": self.subject,
            "conclusion": self.conclusion,
            "reasons": self.reasons,
            "evidence": self.evidence,
        }


class Diagnostics:
    """Stores recent decisions and exposes them for inspection."""

    def __init__(self) -> None:
        self._decisions: collections.deque[Decision] = collections.deque(maxlen=_MAX_DECISIONS)

    def record(
        self,
        component: str,
        subject: str,
        conclusion: str,
        reasons: list[str],
        evidence: dict[str, Any] | None = None,
    ) -> None:
        d = Decision(
            timestamp=time.time(),
            component=component,
            subject=subject,
            conclusion=conclusion,
            reasons=reasons,
            evidence=evidence or {},
        )
        self._decisions.append(d)
        logger.debug("[%s] %s → %s (%s)", component, subject, conclusion, "; ".join(reasons))

    def recent(self, n: int = 50) -> list[dict[str, Any]]:
        return [d.to_dict() for d in list(self._decisions)[-n:]]

    def for_subject(self, subject: str) -> list[dict[str, Any]]:
        return [d.to_dict() for d in self._decisions if d.subject == subject]

    def dump(self) -> dict[str, Any]:
        return {
            "total_decisions": len(self._decisions),
            "recent": self.recent(50),
        }


__all__ = ["Decision", "Diagnostics"]
