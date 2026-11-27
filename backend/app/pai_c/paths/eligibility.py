"""Can the student get into a path's study field from their current education
(open / step / not_open / unknown), and what stands between. Shown in the
Paths Compare table; the Mirror and the weak-subject reading share the
standing helpers.

Pure and deterministic: no model call and no chat input, so the same Vault and
paths always give the same answer, and a Vault change shows on the next read.
Eligibility comes only from education: budget and city never decide. It
informs the student; it never stops them from choosing a path. Reasons are copy
keys with values; the English lives in policy/eligibility.json so the API and
the page render the same words.
"""

from dataclasses import asdict, dataclass, field
from functools import lru_cache

from app.pai_c.memory import MemoryService, vault_catalog
from app.pai_c.paths.admission import Rule, grade_list, ibcc_percent, rule_for, rules_as_of
from app.pai_c.paths.fields import (candidate_fields, current_education, education_readable, group_rules,
                                    known_groups, read_education, student_groups, study_fields)
from app.pai_c.policy.controller import load_data


@lru_cache(maxsize=1)
def eligibility_policy() -> dict:
    return load_data("eligibility.json")


@dataclass(frozen=True)
class Standing:
    level: str | None
    groups: tuple[str, ...]
    percent: float | int | None
    readable: bool
    field: str | None = None  # a degree student's own study field


@dataclass(frozen=True)
class Need:
    """One thing between the student and the field: kind is marks, bridge,
    check or group; detail carries its values."""
    kind: str
    detail: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Verdict:
    status: str
    reasons: list[dict]
    needs: list[Need]
    tests: list[dict]
    years: int | None
    min_percent: float | None
    student_percent: float | None
    confidence: str | None
    sources: list[str]
    subjects: list[str] = field(default_factory=list)


# ---- the student's standing ----------------------------------------------------

def _intermediate_levels() -> set[str]:
    rules = group_rules()
    return ((set(rules["from_field_of_study"]) | set(rules["from_level"]) | set(rules["subject_rules"]))
            - set(rules["before_intermediate"]))


def _whole(value: float | None) -> float | int | None:
    """One decimal, and 55 rather than 55.0, so "you have {have}%" reads right."""
    if value is None:
        return None
    value = round(float(value), 1)
    return int(value) if value.is_integer() else value


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def marks_percent(record: dict) -> float | int | None:
    """The record's own marks: percentage, else obtained/total (a total below
    the obtained marks is a typo, not a mark), else IBCC grades for subject
    levels (A-level) when they are structured grade codes. None otherwise."""
    result = {**record, **(record.get("result") or {})}
    if _number(result.get("percentage")) and 0 <= result["percentage"] <= 100:
        return _whole(result["percentage"])
    obtained, total = result.get("marks_obtained"), result.get("marks_total")
    if _number(obtained) and _number(total) and 0 <= obtained <= total and total > 0:
        return _whole(obtained / total * 100)
    if read_education(record)[0] in group_rules()["subject_rules"]:
        grades = (record.get("details") or {}).get("grades")
        grades = grades if isinstance(grades, list) else grade_list(result.get("grade"))
        return _whole(ibcc_percent(grades)) if grades else None
    return None


def student_standing(education_records: list[dict]) -> Standing:
    """Where the student stands, from Vault education records (newest first)."""
    current = current_education(education_records)
    if current is None:
        return Standing(level=None, groups=(), percent=None, readable=False)
    level, field_code = read_education(current)
    # Level and marks come from the one record paths read: an intermediate
    # mark never describes a Matric standing, nor a Matric mark an FSc one.
    return Standing(level=level, groups=tuple(sorted(student_groups(current))),
                    percent=marks_percent(current) if level in _intermediate_levels() else None,
                    readable=education_readable(education_records),
                    field=field_code if level in group_rules()["degree_levels"] else None)


# ---- the verdict for one field --------------------------------------------------

def _group(code: str) -> dict:
    return {"code": code, "label": vault_catalog().label("intermediate_groups", code)}


def _route_group(code: str) -> dict:
    """A group as a Matric student would choose it, with the qualification
    that carries it: "FSc Pre-Engineering", or "ICS" where the level is the
    group (group_rules from_level)."""
    rules, catalog = group_rules(), vault_catalog()
    own_level = next((level for level, group in rules["from_level"].items() if group == code), None)
    if own_level:
        route = catalog.label("levels", own_level)
    else:
        route = f"{catalog.label('levels', rules['from_field_of_study'][0])} {_group(code)['label']}"
    return {**_group(code), "route_label": route}


def _facts(rule: Rule | None, field_key: str | None, standing: Standing) -> dict:
    if rule is None:
        return {"tests": [], "years": None, "min_percent": None, "student_percent": standing.percent,
                "confidence": None, "sources": [], "subjects": []}
    return {"tests": [asdict(test) for test in rule.tests_for(field_key)], "years": rule.years_for(field_key),
            "min_percent": rule.min_percent, "student_percent": standing.percent,
            "confidence": rule.confidence, "sources": list(rule.sources),
            "subjects": list(rule.required_subjects)}


