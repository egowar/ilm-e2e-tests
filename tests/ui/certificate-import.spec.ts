import { expect, test } from '@playwright/test';
import { IlmApiClient } from '../../pages/api-client';
import { CertificatesPage } from '../../pages/certificates-page';
import { ROOT_CA, ROOT_CA_FIXTURE } from '../../pages/certs';

/**
 * Scenario (assignment): Import a certificate and verify it appears correctly.
 *
 * Given the platform is running and the user is authenticated as Administrator
 * When the user imports a certificate (UI upload dialog)
 * Then the certificate is stored in the platform
 * And the certificate properties are correct (Common Name, certificate type)
 * And the Certificates Dashboard reflects the newly imported certificate
 *
 * The UI drives the user journey; the REST API is used for cleanup
 * (idempotent re-runs) and for verifying the stored entity directly.
 */

let api: IlmApiClient;
let certificatesBefore: number;

test.beforeAll(async () => {
    api = await IlmApiClient.create();
    // Idempotency: remove leftovers from previous runs before measuring the baseline.
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    certificatesBefore = (await api.getStatistics()).totalCertificates;
});

test.afterAll(async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    await api.dispose();
});

test('import a certificate via UI and verify list, stored data and dashboard', async ({ page }) => {
    const certificates = new CertificatesPage(page);

    await test.step('import the certificate through the upload dialog', async () => {
        await certificates.openList();
        await certificates.uploadCertificate(ROOT_CA_FIXTURE);
    });

    await test.step('certificate appears in the list with correct CN and type', async () => {
        // Upload is processed asynchronously — poll the list.
        await certificates.waitForCertificateRow(ROOT_CA.commonName);
        await expect(certificates.rowLink(ROOT_CA.commonName)).toBeVisible();
        await expect(certificates.row(ROOT_CA.commonName).first()).toContainText(ROOT_CA.certificateType);
    });

    await test.step('certificate is stored with correct properties (API cross-check)', async () => {
        const stored = await api.findCertificatesByCommonName(ROOT_CA.commonName);
        expect(stored, 'exactly one imported certificate expected').toHaveLength(1);

        const detail = await api.getCertificate(stored[0].uuid);
        expect(detail.commonName).toBe(ROOT_CA.commonName);
        expect(detail.certificateType).toBe(ROOT_CA.certificateType);
        expect(detail.subjectDn).toContain(ROOT_CA.commonName);
    });

    await test.step('dashboard reflects the newly imported certificate', async () => {
        await expect
            .poll(async () => (await api.getStatistics()).totalCertificates, {
                message: 'totalCertificates should grow by 1',
                timeout: 30_000,
            })
            .toBe(certificatesBefore + 1);

        await certificates.openDashboard();
        const shownCount = await certificates.dashboardCertificateCount();
        expect(shownCount).toBe(certificatesBefore + 1);
    });
});
