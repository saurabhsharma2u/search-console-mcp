import * as clack from '@clack/prompts';

/**
 * UI-agnostic prompt adapter.
 *
 * Business logic (setup flows) must import from here, never from
 * @clack/prompts directly, so the UI layer can be swapped or faked in tests.
 *
 * Drivers:
 *  - ClackDriver: interactive rendering (TTY)
 *  - NonInteractiveDriver: fails fast unless a default satisfies the prompt
 *  - ScriptedDriver (tests): setPromptDriver(new ScriptedDriver([...]))
 */

export interface SelectOption<T = string> {
    value: T;
    label: string;
    hint?: string;
}

export interface TextOptions {
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
}

export interface PromptDriver {
    select<T>(message: string, options: SelectOption<T>[]): Promise<T>;
    multiselect<T>(message: string, options: SelectOption<T>[], required?: boolean): Promise<T[]>;
    text(message: string, opts?: TextOptions): Promise<string>;
    confirm(message: string, initial?: boolean): Promise<boolean>;
}

export class CancelledError extends Error {
    constructor() {
        super('Cancelled');
        this.name = 'CancelledError';
    }
}

export class InteractiveRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InteractiveRequiredError';
    }
}

// clack's Option<T> is a distributive conditional type that TS can't
// reconcile with a generic mapped array, so the mapping is cast explicitly.
function toClackOptions<T>(options: SelectOption<T>[]) {
    return options.map(o => ({
        value: o.value,
        label: o.label,
        ...(o.hint !== undefined && { hint: o.hint }),
    })) as any;
}

class ClackDriver implements PromptDriver {
    async select<T>(message: string, options: SelectOption<T>[]): Promise<T> {
        const result = await clack.select({
            message,
            options: toClackOptions(options),
        });
        if (clack.isCancel(result)) throw new CancelledError();
        return result as T;
    }

    async multiselect<T>(message: string, options: SelectOption<T>[], required = false): Promise<T[]> {
        const result = await clack.multiselect({
            message,
            options: toClackOptions(options),
            required,
        });
        if (clack.isCancel(result)) throw new CancelledError();
        return result as T[];
    }

    async text(message: string, opts: TextOptions = {}): Promise<string> {
        const result = await clack.text({
            message,
            placeholder: opts.placeholder,
            defaultValue: opts.defaultValue,
            validate: opts.validate ? (v) => {
                // Empty submit takes the defaultValue — don't reject it.
                if (!v && opts.defaultValue !== undefined) return undefined;
                return opts.validate!(v || '') || undefined;
            } : undefined,
        });
        if (clack.isCancel(result)) throw new CancelledError();
        return (result as string) ?? '';
    }

    async confirm(message: string, initial = true): Promise<boolean> {
        const result = await clack.confirm({ message, initialValue: initial });
        if (clack.isCancel(result)) throw new CancelledError();
        return result === true;
    }
}

export class NonInteractiveDriver implements PromptDriver {
    async select<T>(message: string, _options: SelectOption<T>[]): Promise<T> {
        throw new InteractiveRequiredError(
            `"${message}" requires an interactive terminal, or an explicit flag/default.`
        );
    }

    async multiselect<T>(message: string, _options: SelectOption<T>[], _required = false): Promise<T[]> {
        throw new InteractiveRequiredError(
            `"${message}" requires an interactive terminal, or an explicit flag/default.`
        );
    }

    async text(message: string, opts: TextOptions = {}): Promise<string> {
        if (opts.defaultValue !== undefined) return opts.defaultValue;
        throw new InteractiveRequiredError(
            `"${message}" requires an interactive terminal, or an explicit flag/default.`
        );
    }

    async confirm(_message: string, initial = false): Promise<boolean> {
        return initial;
    }
}

const defaultDriver = (): PromptDriver =>
    process.stdout.isTTY ? new ClackDriver() : new NonInteractiveDriver();

let activeDriver: PromptDriver = defaultDriver();

/** Swap the active driver (used by tests and non-interactive flag handling). */
export function setPromptDriver(driver: PromptDriver | null): void {
    activeDriver = driver ?? defaultDriver();
}

export const prompts = {
    select<T>(message: string, options: SelectOption<T>[]): Promise<T> {
        return activeDriver.select(message, options);
    },
    multiselect<T>(message: string, options: SelectOption<T>[], required = false): Promise<T[]> {
        return activeDriver.multiselect(message, options, required);
    },
    text(message: string, opts?: TextOptions): Promise<string> {
        return activeDriver.text(message, opts);
    },
    confirm(message: string, initial = true): Promise<boolean> {
        return activeDriver.confirm(message, initial);
    },
};

/**
 * Run an async task behind a spinner (interactive) or plain stderr lines (non-TTY).
 */
export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
    if (!process.stdout.isTTY) {
        console.error(`${message}...`);
        try {
            const result = await task();
            console.error('Done.');
            return result;
        } catch (e) {
            console.error(`Failed: ${(e as Error).message}`);
            throw e;
        }
    }

    const s = clack.spinner();
    s.start(message);
    try {
        const result = await task();
        s.stop(message.replace(/\.\.\.$/, ''));
        return result;
    } catch (e) {
        s.stop(`Failed: ${(e as Error).message}`);
        throw e;
    }
}
