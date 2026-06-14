# Auto-generate invert_tem default parameters in README from live schema (same for any processes)

**GitHub Issue:** #12
**State:** open
**Labels:** documentation, enhancement

## Description

_Migrated from deprecated-nagelfluh #16 (originally by @burningsage)_

Problem
The invert_tem parameter defaults in docker/base-runner/aem_processes/README.md are hand-written and will drift as defaults change in the SimPEG source (deps/simpeg/SimPEG/electromagnetics/utils/static_instrument/base.py and dual.py).

Current situation
The live schema with all current defaults is already available via:

API: GET /environments/{env_id}/process-types/invert_tem
MCP: get_process_type_schema_environments__env_id__process_types__type_name__get
This is the same schema the frontend uses to pre-fill forms — it is the authoritative source.

Proposed solution
Add a script (e.g. docs/scripts/update_invert_tem_defaults.py) that:

Calls the process type schema endpoint
Extracts the default values from the returned JSON Schema
Regenerates the parameters block in README.md
The script could be run manually before releases, or wired into CI to keep the README in sync automatically.

Acceptance criteria
[ ] Script exists and can be run standalone
[ ] README parameter block is clearly marked as auto-generated (with a timestamp or "generated from schema")
[ ] The three critical gotcha warnings (URL format, system wrapper, integer cooling_factor) are preserved as hand-written content above/below the auto-generated block
