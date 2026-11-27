"""The student's chosen path (pai_route_decisions): the decision record PAI OS
reads at /v1/decision-records/current (PAI_C_WORKFLOW_LOCK_V1 section 11).

The student chooses on the Paths page; any live path can be chosen, whatever
its eligibility, because eligibility informs and never decides. The row keeps
the eligibility verdict as it was at choose time; the record shows the live
status beside that snapshot instead of rewriting it. The plan and its steps
belong to PAI OS, so a choice carries no steps.
"""

from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy import select

from app.models import RouteDecision, StudentJourney, Workspace
from app.pai_c.paths.eligibility import education_line, education_records, student_standing, verdict
from app.pai_c.possibilities import PossibilityError, PossibilityService


class PathChoiceError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


def field_key_of(row) -> str:
    """The path's study field, or the path itself for a path with no field
    (the student's own idea, or a direction PAI has no field for)."""
    return (row.study_field or {}).get("key") or f"path:{row.id}"


def route_of(title: str, result: dict, line: dict | None) -> dict:
    """What the choice stands on: where the student is now, what stands
    between, the entry tests and the degree, with the rules' sources."""
    return {"now": line, "needs": result["needs"], "tests": result["tests"],
            "degree": {"title": title, "years": result["years"]}, "sources": result["sources"]}


