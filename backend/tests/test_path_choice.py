"""The path choice and its HTTP API: on the Paths page the student compares
2-3 paths and chooses one. One active decision per workspace, a snapshot of the
eligibility verdict at choose time, no route steps (the plan belongs to PAI OS),
and the decision record PAI OS reads at /v1/decision-records/current."""

import importlib.util
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.main import app
from app.models import PaiPossibility, RouteDecision
from app.pai_c.paths.admission import rule_for
from tests.test_path_eligibility import add_education, add_path, field_title, fsc

ROOT = Path(__file__).resolve().parents[1]
TOKEN = {"X-Workspace-Token": "synthetic-test-only"}
BASE = "/v1/counselor/possibilities"
STEP_KEYS = {"steps", "steps_done", "snapshot_steps", "time"}


@contextmanager
def paths_client(education=(), paths=()):
    """A student with education records and paths; yields the client, the
    student, the query params and the path ids by field key (or title)."""
    from scripts.counselor_eval_support import StudentSession
    with StudentSession() as student:
        ids = {}
        with student.factory() as db:
            for record in education:
                add_education(student, db, record)
            for key in paths:
                ids[key] = add_path(student, db, field_title(key), key).id

        def scoped_db():
            with student.factory() as session:
                yield session
        app.dependency_overrides[get_db] = scoped_db
        try:
            yield TestClient(app), student, {"network": student.workspace_id}, ids
        finally:
            app.dependency_overrides.pop(get_db, None)


def pre_eng(percent=78):
    return paths_client([fsc("pre_engineering", percent)],
                        ["electrical_engineering", "computer_engineering", "mbbs"])


def data(response, status=200):
    assert response.status_code == status, response.text
    return response.json()["data"]


def choose(client, params, possibility_id):
    return client.post(f"{BASE}/{possibility_id}/choose", params=params, headers=TOKEN)


def withdraw(client, params, possibility_id):
    return client.post(f"{BASE}/{possibility_id}/withdraw", params=params, headers=TOKEN)


def current(client, params):
    return data(client.get("/v1/decision-records/current", params=params, headers=TOKEN))


def _statuses(student):
    with student.factory() as db:
        return {row.study_field["key"]: row.status for row in db.query(PaiPossibility).all() if row.study_field}


def _active_rows(student):
    with student.factory() as db:
        return db.query(RouteDecision).filter(RouteDecision.withdrawn_at.is_(None)).all()


def test_auth_required():
    with pre_eng() as (client, _, params, ids):
        pid = ids["electrical_engineering"]
        assert client.post(f"{BASE}/{pid}/choose", params=params).status_code == 401
        assert client.post(f"{BASE}/{pid}/withdraw", params=params).status_code == 401
        assert client.get(f"{BASE}/compare", params={**params, "ids": [pid]}).status_code == 401
        assert client.get("/v1/decision-records/current", params=params).status_code == 401


def test_choose_open_path_writes_decision_record():
    with pre_eng() as (client, student, params, ids):
        pid = ids["electrical_engineering"]
        path = data(choose(client, params, pid))
        record = current(client, params)
    rule = rule_for("electrical_engineering")
    assert path["id"] == pid and path["status"] == "chosen"
    assert record["possibility_id"] == pid and record["workspace_id"] == student.workspace_id
    assert record["field_key"] == "electrical_engineering"
    assert record["title"] == field_title("electrical_engineering")
    assert record["chosen_at"] and record["withdrawn_at"] is None
    assert record["snapshot_verdict"]["status"] == "open" and record["live_status"] == "open"
    route = record["route"]
    assert set(route) == {"now", "needs", "tests", "degree", "sources"}
    assert route["degree"] == {"title": field_title("electrical_engineering"), "years": 4}
    assert record["snapshot_verdict"]["years"] == 4
    assert record["snapshot_verdict"]["min_percent"] == rule.min_percent
    assert route["needs"] == [] and route["tests"] == record["snapshot_verdict"]["tests"]
    assert route["now"]["level"] and route["now"]["percent"] == 78


def test_decision_record_has_no_steps():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        record = current(client, params)
        with student.factory() as db:
            row = db.query(RouteDecision).one()
            assert row.steps == [] and row.steps_done == []
    assert not STEP_KEYS & set(record)
    assert set(record) == {"id", "field_key", "possibility_id", "title", "chosen_at", "withdrawn_at",
                           "route", "snapshot_verdict", "live_status", "workspace_id"}


