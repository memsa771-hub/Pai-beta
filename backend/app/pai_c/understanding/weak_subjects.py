"""Weak subjects from the student's own marks.

Computed on read from the Vault view rows (MemoryService.vault_rows), never
stored, so they change only when the marks change. Thresholds and the grade
table live in pai_c/policy/weaknesses.json.
"""
from app.pai_c.memory import entry_ref, vault_catalog
from app.pai_c.paths.fields import current_education
from app.pai_c.policy.controller import load_data
from app.pai_c.roadmap.engine import marks_percent


def _percent(value: dict, grades: dict) -> tuple[float | None, str | None]:
    """The course's percent, and its grade letter when the percent only stands in for a grade."""
    score = value.get("score") or {}
    percent = marks_percent({"result": score})
    if percent is not None:
        return percent, None
    grade = str(score.get("grade") or value.get("grade") or "").strip().upper()
    return grades.get(grade), (grade if grade in grades else None)


def _scored(rows: list, policy: dict) -> dict:
    """Education id -> [(row, percent)] for the usable, scored course rows."""
    by_education: dict = {}
    for row in rows:
        entry = row.entry
        if entry.get("kind") != "record" or entry.get("type") != "course" or entry.get("stale"):
            continue
        if getattr(row, "sensitivity", None) == "restricted":
            continue
        value = entry["value"] if isinstance(entry["value"], dict) else {}
        percent, grade = _percent(value, policy["grade_percent"])
        if percent is not None and value.get("name") and value.get("education_id"):
            by_education.setdefault(str(value["education_id"]), []).append((row, percent, grade))
    return by_education


def _education_order(rows: list) -> list[str]:
    """Education record ids: the one paths and the roadmap read first, then the rest newest first."""
    education = [row.entry for row in rows
                 if row.entry.get("kind") == "record" and row.entry.get("type") == "education"]
    first = current_education([entry["value"] for entry in education])
    ordered = sorted(education, key=lambda entry: entry["value"] is not first)
    return [str(entry["id"]) for entry in ordered]


def weak_subjects(rows: list) -> list[dict]:
    policy = load_data("weaknesses.json")
    scored = _scored(rows, policy)
    if not scored:
        return []
    enough = [key for key in _education_order(rows) if len(scored.get(key, ())) >= policy["min_courses"]]
    chosen = enough[0] if enough else max(scored, key=lambda key: len(scored[key]))
    courses = scored[chosen]
    average = round(sum(course[1] for course in courses) / len(courses), 1)
    relative = len(courses) >= policy["min_courses"]
    catalog, weak = vault_catalog(), []
    for row, percent, grade in courses:
        if percent < policy["absolute_floor_percent"]:
            rule = "floor"
        elif relative and average - percent >= policy["below_own_average_points"]:
            rule = "below_average"
        else:
            continue
        value = row.entry["value"]
        subject = (catalog.choice_code("subjects", value.get("name", ""))
                   or catalog.choice_code("subjects", value.get("normalized_name") or ""))
        weak.append({"ref": entry_ref(row.entry), "subject": subject, "name": value["name"], "percent": percent,
                     "average": average, "rule": rule, "evidence": row.entry.get("level"), "grade": grade, "row": row})
    return sorted(weak, key=lambda item: item["percent"])
