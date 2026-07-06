import { expect, test } from '@playwright/test';
import { IlmApiClient } from '../../pages/api-client';
import { assertCertificateListShape, assertCertificateShape } from '../../pages/contract';
import { ROOT_CA, ROOT_CA_FIXTURE, pemToBase64 } from '../../pages/certs';

/**
 * Contract tests against the documented Certificate API
 * (https://docs.otilm.com/api/core-certificate). They pin down the response
 * shapes the UI and API tests depend on, so contract drift fails loudly.
 */

let api: IlmApiClient;

test.beforeAll(async () => {
    api = await IlmApiClient.create();
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
});

test.afterAll(async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    await api.dispose();
});

test('POST /v1/certificates/upload returns 201 and { uuid }', async () => {
    const res = await api.rawUpload({ certificate: pemToBase64(ROOT_CA_FIXTURE), customAttributes: [] });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.uuid).toBe('string');
    expect(body.uuid.length).toBeGreaterThan(0);

    // Cleanup for the next assertions (avoid duplicate collisions).
    await api.deleteCertificate(body.uuid);
});

test('POST /v1/certificates/upload/async returns 202 Accepted', async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    const res = await api.rawUploadAsync({ certificate: pemToBase64(ROOT_CA_FIXTURE), customAttributes: [] });
    expect(res.status()).toBe(202);

    // Drain the in-flight async upload: wait until it lands, then remove it, so
    // the background processing cannot collide (duplicate 409) with later tests.
    await expect
        .poll(async () => (await api.findCertificatesByCommonName(ROOT_CA.commonName)).length, {
            message: 'async-uploaded certificate should eventually appear',
            timeout: 15_000,
        })
        .toBeGreaterThan(0);
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
});

test('GET /v1/certificates/{uuid} matches the documented certificate shape', async () => {
    // The async upload above may still be processing; ensure a cert exists.
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    const uuid = await api.uploadCertificate(pemToBase64(ROOT_CA_FIXTURE));

    const detail = await api.getCertificate(uuid);
    assertCertificateShape(detail as unknown as Record<string, unknown>);
    expect(detail.commonName).toBe(ROOT_CA.commonName);
    expect(detail.certificateType).toBe(ROOT_CA.certificateType);
});

test('POST /v1/certificates returns the documented paginated list envelope', async () => {
    const res = await api.rawList({ filters: [], itemsPerPage: 10, pageNumber: 1 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    assertCertificateListShape(body);
    expect(body.itemsPerPage).toBeLessThanOrEqual(1000);
    if (body.certificates.length > 0) {
        assertCertificateShape(body.certificates[0]);
    }
});

test('contract: itemsPerPage above the documented max (1000) is not honored (documented defect)', async () => {
    const res = await api.rawList({ filters: [], itemsPerPage: 5000, pageNumber: 1 });

    // Hard invariant: the request must not blow up server-side either way.
    expect(res.status(), 'oversized itemsPerPage must not be a server error').toBeLessThan(500);

    if (res.status() === 200) {
        const body = await res.json();
        // Soft assertion — the docs cap itemsPerPage at <= 1000, but the API
        // accepts 5000 and echoes it back unclamped (200). This DEFECT is kept
        // visible via expect.soft rather than hidden behind a passing test.
        expect
            .soft(body.itemsPerPage, 'DEFECT: itemsPerPage should be capped at the documented 1000, API echoed back 5000 unclamped')
            .toBeLessThanOrEqual(1000);
    } else {
        // A 4xx rejection would also satisfy the documented contract.
        expect(res.status(), 'oversized itemsPerPage should be a client error').toBeGreaterThanOrEqual(400);
    }
});

test('contract negative: empty certificate must be a 400 Bad Request', async () => {
    const res = await api.rawUpload({ certificate: '', customAttributes: [] });

    // Hard invariant: an empty certificate must be rejected at all.
    expect(res.status(), 'empty certificate must be rejected').toBeGreaterThanOrEqual(400);

    // Soft assertion — the documented contract for invalid input is 400; the
    // API returns 500, so this test goes red to surface the DEFECT while the
    // rest of the suite keeps running.
    expect
        .soft(res.status(), 'DEFECT: empty certificate should be 400 Bad Request, got 500')
        .toBe(400);
});

test('duplicate upload is rejected with 409 and a fingerprint message', async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    const base64 = pemToBase64(ROOT_CA_FIXTURE);

    const first = await api.rawUpload({ certificate: base64, customAttributes: [] });
    expect(first.status()).toBe(201);

    const second = await api.rawUpload({ certificate: base64, customAttributes: [] });
    expect(second.status(), 'duplicate certificate should conflict').toBe(409);
    const body = await second.json();
    expect(body.message).toMatch(/already exists/i);
});

test('contract: customAttributes is required per docs (documented mismatch)', async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    const res = await api.rawUpload({ certificate: pemToBase64(ROOT_CA_FIXTURE) });

    // Soft assertion — the docs mark customAttributes as required, so a missing
    // field should be 400. The API actually accepts it (201); this red flags
    // the docs↔implementation mismatch without blocking the rest of the run.
    expect
        .soft(res.status(), 'MISMATCH: customAttributes is documented as required → expected 400, API returned 201')
        .toBe(400);

    // Whatever the outcome, keep the inventory clean for re-runs.
    if (res.status() === 201) {
        const { uuid } = await res.json();
        await api.deleteCertificate(uuid);
    }
});
