import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.resolve(__dirname, '..', 'test-data');

/**
 * The certificate under test — imported through the UI/API and asserted on.
 * Kept separate from auth material below: this file is test *data*, not
 * test *infrastructure*.
 */
export const ROOT_CA_FIXTURE = path.join(TEST_DATA_DIR, 'certs', 'root-ca.cert.pem');

/**
 * The admin credential used to authenticate the API client. This is test
 * *infrastructure* (never asserted on), so it lives under test-data/auth/
 * rather than alongside the certificate that is the actual subject of the
 * tests.
 */
export const ADMIN_CERT_FIXTURE = path.join(TEST_DATA_DIR, 'auth', 'admin.cert.pem');

/** Expected properties of the imported certificate (test-data/certs/root-ca.cert.pem). */
export const ROOT_CA = {
    commonName: 'Dummy Root CA',
    certificateType: 'X.509',
};

/**
 * Extract the base64 DER body from a PEM file (content between
 * BEGIN/END CERTIFICATE markers, newlines stripped). The fixture files
 * contain a human-readable openssl dump before the PEM block, so a plain
 * base64-of-the-whole-file approach would not work.
 */
export function pemToBase64(pemPath: string): string {
    const pem = fs.readFileSync(pemPath, 'utf8');
    const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
    if (!match) {
        throw new Error(`No PEM certificate block found in ${pemPath}`);
    }
    return match[1].replace(/\s+/g, '');
}

/**
 * The platform authenticates API requests via the `ssl-client-cert` header,
 * carrying the URL-encoded base64 certificate (see setup guide, step 7).
 */
export function adminCertHeader(): string {
    return encodeURIComponent(pemToBase64(ADMIN_CERT_FIXTURE));
}

// ---------------------------------------------------------------------
// Negative-test payloads
// ---------------------------------------------------------------------

/** Not a certificate at all — plain garbage text (UI invalid-file fixture). */
export const INVALID_PEM = 'this is definitely not a certificate';

/** Valid base64, but not a parseable DER certificate (API negative fixture). */
export const GARBAGE_B64 = 'Z2FyYmFnZQ==';