def test_choose_step_path_keeps_its_needs():
    with pre_eng(55) as (client, _, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        record = current(client, params)
    assert record["snapshot_verdict"]["status"] == "step"
    assert record["route"]["needs"] == record["snapshot_verdict"]["needs"] != []


def test_choose_not_open_path_is_allowed():
    """Eligibility informs, it never decides: a path the student cannot get
    into yet is still theirs to choose."""
    with pre_eng() as (client, student, params, ids):
        path = data(choose(client, params, ids["mbbs"]))
        record = current(client, params)
    assert path["status"] == "chosen"
    assert record["field_key"] == "mbbs"
    assert record["snapshot_verdict"]["status"] == "not_open" and record["live_status"] == "not_open"


def test_choose_unknown_paths_is_allowed():
    # A degree student: no field can be checked, every choice is still saved.
    degree = {"qualification_name": "bachelor", "field_of_study": "computer_science", "academic_status": "current"}
    with paths_client([degree], ["software_engineering"]) as (client, _, params, ids):
        data(choose(client, params, ids["software_engineering"]))
        record = current(client, params)
    assert record["snapshot_verdict"]["status"] == "unknown"
    assert record["snapshot_verdict"]["reasons"] == [{"key": "undergrad_only"}]
    # The student's own path with no study field: its field key is the path itself.
    with paths_client([fsc("pre_engineering", 78)]) as (client, student, params, _):
        with student.factory() as db:
            own = add_path(student, db, "Become a pilot", None, source="student", status="saved").id
        data(choose(client, params, own))
        record = current(client, params)
    assert record["field_key"] == f"path:{own}" and record["possibility_id"] == own
    assert record["snapshot_verdict"]["status"] == "unknown" and record["live_status"] == "unknown"
    assert record["snapshot_verdict"]["reasons"] == [{"key": "cannot_check"}]
    assert record["route"]["degree"]["title"] == "Become a pilot"


def test_choose_dismissed_or_unknown_id_is_404():
    with pre_eng() as (client, student, params, ids):
        with student.factory() as db:
            dismissed = add_path(student, db, field_title("civil_engineering"), "civil_engineering",
                                 status="dismissed").id
        assert choose(client, params, dismissed).status_code == 404
        assert choose(client, params, "no-such-path").status_code == 404
        with student.factory() as db:
            assert db.query(RouteDecision).count() == 0
        assert current(client, params) is None


def test_choose_other_workspace_path_is_404():
    with pre_eng() as (_, _, _, theirs):
        with pre_eng() as (client, student, params, _):
            assert choose(client, params, theirs["electrical_engineering"]).status_code == 404
            with student.factory() as db:
                assert db.query(RouteDecision).count() == 0


def test_choosing_another_withdraws_the_first_and_puts_it_back_to_saved():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        first = current(client, params)
        assert _statuses(student)["electrical_engineering"] == "chosen"
        data(choose(client, params, ids["computer_engineering"]))
        second = current(client, params)
        statuses = _statuses(student)
        with student.factory() as db:
            rows = {row.id: row for row in db.query(RouteDecision).all()}
    assert second["possibility_id"] == ids["computer_engineering"] and second["id"] != first["id"]
    assert rows[first["id"]].withdrawn_at is not None and rows[second["id"]].withdrawn_at is None
    assert statuses == {"computer_engineering": "chosen", "electrical_engineering": "saved", "mbbs": "suggested"}


def test_choosing_the_same_path_twice_is_a_no_op():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        first = current(client, params)
        again = data(choose(client, params, ids["electrical_engineering"]))
        second = current(client, params)
        with student.factory() as db:
            assert db.query(RouteDecision).count() == 1
        assert len(_active_rows(student)) == 1
    assert again["status"] == "chosen"
    assert second == first


def test_one_active_decision_per_workspace_enforced():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        with student.factory() as db:
            db.add(RouteDecision(workspace_id=student.workspace_id, field_key="computer_engineering",
                                 title="Computer", verdict={}, route={}, steps=[], steps_done=[]))
            with pytest.raises(IntegrityError):
                db.commit()


def test_withdraw_puts_path_back_to_saved():
    with pre_eng() as (client, student, params, ids):
        pid = ids["electrical_engineering"]
        assert withdraw(client, params, pid).status_code == 409  # nothing is chosen
        data(choose(client, params, pid))
        decision_id = current(client, params)["id"]
        path = data(withdraw(client, params, pid))
        assert path["id"] == pid and path["status"] == "saved"
        assert _statuses(student)["electrical_engineering"] == "saved"
        assert current(client, params) is None
        with student.factory() as db:
            assert db.get(RouteDecision, decision_id).withdrawn_at is not None
        # The path stays choosable after a withdraw.
        data(choose(client, params, pid))
        assert current(client, params)["possibility_id"] == pid


def test_withdraw_of_a_path_that_is_not_the_chosen_one_is_409():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        refused = withdraw(client, params, ids["computer_engineering"])
        assert refused.status_code == 409
        assert withdraw(client, params, "no-such-path").status_code == 409
        record = current(client, params)
        statuses = _statuses(student)
    assert record["possibility_id"] == ids["electrical_engineering"]
    assert statuses["electrical_engineering"] == "chosen" and statuses["computer_engineering"] == "suggested"


def test_chosen_status_is_not_a_student_transition():
    from app.pai_c.policy.controller import load_data
    transitions = load_data("possibilities.json")["transitions"]
    assert "choose" not in transitions and "chosen" not in transitions


@pytest.mark.asyncio
async def test_chosen_path_checkin_follows_the_active_decision():
    from app.models import BackgroundJob
    from app.pai_c.checkins import checkin_job
    with pre_eng() as (client, student, params, ids):
        pid = ids["electrical_engineering"]
        data(choose(client, params, pid))
        decision_id = current(client, params)["id"]
        with student.factory() as db:
            job = db.query(BackgroundJob).filter(BackgroundJob.job_type == "counselor.checkin").one()
            assert job.payload == {"kind": "chosen_path", "reference_id": decision_id}
        data(withdraw(client, params, pid))
        with student.factory() as db:
            job = db.query(BackgroundJob).filter(BackgroundJob.job_type == "counselor.checkin").one()
            assert (await checkin_job(job, db)) == {"status": "superseded"}


def test_decision_keeps_snapshot_and_shows_live_status():
    with pre_eng() as (client, student, params, ids):
        data(choose(client, params, ids["electrical_engineering"]))
        chosen = current(client, params)
        # The student corrects their marks below the floor: the live status
        # follows the Vault, the snapshot stays what they chose on.
        with student.factory() as db:
            add_education(student, db, fsc("pre_engineering", 50))
        later = current(client, params)
    assert later["id"] == chosen["id"]
    assert later["snapshot_verdict"] == chosen["snapshot_verdict"]
    assert later["snapshot_verdict"]["status"] == "open" and later["live_status"] == "step"
    assert later["route"] == chosen["route"]


@pytest.mark.parametrize("gone", ["dismissed", "deleted"])
def test_live_status_unknown_when_path_gone(gone):
    with pre_eng() as (client, student, params, ids):
        pid = ids["electrical_engineering"]
        data(choose(client, params, pid))
        with student.factory() as db:
            if gone == "dismissed":
                db.get(PaiPossibility, pid).status = "dismissed"
            else:
                db.get(RouteDecision, current(client, params)["id"]).possibility_id = None
            db.commit()
        record = current(client, params)
    assert record["live_status"] == "unknown"
    assert record["snapshot_verdict"]["status"] == "open"


def test_compare_returns_verdicts_in_asked_order():
    with pre_eng() as (client, student, params, ids):
        with student.factory() as db:
            dismissed = add_path(student, db, field_title("civil_engineering"), "civil_engineering",
                                 status="dismissed").id
        asked = [ids["mbbs"], ids["electrical_engineering"], dismissed, "no-such-path", ids["mbbs"]]
        table = data(client.get(f"{BASE}/compare", params={**params, "ids": asked}, headers=TOKEN))
        empty = data(client.get(f"{BASE}/compare", params=params, headers=TOKEN))
    assert [(row["id"], row["field_key"], row["verdict"]["status"]) for row in table["paths"]] == [
        (ids["mbbs"], "mbbs", "not_open"), (ids["electrical_engineering"], "electrical_engineering", "open")]
    assert table["education_line"]["percent"] == 78
    electrical = table["paths"][1]["verdict"]
    assert electrical["min_percent"] == rule_for("electrical_engineering").min_percent
    assert electrical["student_percent"] == 78
    assert empty["paths"] == [] and empty["education_line"] == table["education_line"]


def test_migration_118_creates_route_decisions_and_downgrades():
    spec = importlib.util.spec_from_file_location("migration118", ROOT / "alembic/versions/118_route_decisions.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.revision == "118" and migration.down_revision == "117"
    with patch.object(migration, "op", Mock()) as op:
        migration.upgrade()
        name, *columns = op.create_table.call_args.args
        assert name == "pai_route_decisions"
        names = {column.name for column in columns if hasattr(column, "name")}
        assert names >= {"id", "workspace_id", "field_key", "possibility_id", "title", "verdict", "route",
                         "steps", "steps_done", "chosen_at", "withdrawn_at"}
        [index] = [call for call in op.create_index.call_args_list if call.kwargs.get("unique")]
        assert index.args[2] == ["workspace_id"]
        assert "withdrawn_at IS NULL" in str(index.kwargs["postgresql_where"])
        migration.downgrade()
        op.drop_table.assert_called_once_with("pai_route_decisions")