class PathChoiceService:
    def __init__(self, db):
        self.db = db

    def _path(self, workspace_id: str, possibility_id: str | None):
        if not possibility_id:
            return None
        try:
            return PossibilityService(self.db).get(workspace_id, possibility_id)
        except PossibilityError:
            return None

    # ---- reading ----------------------------------------------------------------

    def active(self, workspace_id: str) -> RouteDecision | None:
        return self.db.scalar(select(RouteDecision).where(
            RouteDecision.workspace_id == workspace_id, RouteDecision.withdrawn_at.is_(None)))

    def _live_status(self, workspace_id: str, row: RouteDecision) -> str:
        """The chosen path's eligibility now; "unknown" once the path is gone."""
        path = self._path(workspace_id, row.possibility_id)
        if path is None or path.status == "dismissed":
            return "unknown"
        key = (path.study_field or {}).get("key")
        return verdict(key, student_standing(education_records(self.db, workspace_id))).status

    def serialize(self, workspace_id: str, row: RouteDecision) -> dict:
        return {"id": row.id, "field_key": row.field_key, "possibility_id": row.possibility_id, "title": row.title,
                "chosen_at": row.chosen_at.isoformat() if row.chosen_at else None,
                "withdrawn_at": row.withdrawn_at.isoformat() if row.withdrawn_at else None,
                "route": row.route, "snapshot_verdict": row.verdict,
                "live_status": self._live_status(workspace_id, row)}

    def current(self, workspace_id: str) -> dict | None:
        row = self.active(workspace_id)
        if row is None:
            return None
        return {**self.serialize(workspace_id, row), "workspace_id": row.workspace_id}

    # ---- the journey ------------------------------------------------------------

    def _journey(self, workspace_id: str) -> StudentJourney | None:
        return self.db.scalar(select(StudentJourney).where(
            StudentJourney.workspace_id == workspace_id, StudentJourney.journey_type == "counselor_decision",
            StudentJourney.status == "active").order_by(StudentJourney.created_at).limit(1))

    def _set_stage(self, journey: StudentJourney, stage: str, actor: str = "human:student", **flags) -> None:
        from app.journey import JourneyService
        JourneyService(self.db).set_counselor_stage(journey.workspace_id, journey.id, stage, actor=actor, **flags)

    def _enter_chosen(self, journey: StudentJourney, row: RouteDecision, actor: str) -> bool:
        """The journey follows the decision: from PROPOSED to CHOSEN, with the
        chosen path as the active goal. Shared by choose and by the first paths
        arriving while a path is already chosen. False when the stage cannot
        move."""
        if journey.current_stage == "PROPOSED":
            self._set_stage(journey, "CHOSEN", actor=actor, validated_choice=True)
        if journey.current_stage != "CHOSEN":
            return False
        journey.current_objective = row.title
        journey.active_goal = {"route_decision_id": row.id, "field_key": row.field_key,
                               "title": row.title, "route": row.route}
        return True

    def follow_active(self, workspace_id: str, actor: str) -> None:
        """Called by the stage sync once the journey is in PROPOSED: an active
        choice (made before the paths settled) takes it on to CHOSEN."""
        journey, row = self._journey(workspace_id), self.active(workspace_id)
        if journey is not None and row is not None:
            self._enter_chosen(journey, row, actor)

    @staticmethod
    def _note_withdrawn(journey: StudentJourney, row: RouteDecision) -> None:
        journey.decisions = [*(journey.decisions or []), {
            "kind": "route_withdrawn", "route_decision_id": row.id, "field_key": row.field_key,
            "withdrawn_at": row.withdrawn_at.isoformat()}]

    def _record_choice(self, workspace_id: str, row: RouteDecision, previous: RouteDecision | None) -> None:
        """The choice syncs the stage (journey_sync, reason "chosen"): it is
        the student's act, so it also ends a re-plan, and a journey lagging in
        MIRROR moves on with it. A student who chooses before the Mirror keeps
        their stage; the decision itself is still saved, and the first saved
        paths move them to CHOSEN (follow_active)."""
        from app.pai_c.journey_sync import sync_counselor_stage
        journey = self._journey(workspace_id)
        if journey is None:
            return
        if previous is not None:
            self._note_withdrawn(journey, previous)
        sync_counselor_stage(self.db, workspace_id, reason="chosen", actor="human:student")
        if not self._enter_chosen(journey, row, "human:student"):
            return
        journey.decisions = [*(journey.decisions or []), {
            "kind": "route_choice", "route_decision_id": row.id, "field_key": row.field_key,
            "chosen_at": row.chosen_at.isoformat()}]

    def _record_withdraw(self, workspace_id: str, row: RouteDecision) -> None:
        journey = self._journey(workspace_id)
        if journey is None:
            return
        if journey.current_stage == "CHOSEN":
            self._set_stage(journey, "PROPOSED")
        if (journey.active_goal or {}).get("route_decision_id") == row.id:
            journey.active_goal = None
            journey.current_objective = None
        self._note_withdrawn(journey, row)

    # ---- writing ----------------------------------------------------------------

    def _lock(self, workspace_id: str):
        # Serializes choose/withdraw per workspace; the partial unique index is
        # the final guard.
        self.db.scalar(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update())

    def choose(self, workspace_id: str, possibility_id: str) -> RouteDecision:
        """Make one live path the student's choice. Choosing the path already
        chosen changes nothing; choosing another withdraws the earlier one."""
        self._lock(workspace_id)
        paths = PossibilityService(self.db)
        path = self._path(workspace_id, possibility_id)
        if path is None or path.status == "dismissed":
            raise PathChoiceError("This is not one of your paths", 404)
        previous = self.active(workspace_id)
        if previous is not None and previous.possibility_id == path.id:
            return previous
        now = datetime.now(timezone.utc)
        if previous is not None:
            previous.withdrawn_at = now
            if previous.possibility_id:
                paths.set_chosen(workspace_id, previous.possibility_id, False)
            self.db.flush()  # the old row leaves the partial unique index before the new one enters
        key = (path.study_field or {}).get("key")
        standing = student_standing(education_records(self.db, workspace_id))
        result = asdict(verdict(key, standing))
        row = RouteDecision(workspace_id=workspace_id, field_key=field_key_of(path), possibility_id=path.id,
                            title=path.title, verdict=result,
                            route=route_of(path.title, result, education_line(standing)),
                            steps=[], steps_done=[], chosen_at=now)
        self.db.add(row)
        self.db.flush()
        paths.set_chosen(workspace_id, path.id, True)
        self._record_choice(workspace_id, row, previous)
        self.db.flush()
        from app.pai_c.checkins import schedule
        schedule(self.db, workspace_id, "chosen_path", row.id, at=now)
        return row

    def withdraw(self, workspace_id: str) -> RouteDecision:
        self._lock(workspace_id)
        row = self.active(workspace_id)
        if row is None:
            raise PathChoiceError("No path is chosen", 404)
        row.withdrawn_at = datetime.now(timezone.utc)
        if row.possibility_id:
            PossibilityService(self.db).set_chosen(workspace_id, row.possibility_id, False)
        self._record_withdraw(workspace_id, row)
        self.db.flush()
        return row