def _marks(rule: Rule, percent: float | None) -> tuple[list[dict], list[Need], bool]:
    """(reasons, needs, below the floor) for the rule's percent floor."""
    if rule.min_percent is None:
        return [], [], False
    if percent is None:
        return [{"key": "add_marks", "min": rule.min_percent}], [], False
    if percent < rule.min_percent:
        values = {"min": rule.min_percent, "have": percent}
        return [{"key": "needs_percent", **values}], [Need("marks", values)], True
    return [], [], False


def _for_group(field_key: str, rule: Rule, group: str, percent: float | None) -> tuple[str, list, list]:
    study = study_fields()[field_key]
    marks_reasons, marks_needs, below = _marks(rule, percent)
    open_groups = study.open_to if rule.groups_open is None else rule.groups_open
    if group in open_groups:
        return ("step" if below else "open"), marks_reasons, marks_needs
    if rule.groups_open is None and group in study.check:
        return ("step", [{"key": "check", "note": study.check_note}] + marks_reasons,
                [Need("check", {"note": study.check_note})] + marks_needs)
    for step in rule.groups_with_step:
        if step.group == group and (step.scope_fields is None or field_key in step.scope_fields):
            detail = {"text": step.step, "source": step.source}
            return "step", [{"key": "rule_step", **detail}] + marks_reasons, [Need("bridge", detail)] + marks_needs
    return "not_open", [{"key": "not_open_group", "group_code": group, "group_label": _group(group)["label"]}], []


def _choose_group(field_key: str, level: str) -> tuple:
    """Matric / O-level: the field needs an intermediate group first, read from
    the same candidate data the path analyzer uses (needs_group; none listed
    means every intermediate group opens it)."""
    candidate = candidate_fields({"qualification_name": level}).get(field_key)
    if candidate is None:
        return "not_open", [{"key": "not_open_group", "group_code": level,
                             "group_label": vault_catalog().label("levels", level)}], []
    if not candidate.needs_group:
        return "step", [{"key": "choose_any_group"}], [Need("group", {"groups": []})]
    groups = [_route_group(code) for code in candidate.needs_group]
    return "step", [{"key": "choose_group", "groups": groups}], [Need("group", {"groups": groups})]


def verdict(field_key: str | None, standing: Standing) -> Verdict:
    """Status and entry facts for one field from the student's standing; the
    order of checks is: no rule, a degree student, no readable education,
    before intermediate, then each of the student's groups (the best wins)."""
    order = eligibility_policy()["status_order"]
    rule = rule_for(field_key) if field_key in study_fields() else None
    rules = group_rules()
    if rule is None:
        status, reasons, needs = "unknown", [{"key": "cannot_check"}], []
    elif standing.level in rules["degree_levels"]:
        status, reasons, needs = "unknown", [{"key": "undergrad_only"}], []
    elif not standing.readable or not (standing.groups or standing.level in rules["before_intermediate"]):
        status, reasons, needs = "unknown", [{"key": "needs_education"}], []
    elif standing.level in rules["before_intermediate"]:
        status, reasons, needs = _choose_group(field_key, standing.level)
    else:
        results = [_for_group(field_key, rule, group, standing.percent) for group in standing.groups]
        status, reasons, needs = min(results, key=lambda result: order.index(result[0]))
    return Verdict(status=status, reasons=reasons, needs=needs, **_facts(rule, field_key, standing))


def education_line(standing: Standing) -> dict | None:
    """The student's education as data: level, group (or a degree's field) and
    percent with their catalog labels; eligibility.json education_line renders it."""
    if standing.level is None:
        return None
    rules = group_rules()
    if standing.field:
        study = study_fields().get(standing.field)
        groups = [{"code": standing.field, "label": study.title if study else standing.field}]
    elif standing.level in rules["from_level"] or standing.level in rules["before_intermediate"]:
        groups = []  # the level names the group (ICS, FA), or no group is chosen yet (Matric, O-level)
    else:
        groups = [_group(code) for code in standing.groups if code in known_groups()]
    return {"level": standing.level, "level_label": vault_catalog().label("levels", standing.level),
            "groups": groups, "percent": standing.percent}


# ---- the Compare table ----------------------------------------------------------

def education_records(db, workspace_id: str) -> list[dict]:
    """The Vault education records, read exactly as the path analyzer reads
    them, so paths and their eligibility agree."""
    return [card["value"] for card in MemoryService(db).profile_cards(workspace_id) if card["kind"] == "education"]


def compare(db, workspace_id: str, possibility_ids: list[str]) -> dict:
    """The Compare table: each asked-for live path's verdict, in the order
    asked, with when the admission rules were last checked (every rule fact
    shows its sources and confidence). Ids that are not the student's live
    paths are left out."""
    from app.pai_c.possibilities import PossibilityService
    standing = student_standing(education_records(db, workspace_id))
    rows = {row.id: row for row in PossibilityService(db).list(workspace_id) if row.status != "dismissed"}
    paths = []
    for possibility_id in list(dict.fromkeys(possibility_ids))[:50]:
        row = rows.get(possibility_id)
        if row is None:
            continue
        field_key = (row.study_field or {}).get("key")
        paths.append({"id": row.id, "field_key": field_key, "verdict": asdict(verdict(field_key, standing))})
    return {"education_line": education_line(standing), "rules_as_of": rules_as_of(), "paths": paths}
