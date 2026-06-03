const REDACTION_PATTERNS: RegExp[] = [
    /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /(apikey=)[^&\s]+/gi,
    /((?:api[_-]?key|token|refresh[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
    /sha256:[a-f0-9]{64}/gi,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

export function sanitizeForLog(value: unknown): string {
    let text = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return '';
    for (const pattern of REDACTION_PATTERNS) {
        text = text.replace(pattern, (_match, prefix) =>
            typeof prefix === 'string' && prefix.length > 0 ? `${prefix}[REDACTED]` : '[REDACTED]'
        );
    }
    return text;
}

export function sanitizeArgs(args: unknown[]): string[] {
    return args.map(arg => sanitizeForLog(arg));
}
