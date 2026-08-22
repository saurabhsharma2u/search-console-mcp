import { PromptDriver, SelectOption, TextOptions } from '../../src/utils/prompts.js';

/**
 * Deterministic PromptDriver for integration-style setup tests.
 *
 * Strict: unscripted select/multiselect/confirm prompts throw, so a test
 * fails loudly if a flow asks something the test didn't anticipate.
 * `text` falls back to the prompt's defaultValue (e.g. "Press Enter..." steps)
 * before throwing.
 */
export class ScriptedDriver implements PromptDriver {
    selectResponses: any[] = [];
    multiselectResponses: any[][] = [];
    textResponses: string[] = [];
    confirmResponses: boolean[] = [];
    received: string[] = [];

    async select<T>(message: string, options: SelectOption<T>[]): Promise<T> {
        const value = this.selectResponses.shift();
        this.received.push(`select: ${message}`);
        if (value === undefined) throw new Error(`Unexpected select prompt: "${message}"`);
        return value as T;
    }

    async multiselect<T>(message: string, _options: SelectOption<T>[], _required = false): Promise<T[]> {
        const value = this.multiselectResponses.shift();
        this.received.push(`multiselect: ${message}`);
        return value ?? [];
    }

    async text(message: string, opts?: TextOptions): Promise<string> {
        const scripted = this.textResponses.shift();
        this.received.push(`text: ${message}`);
        if (scripted !== undefined) return scripted;
        if (opts?.defaultValue !== undefined) return opts.defaultValue;
        throw new Error(`Unexpected text prompt: "${message}"`);
    }

    async confirm(message: string, _initial = true): Promise<boolean> {
        const value = this.confirmResponses.shift();
        this.received.push(`confirm: ${message}`);
        if (value === undefined) throw new Error(`Unexpected confirm prompt: "${message}"`);
        return value;
    }
}
