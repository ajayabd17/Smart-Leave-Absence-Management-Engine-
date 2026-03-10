from lib import days_between, overlaps


def test_days_between_inclusive():
    assert days_between("2026-03-10", "2026-03-10") == 1
    assert days_between("2026-03-10", "2026-03-12") == 3


def test_overlap():
    assert overlaps("2026-03-10", "2026-03-12", "2026-03-12", "2026-03-14")
    assert not overlaps("2026-03-01", "2026-03-03", "2026-03-04", "2026-03-06")
