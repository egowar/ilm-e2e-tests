import { expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IlmApiClient } from '../../pages/api-client';
import { CertificatesPage } from '../../pages/certificates-page';
import { INVALID_PEM, ROOT_CA } from '../../pages/certs';

/**
 * UI negative tests for the certificate upload dialog. They guard the
 * client-side guards (submit stays disabled without valid content) and make
 * sure Cancel does not create anything, cross-checked via the API.
 */

let api: IlmApiClient;
let invalidFilePath: string;

test.beforeAll(async () => {
    api = await IlmApiClient.create();
    invalidFilePath = path.join(os.tmpdir(), 'not-a-certificate.pem');
    fs.writeFileSync(invalidFilePath, INVALID_PEM, 'utf8');
});

test.afterAll(async () => {
    await api.deleteCertificatesByCommonName(ROOT_CA.commonName);
    await api.dispose();
    fs.rmSync(invalidFilePath, { force: true });
});

test('submit is disabled while the dialog has no certificate content', async ({ page }) => {
    const certificates = new CertificatesPage(page);
    await certificates.openList();
    await certificates.openUploadDialog();

    await expect(certificates.submitButton()).toBeDisabled();
});

test('uploading a non-certificate file does not create a certificate', async ({ page }) => {
    const certificates = new CertificatesPage(page);
    const before = (await api.getStatistics()).totalCertificates;

    await certificates.openList();
    await certificates.openUploadDialog();
    await certificates.attachFile(invalidFilePath);

    // A non-certificate must not become an uploadable, valid form: either the
    // submit stays disabled, or submitting surfaces an error and stores nothing.
    if (await certificates.submitButton().isEnabled()) {
        await certificates.submitButton().click();
        await page.waitForTimeout(3_000);
    }

    const after = (await api.getStatistics()).totalCertificates;
    expect(after, 'no certificate should be created from invalid input').toBe(before);
});

test('cancelling the dialog creates nothing', async ({ page }) => {
    const certificates = new CertificatesPage(page);
    const before = (await api.getStatistics()).totalCertificates;

    await certificates.openList();
    await certificates.openUploadDialog();
    await certificates.cancelDialog();
    await expect(certificates.dialogHeading()).toBeHidden();

    const after = (await api.getStatistics()).totalCertificates;
    expect(after).toBe(before);
});
