import { APIRequestContext, APIResponse, expect, request } from '@playwright/test';
import { adminCertHeader } from './certs';

export const API_BASE_URL = process.env.API_URL ?? 'http://localhost:8280';

/**
 * Create a request context with an arbitrary (or missing) `ssl-client-cert`
 * header — used by security tests to probe authentication behavior.
 */
export async function createRawContext(sslClientCert?: string): Promise<APIRequestContext> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (sslClientCert !== undefined) {
        headers['ssl-client-cert'] = sslClientCert;
    }
    return request.newContext({ baseURL: API_BASE_URL, extraHTTPHeaders: headers });
}

export interface CertificateListItem {
    uuid: string;
    commonName: string;
    serialNumber: string;
    fingerprint?: string;
    certificateType: string;
    state: string;
}

export interface CertificateDetail extends CertificateListItem {
    subjectDn: string;
    issuerDn: string;
    publicKeyAlgorithm: string;
    signatureAlgorithm: string;
}

export interface PlatformStatistics {
    totalCertificates: number;
    [key: string]: unknown;
}

/**
 * Thin client for the ILM Core REST API.
 *
 * Talks to the Core backend directly (default http://localhost:8280) and
 * authenticates with the dummy admin certificate via the `ssl-client-cert`
 * header — the same mechanism the frontend dev-server proxy uses.
 */
export class IlmApiClient {
    private constructor(private readonly ctx: APIRequestContext) {}

    static async create(): Promise<IlmApiClient> {
        const ctx = await request.newContext({
            baseURL: API_BASE_URL,
            extraHTTPHeaders: {
                'ssl-client-cert': adminCertHeader(),
                'content-type': 'application/json',
            },
        });
        return new IlmApiClient(ctx);
    }

    async dispose(): Promise<void> {
        await this.ctx.dispose();
    }

    /** Upload a certificate (sync endpoint) and return its uuid. */
    async uploadCertificate(base64Certificate: string): Promise<string> {
        const res = await this.ctx.post('/api/v1/certificates/upload', {
            data: { certificate: base64Certificate, customAttributes: [] },
        });
        expect(res.status(), `upload failed: ${await res.text()}`).toBe(201);
        const body = await res.json();
        return body.uuid as string;
    }

    async getCertificate(uuid: string): Promise<CertificateDetail> {
        const res = await this.ctx.get(`/api/v1/certificates/${uuid}`);
        expect(res.status(), `get certificate failed: ${await res.text()}`).toBe(200);
        return res.json();
    }

    /** List first `itemsPerPage` certificates and filter client-side by CN. */
    async findCertificatesByCommonName(commonName: string): Promise<CertificateListItem[]> {
        const res = await this.ctx.post('/api/v1/certificates', {
            data: { filters: [], itemsPerPage: 100, pageNumber: 1 },
        });
        expect(res.status(), `list certificates failed: ${await res.text()}`).toBe(200);
        const body = await res.json();
        const certificates: CertificateListItem[] = body.certificates ?? [];
        return certificates.filter((c) => c.commonName === commonName);
    }

    async deleteCertificate(uuid: string): Promise<void> {
        const res = await this.ctx.delete(`/api/v1/certificates/${uuid}`);
        expect([200, 204], `delete failed: ${res.status()} ${await res.text()}`).toContain(res.status());
    }

    /** Remove every certificate with the given CN (makes tests idempotent). */
    async deleteCertificatesByCommonName(commonName: string): Promise<number> {
        const matches = await this.findCertificatesByCommonName(commonName);
        for (const cert of matches) {
            await this.deleteCertificate(cert.uuid);
        }
        return matches.length;
    }

    async getStatistics(): Promise<PlatformStatistics> {
        const res = await this.ctx.get('/api/v1/statistics');
        expect(res.status(), `statistics failed: ${await res.text()}`).toBe(200);
        return res.json();
    }

    // ------------------------------------------------------------------
    // Raw (non-asserting) methods — negative / security / contract tests
    // inspect status codes and bodies themselves.
    // ------------------------------------------------------------------

    /** POST /v1/certificates/upload with an arbitrary body; returns the raw response. */
    async rawUpload(body: unknown): Promise<APIResponse> {
        return this.ctx.post('/api/v1/certificates/upload', { data: body });
    }

    /** POST /v1/certificates/upload/async (fire-and-forget endpoint used by the UI). */
    async rawUploadAsync(body: unknown): Promise<APIResponse> {
        return this.ctx.post('/api/v1/certificates/upload/async', { data: body });
    }

    /** Async upload happy-path helper: expects 202 Accepted. */
    async uploadCertificateAsync(base64Certificate: string): Promise<void> {
        const res = await this.rawUploadAsync({ certificate: base64Certificate, customAttributes: [] });
        expect(res.status(), `async upload failed: ${await res.text()}`).toBe(202);
    }

    /** GET an arbitrary API path; returns the raw response. */
    async rawGet(path: string): Promise<APIResponse> {
        return this.ctx.get(path);
    }

    /** POST /v1/certificates (list) with an arbitrary body; returns the raw response. */
    async rawList(body: unknown): Promise<APIResponse> {
        return this.ctx.post('/api/v1/certificates', { data: body });
    }
}
