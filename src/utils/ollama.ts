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
