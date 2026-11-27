"""Authenticated student control over evidence-backed directions."""
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from app.api.response import success_response
from app.database import get_db
from app.routers._workspace_auth import _authorized
from app.pai_c.possibilities import PossibilityService, PossibilityError

router = APIRouter(prefix="/v1/counselor/possibilities", tags=["Counselor"])


@router.get("")
def list_possibilities(network: str = Query(...), db=Depends(get_db),
                       x_workspace_token: str | None = Header(None), authorization: str | None = Header(None)):
    workspace = _authorized(db, network, x_workspace_token, authorization)
    service = PossibilityService(db)
    return success_response({"possibilities": [service.serialize(row) for row in service.list(str(workspace.id))]})


class OwnPath(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    why: str = Field(default="", max_length=600)


@router.post("")
def add_own_path(body: OwnPath, network: str = Query(...), db=Depends(get_db),
                 x_workspace_token: str | None = Header(None), authorization: str | None = Header(None)):
    """A path the student puts in themselves. The analyzer then checks it
    against them like any other; it is saved, never suggested back."""
    from app.journey import JourneyService
    from app.pai_c.paths.analyzer import enqueue_path_analysis
    workspace = _authorized(db, network, x_workspace_token, authorization)
    workspace_id = str(workspace.id)
    title = " ".join(body.title.split())
    if not title:
        raise HTTPException(422, "A path needs a title")
    service = PossibilityService(db)
    journey = JourneyService(db).ensure_counselor(workspace_id)
    row = service.add(workspace_id, journey.id, title=title, why=body.why.strip() or title,
                      kind="student_added", source="student", status="saved")
    if row.status == "dismissed":
        # Typing a path in again is the clearest way to want it back.
        row, _ = service.transition(workspace_id, row.id, "save")
    enqueue_path_analysis(db, workspace_id, source_event_id=None, channel=None, reason="student_added")
    db.commit()
    return success_response(service.serialize(row))


@router.get("/analysis")
def path_analysis_status(network: str = Query(...), db=Depends(get_db),
                         x_workspace_token: str | None = Header(None), authorization: str | None = Header(None)):
    """The latest path analysis: whether it is done and how it ended, so the
    Paths page can stop waiting and say when PAI needs the education first."""
    from app.models import BackgroundJob
    from app.pai_c.paths.analyzer import JOB_ANALYZE_PATHS
    workspace = _authorized(db, network, x_workspace_token, authorization)
    job = db.scalar(select(BackgroundJob).where(
        BackgroundJob.workspace_id == str(workspace.id), BackgroundJob.job_type == JOB_ANALYZE_PATHS)
        .order_by(BackgroundJob.created_at.desc(), BackgroundJob.id.desc()).limit(1))
    if job is None:
        return success_response({"job_id": None, "done": True, "outcome": None})
    return success_response({"job_id": job.id, "done": job.status not in {"pending", "running"},
                             "outcome": (job.result or {}).get("status")})


@router.get("/compare")
def compare_paths(ids: list[str] = Query(default=[]), network: str = Query(...), db=Depends(get_db),
                  x_workspace_token: str | None = Header(None), authorization: str | None = Header(None)):
    """The Paths eligibility read: for each asked-for live path, whether the
    student can get into its field from their education and what stands
    between. Shown as each row's badge and in the Compare table; read now, so
    it follows the Vault."""
    from app.pai_c.paths.eligibility import compare
    workspace = _authorized(db, network, x_workspace_token, authorization)
    return success_response(compare(db, str(workspace.id), ids))


def _choice(workspace_id: str, possibility_id: str, action: str, db):
    """Choose a path (the decision record PAI OS reads), or withdraw the choice."""
    from app.pai_c.paths.choice import PathChoiceError, PathChoiceService
    from sqlalchemy.exc import IntegrityError
    service = PathChoiceService(db)
    try:
        if action == "choose":
            service.choose(workspace_id, possibility_id)
        else:
            row = service.active(workspace_id)
            if row is None or row.possibility_id != possibility_id:
                raise PathChoiceError("This path is not your chosen path", 409)
            service.withdraw(workspace_id)
    except PathChoiceError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    except IntegrityError as exc:  # a concurrent choice won the one-active-choice index
        db.rollback()
        raise HTTPException(409, "Another path was just chosen; reload the page") from exc
    db.commit()
    return success_response(PossibilityService(db).serialize(PossibilityService(db).get(workspace_id, possibility_id)))


@router.post("/{possibility_id}/{action}")
async def change_possibility(possibility_id: str, action: str, network: str = Query(...), db=Depends(get_db),
                             x_workspace_token: str | None = Header(None), authorization: str | None = Header(None)):
    workspace = _authorized(db, network, x_workspace_token, authorization)
    workspace_id = str(workspace.id)
    if action in {"choose", "withdraw"}:
        return _choice(workspace_id, possibility_id, action, db)
    service = PossibilityService(db)
    previous_status = None
    try:
        if action == "explore":
            from app.routers.counselor_paths import explore
            await explore(possibility_id, network, db, x_workspace_token, authorization)
            row = service.get(workspace_id, possibility_id)
        else:
            row, _ = service.transition(workspace_id, possibility_id, action)
        db.commit()
        return success_response(service.serialize(row))
    except PossibilityError as exc:
        db.rollback()
        raise HTTPException(409, str(exc)) from exc
    except Exception:
        db.rollback()
        # The gateway commits before durable delegation. Restore the control on
        # a failed start; its research_key makes a later retry safe even when a
        # run was queued but the response was interrupted.
        if previous_status and previous_status != "exploring":
            row = service.get(workspace_id, possibility_id)
            if row.status == "exploring":
                row.status = previous_status
                db.commit()
        raise
