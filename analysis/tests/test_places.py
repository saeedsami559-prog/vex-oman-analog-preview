"""Checks for the place-name cleaning (analog.places)."""

from analog import places


def test_ascii_names_drop_accents_and_apostrophes():
    assert places.ascii_name("Nizwá") == "Nizwa"
    assert places.ascii_name("Barkā’") == "Barka"
    assert places.ascii_name("‘Ibrī") == "Ibri"


def test_arabic_name_keeps_only_arabic_letters_and_the_shortest():
    assert places.arabic_name(["slalہ", "صلالة"]) == "صلالة"  # Urdu letter rejected
    assert places.arabic_name(["ولاية عبري", "عبري"]) == "عبري"
    assert places.arabic_name(["Nizwa"]) is None


def test_point_in_governorate_and_nearest_town():
    sq = {"type": "Polygon", "coordinates": [[[56, 22], [59, 22], [59, 25], [56, 25], [56, 22]]]}
    p = {"governorates": [{"en": "Ad Dakhiliyah", "ar": "الداخلية", "lat": 23, "lon": 57.5, "geometry": sq}],
         "towns": [["Bahla", "بهلاء", 22.98, 57.3, 2], ["Tiny", None, 23.0, 57.0, 0]]}
    out = places.place_of(23.0, 57.2, p)
    assert out["gov_en"] == "Ad Dakhiliyah" and out["town_en"] == "Bahla"
    assert places.in_geometry(57, 23, sq) and not places.in_geometry(60, 23, sq)
