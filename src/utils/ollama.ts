export async function callOllama(
    ollamaUrl: string,
    model: string,
    messages: Array<{ role: string; content: string }>
): Promise<string> {
    try {
        const response = await fetch(`${ollamaUrl}/api/chat`, {
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

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.message.content;
    } catch (error) {
        throw new Error(`Failed to call Ollama: ${error}`);
    }
}

export async function* streamOllama(
    ollamaUrl: string,
    model: string,
    messages: Array<{ role: string; content: string }>
) {
    try {
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
                const line = lines[i].trim();
                if (line) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                    } catch (e) {
                        console.error('Error parsing streaming response:', e);
                    }
                }
            }

            // Keep the last incomplete line in buffer
            buffer = lines[lines.length - 1];
        }

        // Process any remaining data
        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer);
                if (data.message?.content) {
                    yield data.message.content;
                }
            } catch (e) {
                console.error('Error parsing final streaming response:', e);
            }
        }
    } catch (error) {
        throw new Error(`Failed to stream from Ollama: ${error}`);
    }
}

export async function getAvailableModels(ollamaUrl: string): Promise<string[]> {
    try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
        console.error(`Failed to fetch models from Ollama: ${error}`);
        return [];
    }
}
