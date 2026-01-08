import { requestUrl } from 'obsidian';

export async function callOllama(
    ollamaUrl: string,
    model: string,
    messages: Array<{ role: string; content: string }>
): Promise<string> {
    try {
        const response = await requestUrl({
            url: `${ollamaUrl}/api/chat`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
            }),
        });

        if (response.status !== 200) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        interface OllamaChatResponse {
            message: { content: string };
        }
        const data = response.json as OllamaChatResponse;
        return data.message.content;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to call Ollama: ${errorMessage}`);
    }
}

export async function* streamOllama(
    ollamaUrl: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    abortSignal?: AbortSignal
) {
    // Note: For streaming, we use fetch because requestUrl doesn't support streaming responses
    // This is acceptable in Obsidian plugins for streaming use cases
    try {
        // eslint-disable-next-line no-restricted-globals
        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Process all complete lines
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i]?.trim();
                if (line) {
                    try {
                        interface StreamChunk {
                            message?: { content?: string };
                        }
                        const data = JSON.parse(line) as StreamChunk;
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                    } catch (parseError) {
                        console.error('Error parsing streaming response:', parseError instanceof Error ? parseError.message : 'Unknown error');
                    }
                }
            }

            // Keep the last incomplete line in buffer
            buffer = lines[lines.length - 1] || '';
        }

        // Process any remaining data
        if (buffer.trim()) {
            try {
                interface StreamChunk {
                    message?: { content?: string };
                }
                const data = JSON.parse(buffer) as StreamChunk;
                if (data.message?.content) {
                    yield data.message.content;
                }
            } catch (parseError) {
                console.error('Error parsing final streaming response:', parseError instanceof Error ? parseError.message : 'Unknown error');
            }
        }
    } catch (error) {
        // If the request was aborted (user clicked stop), don't throw an error
        if (error instanceof Error && error.name === 'AbortError') {
            return;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to stream from Ollama: ${errorMessage}`);
    }
}

interface OllamaModel {
    name: string;
}

interface OllamaTagsResponse {
    models?: OllamaModel[];
}

export async function getAvailableModels(ollamaUrl: string): Promise<string[]> {
    try {
        const response = await requestUrl({
            url: `${ollamaUrl}/api/tags`,
            method: 'GET',
        });
        
        if (response.status !== 200) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = response.json as OllamaTagsResponse;
        return data.models?.map((model) => model.name) || [];
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to fetch models from Ollama: ${errorMessage}`);
        return [];
    }
}
