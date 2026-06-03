export class TenantAuthError extends Error {
    code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND';
    status: number;

    constructor(message: string, code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' = 'FORBIDDEN') {
        super(message);
        this.name = 'TenantAuthError';
        this.code = code;
        this.status = code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 403;
    }
}

export function forbidden(message: string): TenantAuthError {
    return new TenantAuthError(message, 'FORBIDDEN');
}

export function unauthorized(message: string): TenantAuthError {
    return new TenantAuthError(message, 'UNAUTHORIZED');
}

export function notFound(message: string): TenantAuthError {
    return new TenantAuthError(message, 'NOT_FOUND');
}
