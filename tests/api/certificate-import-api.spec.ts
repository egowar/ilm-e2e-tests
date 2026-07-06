import { expect, test } from '@playwright/test';
import { IlmApiClient } from '../../pages/api-client';
import { ROOT_CA, ROOT_CA_FIXTURE, pemToBase64 } from '../../pages/certs';

/**
 * API-level variant of the import scenario. Uses the synchronous upload
 * endpoint (POST /v1/certificates/upload), which returns the uuid directly —
 * fast feedback on the backend contract without the browser.
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

test('upload a certificate via API and verify stored properties', async () => {
    const statsBefore = await api.getStatistics();

    const uuid = await api.uploadCertificate(pemToBase64(ROOT_CA_FIXTURE));
    expect(uuid).toBeTruthy();

    const detail = await api.getCertificate(uuid);
    expect(detail.commonName).toBe(ROOT_CA.commonName);
    expect(detail.certificateType).toBe(ROOT_CA.certificateType);
    expect(detail.subjectDn).toContain(ROOT_CA.commonName);

    // Statistics feeding the Certificates Dashboard include the new certificate.
    await expect
        .poll(async () => (await api.getStatistics()).totalCertificates, { timeout: 30_000 })
        .toBe(statsBefore.totalCertificates + 1);
});
