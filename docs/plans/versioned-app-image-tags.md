# Plan: Versioned App Image Tags (replace the floating `:prod` tag)

## Goal

Replace the floating `nagelfluh-backend:prod` / `nagelfluh-frontend:prod` tags — re-pushed with
new content on every `runall-production.sh` run — with a tag that changes whenever the built
content actually changes. This removes the need for the `imagePullPolicy: Always` stopgap applied
today (see Background) and makes redeploys correct by construction instead of by "always re-pull
and hope the registry has the right thing."

## Background — the bug this replaces

`prod/runall-production.sh` (Step 2, Step 5) and `docker/build.sh` (its `db-update-*` Job) all
build/reference the backend and frontend images under the literal tag `"prod"`. Because the tag
never changes, a GKE node that already pulled `nagelfluh-backend:prod` once keeps reusing its
locally cached image on every subsequent deploy unless `imagePullPolicy` forces a re-pull —
`IfNotPresent` (Kubernetes' default for any non-`:latest` tag) does not. This was hit directly: a
plugin bugfix (`plugins/ymerflow-gcp`, commit `e6edab0`) was pushed under the same `:prod` tag, but
the already-failed `nagelfluh-deploy-app` Job's node kept running the pre-fix image, reproducing
the exact same traceback even after every image was deleted locally and in GAR and rebuilt from
scratch.

**Current stopgap** (applied same session, not yet reverted): `image_pull_policy="Always"` added
to three `V1Container` specs in `backend/services/app_deployment.py` (migration Job, backend
Deployment, frontend Deployment) and `imagePullPolicy: Always` added to the two inline Job manifests
in `prod/runall-production.sh` (the `nagelfluh-deploy-app` Job) and `docker/build.sh` (the
`db-update-*` Job). This plan's implementation step 4 reverts all five back toward
`IfNotPresent` (see Design decision 4) once tags are actually content-addressed.

## Design decisions

### 1. Tag = composite hash of main-repo SHA + every local-path plugin's SHA

A plain main-repo git SHA is not sufficient: `plugins/billing`, `plugins/ymerflow-gcp`,
`plugins/ymerflow-minikube` (the paths in `config.env`'s `BACKEND_PLUGINS`) are each their own git
repository, `.gitignore`d from the main repo (`/plugins/` in `.gitignore`). A plugin-only change —
exactly what happened with `e6edab0` — moves nothing in the main repo, so a main-repo-SHA-only tag
would have silently reused the same tag string and reproduced this bug class again, just via a
different mechanism (a genuinely stale tag instead of a caching policy).

The tag is therefore a short hash of a canonical string built from **every relevant repo**: the
main repo, plus every `BACKEND_PLUGINS` entry that is a local directory (`[ -d "$spec" ]`, same test
`scripts/install-backend-plugins.sh` already uses) — entries that are PyPI names or git URLs are
skipped, since those are already pinned by their own specifier and don't need this treatment.

`BACKEND_PLUGINS` entries not installed from a local path (PyPI/git-URL specs) are skipped.

### 2. Correct under a dirty working tree, not just at a clean commit

A commit SHA alone is not enough per-repo either: if a repo has uncommitted changes, two different
uncommitted edits on top of the *same* HEAD commit must not produce the same tag (that would
silently reintroduce this exact bug for the common case of iterating against a live cluster without
committing every change first — the workflow this session was already doing). Each repo's
contribution to the hash input is therefore:

```
git -C <repo> rev-parse HEAD
+ git -C <repo> diff HEAD          (tracked changes, if any)
+ contents of untracked files      (git -C <repo> ls-files --others --exclude-standard)
```

concatenated and included in the overall hash. A clean repo hashes identically across runs (so an
unchanged repo doesn't force a new tag by itself); a dirty repo hashes differently whenever its
actual diff content differs, regardless of HEAD.

### 3. New helper script: `backend/bin/nagelfluh-resolve-app-image-tag`

A single Python entry point (mirroring the `backend/bin/nagelfluh-*` precedent) that:
- Takes the project root and the `BACKEND_PLUGINS` string (same env var already used by
  `scripts/install-backend-plugins.sh`).
- Computes the per-repo fingerprint from Design decisions 1–2 for the main repo and every
  local-path plugin, sorted by path for determinism.
- Hashes the concatenated result (sha256) and prints a short hex tag (12 chars, consistent with
  how git itself displays short SHAs) to stdout.

Centralizing this in one script — rather than duplicating the git plumbing in bash inside both
`prod/runall-production.sh` and `docker/build.sh` — keeps the two build entry points from ever
computing two different tags for what should be the same build.

### 4. Single computation point, threaded everywhere `"prod"` is hardcoded today

`prod/runall-production.sh` computes the tag **once**, near the top (right after `config.env` is
sourced, before Step 2's `docker build`), and exports it as `APP_IMAGE_VERSION`. Every place that
currently hardcodes `"prod"` switches to `"${APP_IMAGE_VERSION}"`:

- `prod/runall-production.sh` line 60 (`docker build -t nagelfluh-backend:prod`)
- `prod/runall-production.sh` lines 184/188 (the two `nagelfluh-build-and-push` calls)
- `docker/build.sh` line 100 (`image_url(config, "nagelfluh-backend", "prod")`)

`docker/build.sh` is invoked as a subprocess from Step 10 of `prod/runall-production.sh` — it reads
`APP_IMAGE_VERSION` from the environment (already exported by its caller) rather than recomputing
it, so both scripts agree on one tag per deploy run. When `docker/build.sh` is invoked standalone
(not from `runall-production.sh`), it falls back to calling
`nagelfluh-resolve-app-image-tag` itself.

Once tags are content-addressed, the `imagePullPolicy: Always` stopgap is no longer needed — revert
all five spots (Background) to `imagePullPolicy: IfNotPresent`, explicitly set with a comment
cross-referencing this plan and `job_orchestrator.py`'s existing `IfNotPresent` precedent (same
reasoning: a tag that never gets reused for different content makes `IfNotPresent` correct and
faster than an unconditional re-pull).

### 5. No floating alias (e.g. `:prod`) — every reference uses the real versioned tag

Nothing pushes or reads a floating tag. `k8s/backend/deployment.yaml` / `k8s/frontend/deployment.yaml`
(the static manual/opt-out manifests for clusters without `supports_app_deployment`, per
`docs/plans/done/app-deployment-hooks.md`) are **out of scope** — they already assume a shared local
Docker daemon (`imagePullPolicy: Never`) and are a different deployment model entirely; leave their
literal `:prod` tag as-is.

### 6. Tag cleanup/retention is out of scope for this plan

You chose to configure Artifact Registry's native cleanup policy (keep-last-N / delete-after-X-days)
instead of scripting deletion here. That's GAR-specific and has no equivalent for the `docker-v2`
self-hosted registry (`plugins/ymerflow-minikube`), so it belongs in a separate,
`plugins/ymerflow-gcp`-local plan (mirroring how `docs/plans/done/registry-backend-hooks.md` kept
GAR-specific work out of the host-repo plan and pointed at a plugin-owned one). This host-repo plan
only needs to *produce* a growing set of distinct tags for that policy to act on — it does not
implement the policy itself.

## Implementation steps

1. `backend/bin/nagelfluh-resolve-app-image-tag` — new script implementing Design decisions 1–3.
2. `prod/runall-production.sh` — compute `APP_IMAGE_VERSION` once near the top, export it, replace
   the three `"prod"` literals (lines 60, 184, 188) with `"${APP_IMAGE_VERSION}"`.
3. `docker/build.sh` — replace the hardcoded `"prod"` literal (line 100) with
   `${APP_IMAGE_VERSION:-$(env/bin/python backend/bin/nagelfluh-resolve-app-image-tag ...)}` so it
   works both threaded-through-from-caller and standalone.
4. `backend/services/app_deployment.py` — change the three `image_pull_policy="Always"` (migration
   Job, backend Deployment, frontend Deployment) to `image_pull_policy="IfNotPresent"`, with a
   comment pointing at this plan.
5. `prod/runall-production.sh` / `docker/build.sh` — change the two inline Job manifests'
   `imagePullPolicy: Always` back to `imagePullPolicy: IfNotPresent`, same comment.
6. Manual verification: run `runall.sh` twice in a row with no source changes and confirm the
   resolved tag is identical both times (proves the hash is stable for an unchanged tree); then make
   a plugin-only change (e.g. touch a file in `plugins/ymerflow-gcp`, commit it there) and confirm
   the tag changes on the next run even though the main repo's own HEAD didn't move.

## Open items

- GAR native cleanup policy — separate plan, `plugins/ymerflow-gcp`'s own repo (Design decision 6).
- Rollback UX (redeploying a previous versioned tag on demand) is not addressed here — this plan
  only fixes correctness of the *current* deploy, not an operator-facing rollback feature.
