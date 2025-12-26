import { callOllama } from './ollama';

interface FormatMarkdownOptions {
    ollamaUrl: string;
    model: string;
    text: string;
    noteTitle?: string;
}

function stripCodeFence(output: string): string {
    const fenceMatch = output.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
    return fenceMatch ? fenceMatch[1] : output;
}

export async function formatMarkdownWithAI(options: FormatMarkdownOptions): Promise<string> {
    const { ollamaUrl, model, text, noteTitle } = options;
    const titleLine = noteTitle ? `Title: ${noteTitle}\n` : '';

    const messages = [
        {
            role: 'system',
            content: 'You are a meticulous markdown editor. Improve readability, structure, and formatting without changing meaning. Respond with markdown only.'
        },
        {
            role: 'user',
            content: `${titleLine}Format the following markdown selection:
\n---\n${text}\n---`
        }
    ];

    const response = await callOllama(ollamaUrl, model, messages);
    return stripCodeFence(response.trim());
}
