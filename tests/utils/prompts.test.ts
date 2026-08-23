import { describe, it, expect, afterEach } from 'vitest';
import {
    prompts, setPromptDriver, CancelledError, InteractiveRequiredError,
    NonInteractiveDriver, type PromptDriver,
} from '../../src/utils/prompts.js';
import { ScriptedDriver } from '../helpers/scripted-driver.js';

afterEach(() => setPromptDriver(null));

describe('prompts adapter', () => {
    it('non-TTY confirm resolves from initial value', async () => {
        // Inject the non-interactive driver explicitly so this suite never
        // depends on process.stdout.isTTY or reads stdin
        setPromptDriver(new NonInteractiveDriver());
        const result = await prompts.confirm('Anything?', true);
        expect(result).toBe(true);
    });

    it('non-TTY text resolves from defaultValue', async () => {
        const result = await prompts.text('Optional field:', { defaultValue: '' });
        expect(result).toBe('');
    });

    it('non-TTY text without defaultValue fails fast', async () => {
        await expect(prompts.text('Required:')).rejects.toThrow(InteractiveRequiredError);
    });

    it('non-TTY select fails fast with actionable message', async () => {
        await expect(prompts.select('Pick one:', [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
        ])).rejects.toThrow(InteractiveRequiredError);
    });

    it('setPromptDriver routes all prompt types to the injected driver', async () => {
        const fake: PromptDriver = new ScriptedDriver();
        setPromptDriver(fake);

        // Unscripted scripted-driver prompts throw, proving calls are routed
        await expect(prompts.select('Q:', [{ value: 1, label: 'one' }])).rejects.toThrow(/Unexpected select/);
        await expect(prompts.confirm('Sure?')).rejects.toThrow(/Unexpected confirm/);
        await expect(prompts.multiselect('Multi:')).resolves.toEqual([]);
        await expect(prompts.text('Type:', { defaultValue: 'x' })).resolves.toBe('x');
    });

    it('scripted driver replays answers in order', async () => {
        const scripted = new ScriptedDriver();
        scripted.selectResponses = ['b'];
        scripted.confirmResponses = [true];
        scripted.textResponses = ['hello'];
        setPromptDriver(scripted);

        expect(await prompts.select('Q:', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }])).toBe('b');
        expect(await prompts.confirm('Star?', false)).toBe(true);
        expect(await prompts.text('Alias:')).toBe('hello');
        expect(scripted.received).toHaveLength(3);
    });

    it('exports error classes for flow-level handling', () => {
        expect(new CancelledError().name).toBe('CancelledError');
        expect(new InteractiveRequiredError('x').name).toBe('InteractiveRequiredError');
    });
});
