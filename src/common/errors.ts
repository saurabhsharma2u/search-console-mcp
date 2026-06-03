import { sanitizeForLog } from '../utils/redaction.js';

/**
 * Error handling utilities for the MCP server
 */

/**
 * Formats an error into an MCP-compatible response
 */
export function formatError(error: unknown): {
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
    [key: string]: unknown;
} {
    const message = getErrorMessage(error);
    const anyError = error as any;

    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
        // Support structured resolution metadata for AI agents
        ...(anyError.code && { errorCode: anyError.code }),
        ...(anyError.resolution && { resolution: anyError.resolution })
    };
}

/**
 * Extracts a user-friendly error message from various error types
 */
function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        // Handle Google API errors
        const anyError = error as any;

        if (anyError.status === 401 || anyError.code === 'UNAUTHORIZED') {
            return sanitizeForLog(error.message || "Authentication failed.");
        }

        if (anyError.status === 403 || anyError.code === 'FORBIDDEN') {
            return sanitizeForLog(error.message || "Forbidden.");
        }

        if (anyError.status === 404 || anyError.code === 'NOT_FOUND') {
            return sanitizeForLog(error.message || "Resource not found.");
        }

        // Rate limiting
        if (anyError.code === 429 || anyError.status === 429) {
            return "Rate limit exceeded. Please wait a moment and try again.";
        }

        // Authentication errors
        if (anyError.code === 401 || anyError.status === 401) {
            return "Authentication failed. Please check your Google credentials.";
        }

        // Permission errors
        if (anyError.code === 403 || anyError.status === 403) {
            return "Permission denied. Ensure you have access to this resource in Google Search Console.";
        }

        // Not found
        if (anyError.code === 404 || anyError.status === 404) {
            return "Resource not found. Please verify the site URL or resource exists.";
        }

        // Google API error with message
        if (anyError.errors && Array.isArray(anyError.errors) && anyError.errors.length > 0) {
            return sanitizeForLog(anyError.errors[0].message || error.message);
        }

        return sanitizeForLog(error.message);
    }

    return sanitizeForLog(String(error));
}
