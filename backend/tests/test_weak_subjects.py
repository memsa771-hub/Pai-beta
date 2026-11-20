# -*- coding: utf-8 -*-
"""Weak subjects read from the student's own marks: computed on read, never stored.

Rows are written through the real stores on an isolated SQLite student; no model calls.
"""
from app.memory.candidates import MemoryCandidateService
from app.memory.reconciler import MemoryReconciler
from app.pai_c.memory import MemoryService
from app.pai_c.understanding.weak_subjects import weak_subjects
from scripts.counselor_eval_support import StudentSession


def _record(db, ws, kind, value, source_type="user_explicit", **evidence):
    candidate = MemoryCandidateService(db).propose(workspace_id=ws, candidate_type="student_record", key=kind,
        proposed_value=value, confidence=0.95, source_type=source_type,
        evidence={"quote": "Said it", **evidence}, allow_user_explicit=True)
    result = MemoryReconciler(db).reconcile(candidate)
    assert result.accepted, result
    db.commit()
    return result.result_id


def _education(db, ws, name="FSc", status="current", group="Pre-Engineering"):
    return _record(db, ws, "education", {"qualification_name": name, "field_of_study": group,
                                         "academic_status": status})


def _courses(db, ws, education_id, marks: dict):
    for name, mark in marks.items():
        score = {"grade": mark} if isinstance(mark, str) else {"percentage": mark}
        _record(db, ws, "course", {"education_id": education_id, "name": name, "score": score})


def _weak(marks: dict, name="FSc", status="current"):
    with StudentSession() as student, student.factory() as db:
        ws = student.workspace_id
        _courses(db, ws, _education(db, ws, name, status), marks)
        return weak_subjects(MemoryService(db).vault_rows(ws))


def test_below_floor_is_weak():
    weak = _weak({"Mathematics": 45, "Physics": 70, "Chemistry": 72})
    assert [(w["name"], w["subject"], w["rule"], w["percent"]) for w in weak] == [
        ("Mathematics", "mathematics", "floor", 45)]
    assert weak[0]["ref"].startswith("course:")


def test_far_below_own_average_is_weak():
    weak = _weak({"Maths": 58, "Physics": 80, "Chemistry": 84, "English": 80})
    assert [(w["subject"], w["rule"]) for w in weak] == [("mathematics", "below_average")]
    assert weak[0]["average"] == 75.5


def test_too_few_courses_only_floor():
    assert _weak({"Mathematics": 58, "Physics": 90}) == []
    assert [w["name"] for w in _weak({"Mathematics": 40, "Physics": 90})] == ["Mathematics"]


def test_grade_letters_map():
    weak = _weak({"Mathematics": "A", "Physics": "A", "Chemistry": "D", "Biology": "A", "Urdu": "X"},
                 name="O Level", status="completed")
    assert [w["name"] for w in weak] == ["Chemistry"]


def test_falls_back_to_education_with_marks():
    with StudentSession() as student, student.factory() as db:
        ws = student.workspace_id
        matric = _education(db, ws, "Matric", "completed", "Science")
        _courses(db, ws, matric, {"Mathematics": 48, "Physics": 75, "Chemistry": 78, "Biology": 80})
        _education(db, ws, "FSc", "current")
        weak = weak_subjects(MemoryService(db).vault_rows(ws))
    assert [w["name"] for w in weak] == ["Mathematics"]


def test_evidence_follows_course_row():
    from app.pai_c.memory import entry_ref
    with StudentSession() as student, student.factory() as db:
        ws = student.workspace_id
        _courses(db, ws, _education(db, ws), {"Mathematics": 45, "Physics": 70, "Chemistry": 72})
        rows = MemoryService(db).vault_rows(ws)
        weak = weak_subjects(rows)
    levels = {entry_ref(row.entry): row.entry["level"] for row in rows}
    assert weak[0]["evidence"] == levels[weak[0]["ref"]] and weak[0]["evidence"] in {"stated", "shown", "confirmed"}


def test_no_courses_returns_empty():
    with StudentSession() as student, student.factory() as db:
        _education(db, student.workspace_id)
        assert weak_subjects(MemoryService(db).vault_rows(student.workspace_id)) == []
