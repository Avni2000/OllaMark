import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { callOllama } from '../utils/ollama';

export const VIEW_TYPE = 'ollamark-sidebar';

export class OllamarkSidebarView extends ItemView {
    private root: ReactDOM.Root | null = null;
    ollamaUrl: string = 'http://localhost:11434';
    ollamaModel: string = 'qwen2.5:14b';

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE;
    }

    getDisplayText() {
        return 'OllaMark Sidebar';
    }

    getIcon() {
        return 'ollamark';
    }

    async onOpen() {
        this.root = ReactDOM.createRoot(this.containerEl.children[1]);
        this.root.render(
            <ChatbotInterface 
                ollamaUrl={this.ollamaUrl}
                ollamaModel={this.ollamaModel}
            />
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
    }
}

interface Message {
    id: string;
    content: string;
    sender: 'user' | 'assistant';
    timestamp: Date;
}

interface ChatbotInterfaceProps {
    ollamaUrl: string;
    ollamaModel: string;
}

function ChatbotInterface({ ollamaUrl, ollamaModel }: ChatbotInterfaceProps) {
    const [messages, setMessages] = React.useState<Message[]>([
        {
            id: '1',
            content: 'Hello! I\'m your Ollama AI assistant. How can I help you today?',
            sender: 'assistant',
            timestamp: new Date(),
        }
    ]);
    const [inputValue, setInputValue] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    React.useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            content: inputValue,
            sender: 'user',
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);

        try {
            const conversationMessages = messages
                .filter(m => m.sender === 'user' || m.sender === 'assistant')
                .map(m => ({
                    role: m.sender === 'user' ? 'user' : 'assistant',
                    content: m.content
                }));
            conversationMessages.push({
                role: 'user',
                content: inputValue
            });

            const response = await callOllama(ollamaUrl, ollamaModel, conversationMessages);

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                content: response,
                sender: 'assistant',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                content: `Error: ${error}`,
                sender: 'assistant',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            padding: '16px',
            gap: '12px',
            backgroundColor: 'var(--background-primary)',
            color: 'var(--text-normal)',
            fontFamily: 'var(--font-text)',
        }}>
            {/* Header */}
            <div style={{
                fontSize: '14px',
                fontWeight: 'bold',
                borderBottom: '1px solid var(--divider-color)',
                paddingBottom: '8px',
            }}>
                Ollama Chat
            </div>

            {/* Messages Container */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                marginBottom: '12px',
            }}>
                {messages.map(message => (
                    <div
                        key={message.id}
                        style={{
                            display: 'flex',
                            justifyContent: message.sender === 'user' ? 'flex-end' : 'flex-start',
                            marginBottom: '8px',
                        }}
                    >
                        <div
                            style={{
                                maxWidth: '80%',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                backgroundColor: message.sender === 'user'
                                    ? 'var(--interactive-accent)'
                                    : 'var(--background-secondary)',
                                color: message.sender === 'user'
                                    ? 'var(--text-on-accent)'
                                    : 'var(--text-normal)',
                                fontSize: '13px',
                                lineHeight: '1.4',
                                wordWrap: 'break-word',
                                whiteSpace: 'pre-wrap',
                            }}
                        >
                            {message.content}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        marginBottom: '8px',
                    }}>
                        <div style={{
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--background-secondary)',
                            color: 'var(--text-muted)',
                            fontSize: '13px',
                        }}>
                            Thinking...
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div style={{
                display: 'flex',
                gap: '8px',
                borderTop: '1px solid var(--divider-color)',
                paddingTop: '12px',
            }}>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    disabled={isLoading}
                    style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '4px',
                        border: '1px solid var(--background-modifier-border)',
                        backgroundColor: 'var(--background-secondary)',
                        color: 'var(--text-normal)',
                        fontSize: '13px',
                        fontFamily: 'var(--font-text)',
                        outline: 'none',
                    }}
                />
                <button
                    onClick={handleSendMessage}
                    disabled={isLoading || !inputValue.trim()}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: 'var(--interactive-accent)',
                        color: 'var(--text-on-accent)',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        opacity: isLoading || !inputValue.trim() ? 0.5 : 1,
                    }}
                >
                    Send
                </button>
            </div>
        </div>
    );
}