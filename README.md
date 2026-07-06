# ILM E2E Tests — Certificate Import

Playwright + TypeScript test for the take-home scenario: import an X.509
certificate and verify it's processed correctly (Common Name, certificate
type, list, and Certificates Dashboard).

**The assignment asks for one test — `tests/ui/certificate-import.spec.ts`,
run by `npm test`.
** Everything else (API variant, contract checks, security
checks, UI negatives) is optional and lives under `npm run test:extended`, so
the core deliverable stays exactly as scoped.

## Prerequisites

Platform running locally per the
[Local Environment Setup guide](https://docs.otilm.com/docs/qa-strategy/local-setup):
backend via Docker Compose (Core API `:8280`), Administrator frontend at
`:5173`, Node.js 18+.

## Install & run

```bash
npm install
npx playwright install chromium

npm test               # the assignment test (green)
npm run test:headed    # same, watch the browser
npm run test:extended  # optional: API variant + contract + security + UI negatives
npm run report         # open the last HTML report
```

> `test:extended` contains 4 intentionally red tests documenting 3 real
> server-side defects (see [Findings](#findings)). `npm test` is unaffected.

Env overrides: `BASE_URL` (default `http://localhost:5173`), `API_URL`
(default `http://localhost:8280`).

## The assignment test

`tests/ui/certificate-import.spec.ts` — one UI E2E test:

1. **Setup (API):** delete leftover `Dummy Root CA` certs, record the baseline `totalCertificates`.
2. **Import (UI):** open the certificate list, use the *Upload Certificate* dialog to attach `test-data/certs/root-ca.cert.pem`, submit.
3. **List (UI):** poll until the row appears (upload is async); assert Common Name and `X.509` type.
4. **Stored entity (API):** `GET /v1/certificates/{uuid}` and assert `commonName`, `certificateType`, `subjectDn`.
5. **Dashboard (UI + API):** assert `totalCertificates` grew by exactly 1, both via API and the rendered badge.
6. **Teardown (API):** delete the certificate for a clean re-run.

### Why this approach (UI + API hybrid)

- The requirement is a **user journey** — only a browser test exercises the upload dialog, async UX, and dashboard rendering.
- The **API** is used only where the UI is the wrong tool: idempotent cleanup (can't be done reliably through the UI), and cross-checking *what's stored* rather than *how it's rendered* (a table cell is a weaker check than the actual entity).
- Kept small on purpose: one page object, one API client, no BDD layer, no multi-browser matrix — the scenario doesn't need them.

### Assumptions and decisions

- **Certificate:** public *Dummy Root CA* (`CN=Dummy Root CA`) from `OmniTrustILM/helm-charts`, as required by the assignment.
- **Auth:** platform authenticates via the `ssl-client-cert` header. The API client builds it from `test-data/auth/admin.cert.pem` (public dummy cert, no real secret).
- **Async upload:** the list may lag; the test polls with reloads (60s budget) instead of a fixed sleep.
- **Serial execution** (`workers: 1`): tests mutate shared platform state.
- **Selectors:** existing `data-testid`s + role/label lookups — no frontend changes made.
- **Dashboard check:** compares API statistics and the rendered badge against a baseline captured before import (exact `+1`).

## Beyond the assignment (optional)

Building the API cleanup/cross-checks above cheaply surfaced more coverage —
including two real defects — so it's kept as a separate, clearly optional
suite (`npm run test:extended`) rather than inflating the core deliverable.

```
tests/ui/certificate-import.spec.ts     # ← the assignment test
tests/ui/ui-negative.spec.ts            # extended: bad file / empty submit / cancel
tests/api/certificate-import-api.spec.ts # extended: API-level happy path
tests/api/api-contract.spec.ts           # extended: response schema + contract negatives
tests/api/api-security.spec.ts           # extended: OWASP API Top 10 checks
test-data/certs/root-ca.cert.pem         # the certificate under test
test-data/auth/admin.cert.pem            # API-client credential (not "fixtures/" — that name
                                          # collides with Playwright's own fixture concept)
```

**Test levels:** each concern is tested at the cheapest level that proves it —
UI only for the user journey and client-side guards; API for stored-entity
checks, business logic, contract, and security (status codes shouldn't be
inferred through a browser).

**Security (OWASP API Top 10)**, scoped to what this feature reaches:
auth via `ssl-client-cert` (missing/garbage/non-URL-encoded header → rejected;
valid cert → control case), object access (404/400 without leaking a stack
trace), excessive data exposure (no private-key material in responses), mass
assignment (injected `uuid`/`owner`/`trustedCa` ignored). **Out of scope**
(documented, not silently skipped): true BOLA/403 need a second identity the
env doesn't provide (`test.fixme`); rate-limiting, DoS limits, and a full
auth matrix belong to a dedicated security pass.

**Contract checks** pin response shapes against
[the documented API](https://docs.otilm.com/api/core-certificate) with
lightweight type-guards (`pages/contract.ts`) — no schema library needed for
this surface.

### Findings

Three real defects, found by running against the live platform and kept
**visible** via `expect.soft` (so the run goes red instead of the bug being
hidden or silently skipped):

1. **Invalid input → `500`, not `400`.** Empty/garbage certificate content
   returns `HTTP 500` instead of a `400 Bad Request`. Hard invariants (request
   rejected, no stack-trace leak) still pass.
2. **`customAttributes` required per docs, optional in practice.** Upload
   without it succeeds (`201`) though the docs mark it required.
3. **`itemsPerPage` cap not enforced.** The docs constrain list requests to
   `itemsPerPage <= 1000`; sending `5000` returns `200` with `itemsPerPage: 5000`
   echoed back unclamped instead of being rejected or capped.

### Manual/exploratory (not automated)

Drag-and-drop upload, certificate detail page fields, dashboard donut-chart
interactions, very large/malformed file UI error surface.

### Recommendation for `fe-administrator`

Consider adding `data-testid`s for the upload dialog container/buttons and
table rows keyed by fingerprint (instead of Common Name text) — would make
the UI tests less reliant on role/label lookups.

## Setup workarounds

- **Xcode CLT installer looped on macOS 26** (stub `/usr/bin/git` unusable) → installed `git` via Miniforge, put it first on `PATH`.
- **Node 22 instead of guide's Node 20** — `fe-administrator` tooling warned on Node 20.
- **Frontend `npm ci` failed** on a Node-version-mismatched `rolldown` binary → removed `node_modules`/lockfile, regenerated with `npm ci`.
- **Playwright Chromium not found** on first run (sandboxed cache path) → reinstalled outside the sandbox.
