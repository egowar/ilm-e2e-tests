import { Locator, Page, expect } from '@playwright/test';

/**
 * Minimal page object for the Certificates inventory page and the
 * Certificates dashboard. The app uses hash-based routing.
 */
export class CertificatesPage {
    constructor(private readonly page: Page) {}

    async openList(): Promise<void> {
        await this.page.goto('/#/certificates');
        await expect(this.page.getByText('List of Certificates')).toBeVisible();
    }

    async openDashboard(): Promise<void> {
        await this.page.goto('/#/dashboard/certificates');
        await expect(this.page.getByTestId('dashboard-counts')).toBeVisible();
    }

    /**
     * Upload a certificate file through the "Upload Certificate" dialog.
     * The upload endpoint is asynchronous — the certificate appears in the
     * list shortly after the dialog closes.
     */
    async uploadCertificate(filePath: string): Promise<void> {
        await this.page.getByTestId('upload-button').click();
        await expect(this.page.getByRole('heading', { name: 'Upload Certificate' })).toBeVisible();

        await this.page.locator('#__fileUpload__file').setInputFiles(filePath);

        // The client parses the file and shows a preview; the submit button
        // stays disabled until the file content is loaded.
        const submit = this.page.getByTestId('progress-button');
        await expect(submit).toBeEnabled();
        await submit.click();

        await expect(this.page.getByRole('heading', { name: 'Upload Certificate' })).toBeHidden();
    }

    /** Open the "Upload Certificate" dialog without submitting. */
    async openUploadDialog(): Promise<void> {
        await this.page.getByTestId('upload-button').click();
        await expect(this.page.getByRole('heading', { name: 'Upload Certificate' })).toBeVisible();
    }

    dialogHeading(): Locator {
        return this.page.getByRole('heading', { name: 'Upload Certificate' });
    }

    submitButton(): Locator {
        return this.page.getByTestId('progress-button');
    }

    /** Attach a file to the (hidden) upload input in the open dialog. */
    async attachFile(filePath: string): Promise<void> {
        await this.page.locator('#__fileUpload__file').setInputFiles(filePath);
    }

    async cancelDialog(): Promise<void> {
        await this.page.getByRole('button', { name: 'Cancel' }).click();
    }

    /** Link to the certificate detail inside the list table. */
    rowLink(commonName: string): Locator {
        return this.page.getByTestId('custom-table').getByRole('link', { name: commonName });
    }

    /**
     * Wait until a row with the given Common Name shows up, reloading the
     * list to pick up the asynchronously processed upload.
     */
    async waitForCertificateRow(commonName: string, timeoutMs = 60_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            if (await this.rowLink(commonName).first().isVisible()) return;
            if (Date.now() > deadline) {
                throw new Error(`Certificate "${commonName}" did not appear in the list within ${timeoutMs} ms`);
            }
            await this.page.waitForTimeout(2_000);
            await this.page.reload();
            await expect(this.page.getByText('List of Certificates')).toBeVisible();
        }
    }

    /** The table row containing the given Common Name link. */
    row(commonName: string): Locator {
        return this.page
            .getByTestId('custom-table')
            .locator('tr')
            .filter({ has: this.page.getByRole('link', { name: commonName }) });
    }

    /** "Certificates" count badge value on the dashboard. */
    async dashboardCertificateCount(): Promise<number> {
        const counts = this.page.getByTestId('dashboard-counts');
        await expect(counts).toBeVisible();
        const text = await counts.innerText();
        const match = text.match(/(\d+)\s*Certificates/i) ?? text.match(/Certificates\s*(\d+)/i);
        if (!match) {
            throw new Error(`Could not read Certificates count from dashboard: ${JSON.stringify(text)}`);
        }
        return Number(match[1]);
    }
}
