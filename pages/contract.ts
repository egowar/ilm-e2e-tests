import { expect } from '@playwright/test';

/**
 * Lightweight response-schema checks — no external schema library.
 * Enough to catch contract drift against the documented Certificate API
 * (https://docs.otilm.com/api/core-certificate) without over-engineering.
 */

type FieldType = 'string' | 'number' | 'boolean';

function checkField(obj: Record<string, unknown>, field: string, type: FieldType): void {
    expect(obj, `field "${field}" missing`).toHaveProperty(field);
    expect(typeof obj[field], `field "${field}" should be ${type}`).toBe(type);
}

/** Required fields of a certificate detail / list item per the API docs. */
export function assertCertificateShape(cert: Record<string, unknown>): void {
    checkField(cert, 'uuid', 'string');
    checkField(cert, 'commonName', 'string');
    checkField(cert, 'serialNumber', 'string');
    checkField(cert, 'notBefore', 'string');
    checkField(cert, 'notAfter', 'string');
    checkField(cert, 'publicKeyAlgorithm', 'string');
    checkField(cert, 'signatureAlgorithm', 'string');
    checkField(cert, 'state', 'string');
    checkField(cert, 'certificateType', 'string');
    checkField(cert, 'subjectDn', 'string');
    checkField(cert, 'issuerDn', 'string');
    checkField(cert, 'fingerprint', 'string');
}

/** Paginated list envelope shape for POST /v1/certificates. */
export function assertCertificateListShape(body: Record<string, unknown>): void {
    expect(Array.isArray(body.certificates), 'certificates should be an array').toBe(true);
    checkField(body, 'totalItems', 'number');
    checkField(body, 'totalPages', 'number');
    checkField(body, 'itemsPerPage', 'number');
    checkField(body, 'pageNumber', 'number');
}

/**
 * Error bodies should be a clean { message } (or { errors }) object and must
 * NOT leak a Java stack trace / internal exception details.
 */
export function assertCleanErrorBody(text: string): void {
    expect(text, 'error body should not leak a stack trace').not.toContain('\tat ');
    expect(text, 'error body should not leak exception class names').not.toMatch(/Exception:.*\n\s*at /);
}
