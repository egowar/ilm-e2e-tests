# ILM E2E Tests — Certificate Import

Automated Playwright + TypeScript tests for the ILM platform covering the take-home scenario:

> Import an X.509 certificate and verify it was processed correctly
> (correct Common Name and certificate type, visible in the list, reflected on the Certificates Dashboard).

**The assignment asks for one automated test — that test is
`tests/ui/certificate-import.spec.ts`, and it is what `npm test` runs.**
Everything else in this repo (an API-level variant, contract checks, security
probes, UI negatives) is an optional extension kept deliberately separate under
`npm run test:extended`, so the core deliverable stays exactly as scoped. See
[Beyond the assignment](#beyond-the-assignment-optional) for why those extras
exist at all.

## Prerequisites

The ILM platform must be running locally, set up per the
[Local Environment Setup guide](https://docs.otilm.com/docs/qa-strategy/local-setup):

- Backend services via Docker Compose (Core API at `http://localhost:8280`)
- Administrator frontend at `http://localhost:5173` (Vite dev server with
  `src/setupProxy.js` injecting the dummy admin certificate)
- Node.js 18+

## Install

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm test               # THE assignment test: UI E2E certificate-import scenario
npm run test:headed    # same test, watching the browser
npm run test:extended  # optional extras: API variant, contract, security, UI negatives
npm run test:ui        # Playwright UI mode
npm run report         # open the last HTML report
```

> Note on the extended run: it contains **three intentionally red tests** that
> document real server-side defects found during the work (see
> [Findings](#findings-documented-defects--extended-suite-only)). `npm test`
> itself is green.

Environment overrides (optional):

| Variable   | Default                 | Purpose                       |
| ---------- | ----------------------- | ----------------------------- |
| `BASE_URL` | `http://localhost:5173` | Frontend under test           |
| `API_URL`  | `http://localhost:8280` | Core API (cleanup and checks) |

## The assignment test — `tests/ui/certificate-import.spec.ts`

One UI E2E test that walks the whole user journey:

1. **Setup (API):** delete any leftover `Dummy Root CA` certificates, record the
   current `totalCertificates` statistic as the baseline.
2. **Import (UI):** open `/#/certificates`, open the *Upload Certificate* dialog,
   attach `test-data/certs/root-ca.cert.pem`, submit.
3. **List (UI):** poll the list until the new row appears (the upload endpoint is
   asynchronous), assert the Common Name link and the `X.509` type badge.
4. **Stored entity (API):** fetch the certificate detail and assert
   `commonName`, `certificateType` and `subjectDn`.
5. **Dashboard (UI + API):** assert `totalCertificates` grew by exactly 1 and the
   dashboard *Certificates* count badge shows the same number.
6. **Teardown (API):** delete the imported certificate so re-runs start clean.

### Approach and reasoning

**Primary test at the UI level, with the REST API for setup/cleanup and cross-verification.**

- The assignment describes a *user* journey — import through the Administrator UI,
  see the certificate in the list and on the dashboard. Only a browser test
  exercises that end-to-end path, including the upload dialog, client-side PEM
  parsing, async-processing UX and dashboard rendering.
- The API is used where the UI would be slow or flaky, not for the journey itself:
  - **Cleanup** — deleting the certificate by Common Name before and after each
    run makes the suite idempotent; without it a second run would collide with
    the previously imported (identical) certificate.
  - **Cross-verification** — asserting `commonName`/`certificateType` on the
    stored entity via `GET /v1/certificates/{uuid}` is a stronger check than
    reading a table cell, and pins down *what* is stored rather than *how it is
    rendered*.
- **Deliberately kept small:** one page object (`CertificatesPage`), one API
  client (`IlmApiClient`), no custom fixtures framework, no BDD layer, no
  multi-browser matrix — the scenario does not need them, and less machinery
  means less to maintain and review.

### Assumptions and decisions

- **Certificate under test:** the public *Dummy Root CA*
  (`CN=Dummy Root CA`) from `OmniTrustILM/helm-charts`, as required by the
  assignment. Its expected properties are pinned in `pages/certs.ts`.
- **Authentication:** the platform authenticates via the `ssl-client-cert`
  header carrying the URL-encoded base64 certificate. The browser gets it from
  the Vite proxy (`setupProxy.js`); the API client in these tests builds the
  same header from `test-data/auth/admin.cert.pem` (a public dummy certificate
  from the same repository — no real secret is committed).
- **Async upload:** the UI uses `POST /v1/certificates/upload/async`; the list
  may not show the certificate immediately. The test polls with reloads
  (60 s budget) instead of relying on a fixed sleep.
- **Serial execution:** `workers: 1` because the tests mutate shared platform
  state (certificate inventory and statistics).
- **Selectors:** stable attributes found in the frontend source —
  `data-testid="upload-button"`, `#__fileUpload__file`,
  `data-testid="progress-button"`, `data-testid="dashboard-counts"` — plus
  role/name lookups for links and dialog headings.
- **Dashboard assertion:** the dashboard is fed by `GET /v1/statistics`; the
  test asserts both the API value and the rendered count badge, comparing
  against a baseline captured before the import (exact `+1`, not just "grew").

## Beyond the assignment (optional)

The assignment asks for one test, and that is what `npm test` delivers. While
building it I had to touch the REST API anyway (cleanup, cross-checks), and a
few cheap, high-signal checks fell out of that work — including **two real
defects**. Rather than inflating the core deliverable or throwing the findings
away, these live in a separate, clearly optional suite:

```bash
npm run test:extended
```

```
tests/
  ui/
    certificate-import.spec.ts     # ← THE assignment test (npm test)
    ui-negative.spec.ts            # extended: UI negatives (invalid file, empty submit, cancel)
  api/
    certificate-import-api.spec.ts # extended: API-level variant of the scenario
    api-contract.spec.ts           # extended: response schema + contract negatives
    api-security.spec.ts           # extended: OWASP API Top 10 focused checks
pages/
  api-client.ts        # thin Core REST client + raw (non-asserting) probes
  certificates-page.ts # page object for the Certificates list / dashboard / upload dialog
  certs.ts             # test-data paths, PEM→base64 helper, negative payloads
  contract.ts          # lightweight response-shape assertions
test-data/
  certs/root-ca.cert.pem  # the certificate under test (imported & asserted on)
  auth/admin.cert.pem     # API-client credential (test infrastructure, not a test subject)
```

> Naming note: this is called `test-data/`, not `fixtures/`, because
> "fixtures" is a reserved Playwright concept (`test.extend()`-based
> dependency injection). Naming a folder of static PEM files `fixtures/`
> would collide with that meaning.

### Test levels — why each check lives where it does

The rule applied: **test each concern at the cheapest level that still proves
it**, and keep the browser only for what is genuinely a UI concern.

| Concern | Level | Where | Why here |
| --- | --- | --- | --- |
| User can import a cert and see it in the list + dashboard | UI E2E | `ui/certificate-import.spec.ts` | The requirement is a user journey; only a browser exercises the dialog, PEM parsing, async UX and dashboard rendering. |
| What gets stored (CN, type, subjectDn) | API | both happy-path specs | Asserting the stored entity is stronger and less brittle than reading a table cell. |
| Business logic (import → stored → counted) | API | `certificate-import-api.spec.ts` | Runs in seconds; first CI signal if the backend breaks, independent of the frontend. |
| Authentication / object access / error handling | API | `api-security.spec.ts` | Security invariants live at the API boundary; driving them through the UI adds no value and hides the status codes. |
| Response shapes vs. docs | API | `api-contract.spec.ts` | Contract is an API property; pinning it here makes drift fail loudly and cheaply. |
| Client-side guards (bad file, empty/cancel) | UI | `ui-negative.spec.ts` | These are genuinely front-end behaviors, cross-checked via the API so a UI regression can't silently create data. |

### Security checks (OWASP API Security Top 10, 2023)

Scoped to what is actually reachable from the certificate-import feature
(`tests/api/api-security.spec.ts`):

- **API2 — Broken Authentication.** The whole platform authenticates via the
  `ssl-client-cert` header. Tests assert: no header → `401`; garbage header
  (`not-a-certificate`) → `401`; a raw (non-URL-encoded) base64 certificate →
  rejected; and a control case where the valid admin certificate → `200`. The
  control matters: it proves the negatives fail for the *right* reason.
- **API1 / API3 — Object access.** `GET /v1/certificates/{uuid}` with a
  non-existent UUID returns `404` (not a `500` leak); a malformed UUID returns
  `400`. Both error bodies are asserted to be clean (no stack trace).
- **API3 — Excessive data exposure.** The certificate detail response is
  asserted to contain no private-key material.
- **API8 — Security Misconfiguration.**
  - *Mass assignment:* an upload body with injected `uuid`, `owner`,
    `trustedCa` fields is accepted (`201`) but the server assigns its own UUID
    and ignores the attacker-controlled fields.
  - *Error leakage:* malformed certificate content is rejected and the body is a
    generic `{"message": ...}` with no stack trace / exception class names.

**Consciously out of scope** (documented, not implemented): true object-level
authorization (BOLA) and the documented `403` branch need a second,
lower-privilege identity, which the local environment does not provide — marked
with `test.fixme` in the suite. Likewise rate limiting, request-size / DoS
limits, TLS scanning and a full authorization matrix belong to a dedicated
security engagement and are listed as next steps rather than silently skipped.
Only the certificate auth path is tested (docs also list JWT and session auth).

### Contract checks

`tests/api/api-contract.spec.ts` validates responses against
[the documented Certificate API](https://docs.otilm.com/api/core-certificate)
using lightweight type-guards in `pages/contract.ts` (no external schema library —
the surface is small and a full JSON-schema toolchain would be over-engineering):

- `POST /v1/certificates/upload` → `201`, body `{ uuid: string }`.
- `POST /v1/certificates/upload/async` → `202`.
- `GET /v1/certificates/{uuid}` → all documented fields present with the right
  types (`uuid, commonName, serialNumber, notBefore, notAfter,
  publicKeyAlgorithm, signatureAlgorithm, state, certificateType, subjectDn,
  issuerDn, fingerprint`).
- `POST /v1/certificates` (list) → the paginated envelope
  (`certificates[], totalItems, totalPages, itemsPerPage, pageNumber`),
  `itemsPerPage <= 1000` per the docs; an oversized `itemsPerPage: 5000` must
  be either rejected (4xx) or clamped, never honored.
- Negatives: empty certificate rejected; duplicate upload → `409` with an
  "already exists / fingerprint" message; `customAttributes` accepted as
  optional (see findings).

### Findings (documented defects — extended suite only)

Two real discrepancies were found. Rather than hiding them behind a green
annotation, the affected tests assert the **correct** documented contract with a
**soft assertion** (`expect.soft`). Effect: the extended suite reports these as
failures (red), so the bugs are visible, while the genuine security invariants
are still checked with hard assertions and the rest of the run continues.

> The three soft failures below are **expected and intentional** — they document
> server-side defects, not broken tests. They will turn green automatically once
> the API is fixed. `npm test` (the assignment test) is not affected.

1. **Invalid input returns `500`, not `400`.** Empty / garbage / unparseable
   certificate content is answered with `HTTP 500 {"message":"Internal server
   error."}`. Hard-asserted invariants (request rejected, no stack-trace leak)
   pass; the soft assertion for `400 Bad Request` fails to flag the defect.
   Covered in `api-security.spec.ts` (garbage) and `api-contract.spec.ts` (empty).
2. **`customAttributes` documented as required but optional in practice.**
   `POST /v1/certificates/upload` with only `{ certificate }` succeeds (`201`)
   although the docs mark `customAttributes` as required. The soft assertion for
   `400` flags the docs↔implementation mismatch. Covered in
   `api-contract.spec.ts`.

Why soft, not hard: a hard `expect` would stop the test at the first mismatch and
we would lose the follow-up invariant checks (e.g. "error body does not leak a
stack trace"). `expect.soft` keeps every assertion running in a single pass.
(Alternative: `test.fail()` would keep CI green while tracking the bug — chosen
against here because the goal is to make the defects *visible*.)

### Negative & exploratory (manual) checks

Automated UI negatives live in `ui-negative.spec.ts` (submit disabled without
content, invalid file creates nothing, Cancel creates nothing — each
cross-checked via `GET /v1/statistics`). A few things are more efficient to
verify by hand and are listed here rather than automated:

- Drag-and-drop upload (vs. the file picker) in the dialog.
- The certificate detail page fields after clicking a row.
- Interaction with the dashboard donut charts (filter by type / state).
- Uploading a very large / malformed file and observing the UI error surface.

### Recommendation: `data-testid` in `fe-administrator`

The tests intentionally do **not** modify the frontend and get by with existing
`data-testid`s and role/label lookups. To make the UI tests more robust and
readable, consider adding stable hooks in `fe-administrator`:

- the upload dialog container and its **Submit**/**Cancel** buttons
  (`data-testid="upload-dialog"`, the submit already exposes
  `progress-button` — a dedicated `upload-submit` would be clearer);
- table **rows keyed by fingerprint** (`data-testid="cert-row-<fingerprint>"`)
  so a row can be located unambiguously instead of by Common Name text;
- the inline **validation error** shown for a bad file, so the negative test can
  assert the message instead of only the absence of a created certificate.

Rationale: role/label selectors are readable but can break on i18n or copy
changes; fingerprint-keyed rows remove ambiguity when multiple certs share a CN.

## Setup notes / workarounds

Per the assignment ("*If something in the setup doesn't work as described,
document what you tried and how you worked around*"), the issues hit while
bringing the environment up and the fixes applied:

- **Xcode Command Line Tools installer looped on macOS 26.** The stub
  `/usr/bin/git` kept triggering a CLT install dialog that never completed, so
  `git` was unusable. *Workaround:* installed a self-contained `git` via
  Miniforge and put it first on `PATH` (`~/.zshenv`, `~/.zshrc`, Cursor's
  integrated-terminal `PATH`), plus symlinks in `~/bin`, bypassing the Apple
  stub.
- **Node 22 instead of the guide's Node 20.** `fe-administrator`'s Vite /
  openapi-generator tooling warned on Node 20; upgraded to Node 22.14.
- **Frontend `npm ci` failed on a rolldown native binding.** After the Node
  upgrade the pre-built `rolldown` binary expected Node 20. *Workaround:*
  removed `node_modules` + `package-lock.json` and re-ran `npm ci` to regenerate
  a lockfile matching Node 22.
- **Playwright Chromium not found on first run.** `npx playwright install` had
  cached the browser in a non-persistent sandbox path. *Workaround:* re-ran the
  install outside the sandbox so it landed in `~/Library/Caches/ms-playwright`.
- **API auth for the tests.** The browser gets the `ssl-client-cert` header from
  the Vite dev-server proxy (`setupProxy.js`); the test API client reproduces the
  same header from the public `test-data/auth/admin.cert.pem` so API
  setup/cleanup and security probes work without the browser.
