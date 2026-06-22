"""
Phase 10 — Compliance Forms (AU Precast QC checklists).
Three form_types, all stored in the `compliance_forms` collection:
  - pre_pour       (Form 9.1.2)  — INSPECTION BEFORE CONCRETING
  - post_pour      (Form 9.1.3)  — POST-POUR CHECKLIST
  - compliance_cert (Form 9.1.4) — MANUFACTURER'S CERTIFICATE OF COMPLIANCE

Sections + criteria are extracted verbatim from the source .docx files
(see /tmp/compliance_docs/ — parsed via python-docx).
"""

# Authoritative section schema — built from the docx files at design time.
# Each criterion supports {value, record, notes, checked_by_user_id, checked_by_qa_user_id}.

PRE_POUR_SCHEMA = {
    "title": "Form 9.1.2 — Precast Pre-Pour Checklist",
    "code":  "PRE",
    "sections": [
        {"key": "formwork", "label": "FORMWORK", "criteria": [
            {"key": "dimensions_overall",  "label": "Dimensions (Overall Length x Width)", "value_unit": "mm × mm", "value_required": True},
            {"key": "dimensions_diagonal", "label": "Dimensions (Diagonal)",                "value_unit": "mm",      "value_required": True},
            {"key": "profile_thickness",   "label": "Profile (Thickness)"},
            {"key": "formwork_oil",        "label": "Formwork Oil"},
            {"key": "cleanliness",         "label": "Cleanliness"},
        ]},
        {"key": "reinforcement", "label": "REINFORCEMENT", "criteria": [
            {"key": "bar_size",         "label": "Bar Size — Number, Spacing"},
            {"key": "concrete_cover",   "label": "Concrete Cover"},
            {"key": "starter_bar",      "label": "Starter Bar — Size, Position"},
            {"key": "photograph_taken", "label": "Photograph taken & recorded on file", "supports_photos": True},
        ]},
        {"key": "cast_in_items", "label": "CAST-IN ITEMS", "criteria": [
            {"key": "ferrules",     "label": "Ferrules — Number, Position"},
            {"key": "lifters",      "label": "Lifters — Number, Position"},
            {"key": "grout_tubes",  "label": "Grout Tubes — Number, Position"},
        ]},
        {"key": "other", "label": "OTHER", "criteria": [
            {"key": "recesses_openings", "label": "Recesses, Openings"},
            {"key": "rebates_grooves",   "label": "Rebates, Grooves, Lines"},
            {"key": "panel_id_plate",    "label": "Panel ID Plate"},
            {"key": "form_liners",       "label": "Form Liners"},
        ]},
    ],
    "legend": "= Acceptable, ✗ = To be rectified, NA = Not Applicable",
}

POST_POUR_SCHEMA = {
    "title": "Form 9.1.3 — Precast Post-Pour Checklist",
    "code":  "POST",
    "sections": [
        {"key": "panel", "label": "PANEL", "criteria": [
            {"key": "panel_id_visible",     "label": "Panel ID — Visible"},
            {"key": "panel_weight_visible", "label": "Panel Weight — Visible"},
            {"key": "length_overall",       "label": "Length (Overall)",    "value_unit": "mm", "value_required": True},
            {"key": "width_overall",        "label": "Width (Overall)",     "value_unit": "mm", "value_required": True},
            {"key": "thickness_overall",    "label": "Thickness (Overall)", "value_unit": "mm", "value_required": True},
            {"key": "cleanliness",          "label": "Cleanliness"},
        ]},
        {"key": "concrete_defects", "label": "CONCRETE DEFECTS", "criteria": [],
         "defects_list": True,
         "defects_help": "List any visual defects (honeycombing, cracks, exposed reo, etc.) with location and remedy."},
    ],
    "legend": "= Acceptable, ✗ = To be rectified, NA = Not Applicable",
}

COMPLIANCE_CERT_SCHEMA = {
    "title": "Form 9.1.4 — Manufacturer's Certificate of Compliance",
    "code":  "CERT",
    "header_fields": [
        {"key": "client",                 "label": "Client",                  "required": True},
        {"key": "project",                "label": "Project",                 "required": True},
        {"key": "site_address",           "label": "Site Address",            "required": True},
        {"key": "precast_manufacturer",   "label": "Precast Manufacturer",    "default": "The Paneltec Group"},
        {"key": "project_design_engineer","label": "Project Design Engineer", "required": True},
    ],
    "schedule_of_elements_label": "SCHEDULE OF ELEMENTS",
    "schedule_columns": ["Identification Number", "Casting Date"],
    "declaration_text": ("This is to certify that the above listed precast or tilt-up "
                        "concrete elements have been manufactured in accordance with the "
                        "approved structural and lifting shop drawings."),
    "standards_referenced": ["AS 3850 — Prefabricated concrete elements",
                            "AS 3600 — Concrete structures"],
    "signature_fields": ["Name", "Signature", "Date"],
}

FORM_SCHEMAS = {
    "pre_pour":        PRE_POUR_SCHEMA,
    "post_pour":       POST_POUR_SCHEMA,
    "compliance_cert": COMPLIANCE_CERT_SCHEMA,
}


def empty_sections_for(form_type: str) -> dict:
    """Build an empty sections dict matching the schema for a given form_type."""
    schema = FORM_SCHEMAS[form_type]
    out = {}
    if form_type == "compliance_cert":
        out["header"] = {f["key"]: f.get("default", "") for f in schema["header_fields"]}
        out["schedule_of_elements"] = []  # list of {identification_number, casting_date}
        out["signature"] = {"name": "", "signature": "", "date": ""}
        return out
    for section in schema["sections"]:
        out[section["key"]] = {}
        if section.get("defects_list"):
            out[section["key"]]["_defects"] = []  # list of {location, description, remedy}
        for c in section.get("criteria", []):
            out[section["key"]][c["key"]] = {
                "value": "",
                "record": None,        # "ok" / "rectify" / "na"
                "notes":  "",
                "photos": [] if c.get("supports_photos") else None,
            }
    return out


FORM_TYPE_CODE = {"pre_pour": "PRE", "post_pour": "POST", "compliance_cert": "CERT"}
