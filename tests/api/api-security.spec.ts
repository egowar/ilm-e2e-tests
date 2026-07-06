import { APIRequestContext, expect, test } from '@playwright/test';
import { IlmApiClient, createRawContext } from '../../pages/api-client';
import { assertCleanErrorBody } from '../../pages/contract';
import { GARBAGE_B64, ROOT_CA, ROOT_CA_FIXTURE, adminCertHeader, pemToBase64 } from '../../pages/certs';

/**
 * Security-focused API tests, scoped to the certificate-import feature.
 * Mapped to OWASP API Security Top 10 (2023):
 *   API2 Broken Authentication         — the ssl-client-cert header
 *   API1/API3 Broken Object Level Auth  — GET by uuid access
 *   API8 Security Misconfiguration      — mass assignment, error leakage
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

test.describe('API2 — Broken Authentication (ssl-client-cert header)', () => {
    test('rejects request with no client certificate header', async () => {
        const ctx: APIRequestContext = await createRawContext(undefined);
        const res = await ctx.post('/api/v1/certificates', { data: { filters: [], itemsPerPage: 10, pageNumber: 1 } });
        expect(res.status()).toBe(401);
        await ctx.dispose();
    });

    test('rejects request with a garbage client certificate header', async () => {
        const ctx = await createRawContext('not-a-certificate');
        const res = await ctx.post('/api/v1/certificates', { data: { filters: [], itemsPerPage: 10, pageNumber: 1 } });
        expect(res.status()).toBe(401);
        await ctx.dispose();
    });

    test('rejects a non-URL-encoded (raw base64) certificate header', async () => {
        // The platform expects the base64 cert URL-encoded; raw base64 with
        // "+" characters is interpreted as spaces and must not authenticate.
        const rawBase64 = pemToBase64(ROOT_CA_FIXTURE);
        const ctx = await createRawContext(rawBase64);
        const res = await ctx.post('/api/v1/certificates', { data: { filters: [], itemsPerPage: 10, pageNumber: 1 } });
        expect(res.status(), 'raw base64 header should not authenticate').toBeGreaterThanOrEqual(400);
        await ctx.dispose();
    });

    test('a valid admin certificate IS accepted (control case)', async () => {
        const ctx = await createRawContext(adminCertHeader());
        const res = await ctx.post('/api/v1/certificates', { data: { filters: [], itemsPerPage: 10, pageNumber: 1 } });
        expect(res.status()).toBe(200);
        await ctx.dispose();
    });
});

test.describe('API1/API3 — Object access (GET /v1/certificates/{uuid})', () => {
    test('non-existent uuid returns 404, not a 500 leak', async () => {
        const res = await api.rawGet('/api/v1/certificates/00000000-0000-0000-0000-000000000000');
        expect(res.status()).toBe(404);
        assertCleanErrorBody(await res.text());
    });

    test('malformed uuid returns a 4xx, not a 500', async () => {
        const res = await api.rawGet('/api/v1/certificates/not-a-uuid');
        expect(res.status(), 'malformed uuid should be a client error').toBe(400);
        assertCleanErrorBody(await res.text());
    });

    // True object-level authorization (API1 BOLA) and the documented 403 branch
    // need a second, lower-privilege identity accessing another owner's object.
    // The assessment environment only exposes the admin certificate, so this is
    // a known coverage limit rather than a test we can meaningfully write.
    test.fixme('BOLA: a non-owner identity cannot read another certificate (needs 2nd identity)', () => {});
});

test.describe('API8 — Security misconfiguration', () => {
    test('mass assignment: injected uuid/owner fields are ignored on upload', async () => {
        const res = await api.rawUpload({
            certificate: pemToBase64(ROOT_CA_FIXTURE),
            customAttributes: [],
            // Attacker-controlled fields that must not be trusted:
            uuid: '11111111-1111-1111-1111-111111111111',
            owner: 'attacker',
            trustedCa: true,
        });
        expect(res.status(), `upload failed: ${await res.text()}`).toBe(201);
        const { uuid } = await res.json();

        // The server assigns its own uuid — the injected one is not honored.
        expect(uuid).not.toBe('11111111-1111-1111-1111-111111111111');

        const detail = await api.getCertificate(uuid);
        expect(detail.commonName).toBe(ROOT_CA.commonName);
        // Injected owner must not have been applied.
        expect((detail as unknown as Record<string, unknown>).owner ?? '').not.toBe('attacker');

        // API3 — Excessive data exposure: the detail response must not carry
        // private key material or obvious internal fields.
        const raw = JSON.stringify(detail).toLowerCase();
        for (const secret of [
            'privatekey',
            'private_key',
            'begin private key',
            'begin rsa private key',
            'begin ec private key',
            'begin encrypted private key',
        ]) {
            expect(raw, `response must not expose "${secret}"`).not.toContain(secret);
        }
    });

    test('malformed certificate content is rejected without leaking internals', async () => {
        const res = await api.rawUpload({ certificate: GARBAGE_B64, customAttributes: [] });
        const body = await res.text();

        // Hard invariants (must always hold): the request is rejected and the
        // error body does not leak a stack trace / internal exception details.
        expect(res.status(), 'garbage certificate must be rejected').toBeGreaterThanOrEqual(400);
        assertCleanErrorBody(body);
        expect(body, 'error body should be a generic { message }').toContain('message');

        // Soft assertion — documents a real DEFECT and turns the test red without
        // hiding the invariants above: bad client input must be 400 Bad Request,
        // but the API answers 500 Internal Server Error.
        expect
            .soft(res.status(), 'DEFECT: malformed certificate should be 400 Bad Request, not a 5xx')
            .toBe(400);
    });
});
