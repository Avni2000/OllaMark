import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { marked } from 'marked';
import { streamOllama } from '../utils/ollama';
import { ChatStorage, ChatsData, DEFAULT_CHATS_DATA } from '../utils/chatStorage';
import { parseContext, buildContextualPrompt } from '../utils/contextParser';
import { PromptInput } from './PromptInput';
import type MyPlugin from '../main';

export const VIEW_TYPE = 'ollamark-sidebar';

export class OllamarkSidebarView extends ItemView {
    private root: ReactDOM.Root | null = null;
    ollamaUrl: string = 'http://localhost:11434';
    ollamaModel: string = 'qwen2.5:14b';
    plugin: MyPlugin | null = null;
    chatStorage: ChatStorage | null = null;

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

    async initializeChatStorage() {
        if (!this.plugin) {
            console.log('[OllamarkView] No plugin available for chat storage');
            return;
        }
        
        console.log('[OllamarkView] Initializing chat storage...');
        this.chatStorage = new ChatStorage(
            async () => {
                try {
                    const allData = await this.plugin!.loadData() || {};
                    console.log('[OllamarkView] Loaded data:', allData);
                    const chatsData: ChatsData = {
                        chats: allData.chats || [],
                        currentChatId: allData.currentChatId || null
                    };
                    return chatsData;
                } catch (error) {
                    console.error('Error loading chat data:', error);
                    return DEFAULT_CHATS_DATA;
                }
            },
            async (data: ChatsData) => {
                try {
                    const allData = await this.plugin!.loadData() || {};
                    allData.chats = data.chats;
                    allData.currentChatId = data.currentChatId;
                    console.log('[OllamarkView] Saving data:', allData);
                    await this.plugin!.saveData(allData);
                    console.log('[OllamarkView] Data saved successfully');
                } catch (error) {
                    console.error('Error saving chat data:', error);
                }
            }
        );
        await this.chatStorage.load();
        console.log('[OllamarkView] Chat storage initialized');
    }

    async onOpen() {
        this.root = ReactDOM.createRoot(this.containerEl.children[1]);
        
        // Find the plugin from the app - needed when view is restored on reload
        await this.ensurePluginAndStorage();
        
        this.renderComponent();
    }

    async ensurePluginAndStorage() {
        // If plugin isn't set yet, find it from the app
        if (!this.plugin) {
            // The plugin is registered under its manifest id
            const plugin = (this.app as any).plugins?.plugins?.['sample-plugin'];
            if (plugin) {
                this.plugin = plugin;
                this.ollamaUrl = plugin.settings?.ollamaUrl || this.ollamaUrl;
                this.ollamaModel = plugin.settings?.ollamaModel || this.ollamaModel;
                console.log('[OllamarkView] Found plugin from app');
            } else {
                console.log('[OllamarkView] Plugin not found in app.plugins');
            }
        }
        
        // Initialize storage if we have the plugin but not storage yet
        if (this.plugin && !this.chatStorage) {
            await this.initializeChatStorage();
            this.renderComponent();
        }
    }

    renderComponent() {
        if (!this.root) return;
        
        this.root.render(
            <ChatbotInterface 
                ollamaUrl={this.ollamaUrl}
                ollamaModel={this.ollamaModel}
                chatStorage={this.chatStorage}
                app={this.app}
                plugin={this.plugin}
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
    chatStorage: ChatStorage | null;
    app: any;
    plugin: MyPlugin | null;
}

function ChatbotInterface({ ollamaUrl, ollamaModel, chatStorage, app, plugin }: ChatbotInterfaceProps) {
    const getDefaultMessages = (): Message[] => [
        {
            id: '1',
            content: 'Hello! I\'m your markdown writing assistant. I can help you write, format, and structure markdown content for your notes. What would you like to create?',
            sender: 'assistant',
            timestamp: new Date(),
        }
    ];

    const [messages, setMessages] = React.useState<Message[]>(getDefaultMessages());
    const [inputValue, setInputValue] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const [currentChatId, setCurrentChatId] = React.useState<string | null>(null);
    const [allChats, setAllChats] = React.useState<Array<{ id: string; title: string; updatedAt: number }>>([]);
    const [showChatList, setShowChatList] = React.useState(false);
    const [isStorageReady, setIsStorageReady] = React.useState(false);
    const [activeFile, setActiveFile] = React.useState<{ path: string; basename: string } | null>(null);
    const [contextFiles, setContextFiles] = React.useState<Array<{ path: string; basename: string; isActive: boolean }>>([]);
    
    // Track the previous chatStorage to detect when it changes from null to initialized
    const prevChatStorageRef = React.useRef<ChatStorage | null>(null);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const streamingIdRef = React.useRef<string | null>(null);
    const abortControllerRef = React.useRef<AbortController | null>(null);

    // Debug: log messages whenever they change
    React.useEffect(() => {
        console.log('[ChatStorage] Messages state updated:', messages.length, 'messages');
    }, [messages]);

    // Track active file changes in Obsidian
    React.useEffect(() => {
        const updateActiveFile = () => {
            const file = app.workspace.getActiveFile();
            if (file && file.extension === 'md') {
                setActiveFile({ path: file.path, basename: file.basename });
            } else {
                setActiveFile(null);
            }
        };

        // Initial check
        updateActiveFile();

        // Listen for active file changes
        const eventRef = app.workspace.on('active-leaf-change', updateActiveFile);
        
        return () => {
            app.workspace.offref(eventRef);
        };
    }, [app]);

    // Update context files when active file or input changes
    React.useEffect(() => {
        const files: Array<{ path: string; basename: string; isActive: boolean }> = [];
        
        // Add active file if exists
        if (activeFile) {
            files.push({ ...activeFile, isActive: true });
        }
        
        // Parse [[...]] links from input to show manually linked files
        const linkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
        const matches = Array.from(inputValue.matchAll(linkRegex));
        const linkedPaths = new Set<string>();
        
        for (const match of matches) {
            const linkPath = match[1]?.trim();
            if (linkPath) {
                const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
                if (file) {
                    // Avoid duplicate if it's the same as active file
                    if (!activeFile || file.path !== activeFile.path) {
                        if (!linkedPaths.has(file.path)) {
                            linkedPaths.add(file.path);
                            files.push({ path: file.path, basename: file.basename, isActive: false });
                        }
                    }
                }
            }
        }
        
        setContextFiles(files);
    }, [activeFile, inputValue, app]);

    const removeContextFile = (path: string) => {
        // If it's the active file, we just mark it as "removed" (we won't include it in context)
        if (activeFile && activeFile.path === path) {
            setActiveFile(null);
        }
        // If it's a linked file, remove it from input
        // (This is tricky - for now we just won't remove from input, user can manually edit)
    };

    const refreshChatList = React.useCallback(() => {
        if (!chatStorage) return;
        const chats = chatStorage.getAllChats();
        console.log('[ChatStorage] All chats:', chats);
        setAllChats(chats.map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })));
    }, [chatStorage]);

    // Helper to save welcome message to a chat
    const saveWelcomeMessage = React.useCallback(async (chatId: string, storage: ChatStorage) => {
        const welcomeMsg = getDefaultMessages()[0];
        storage.addMessageToChat(chatId, {
            id: welcomeMsg.id,
            content: welcomeMsg.content,
            sender: welcomeMsg.sender,
            timestamp: welcomeMsg.timestamp.getTime(),
        });
        await storage.save();
        console.log('[ChatStorage] Welcome message saved to chat:', chatId);
    }, []);

    // Initialize when chatStorage becomes available (changes from null to a value)
    React.useEffect(() => {
        const wasNull = prevChatStorageRef.current === null;
        const isNowAvailable = chatStorage !== null;
        prevChatStorageRef.current = chatStorage;

        // Only initialize when chatStorage transitions from null to available
        if (wasNull && isNowAvailable) {
            console.log('[ChatStorage] Storage became available, initializing...');
            
            const initializeFromStorage = async () => {
                const mostRecentChat = chatStorage.getMostRecentChat();
                console.log('[ChatStorage] Most recent chat:', mostRecentChat);
                
                if (mostRecentChat) {
                    setCurrentChatId(mostRecentChat.id);
                    // Convert stored messages to display messages
                    const displayMessages = mostRecentChat.messages.map(m => ({
                        id: m.id,
                        content: m.content,
                        sender: m.sender as 'user' | 'assistant',
                        timestamp: new Date(m.timestamp),
                    }));
                    console.log('[ChatStorage] Display messages:', displayMessages.length, displayMessages);
                    if (displayMessages.length > 0) {
                        setMessages(displayMessages);
                        console.log('[ChatStorage] Messages set to:', displayMessages);
                    } else {
                        // Chat exists but has no messages - add and save welcome message
                        console.log('[ChatStorage] No messages, adding welcome message');
                        const defaultMsgs = getDefaultMessages();
                        setMessages(defaultMsgs);
                        await saveWelcomeMessage(mostRecentChat.id, chatStorage);
                    }
                } else {
                    // Create a new chat if none exists
                    console.log('[ChatStorage] Creating new chat...');
                    const newChat = chatStorage.createChat('New Chat');
                    setCurrentChatId(newChat.id);
                    const defaultMsgs = getDefaultMessages();
                    setMessages(defaultMsgs);
                    // Save the welcome message to the new chat
                    await saveWelcomeMessage(newChat.id, chatStorage);
                    console.log('[ChatStorage] New chat created and saved:', newChat.id);
                }
                
                setIsStorageReady(true);
                refreshChatList();
            };

            initializeFromStorage();
        } else if (!isNowAvailable) {
            console.log('[ChatStorage] No chat storage available');
        }
    }, [chatStorage, refreshChatList, saveWelcomeMessage]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    React.useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const loadChat = (chatId: string) => {
        if (!chatStorage) return;
        
        const chat = chatStorage.getChat(chatId);
        if (chat) {
            console.log('[ChatStorage] Loading chat:', chatId, 'with', chat.messages.length, 'messages');
            setCurrentChatId(chatId);
            chatStorage.setCurrentChat(chatId);
            const displayMessages: Message[] = chat.messages.map(m => ({
                id: m.id,
                content: m.content,
                sender: m.sender as 'user' | 'assistant',
                timestamp: new Date(m.timestamp),
            }));
            const newMessages = displayMessages.length > 0 ? displayMessages : getDefaultMessages();
            console.log('[ChatStorage] Setting messages:', newMessages.length);
            setMessages(newMessages);
            setShowChatList(false);
        }
    };

    const generateTitleFromMessage = (message: string): string => {
        // Take first 60 characters and clean up
        const title = message.substring(0, 60).trim();
        return title || 'New Chat';
    };

    const updateChatTitle = async (chatId: string, userMessage: string) => {
        if (!chatStorage) return;
        
        const chat = chatStorage.getChat(chatId);
        if (chat && chat.title === 'New Chat') {
            // This is still the default title, so update it with the user's message
            const newTitle = generateTitleFromMessage(userMessage);
            chat.title = newTitle;
            await chatStorage.save();
            console.log('[ChatStorage] Chat title updated to:', newTitle);
            refreshChatList();
        }
    };

    const createNewChat = async () => {
        if (!chatStorage) return;
        
        console.log('[ChatStorage] Creating new chat...');
        const newChat = chatStorage.createChat('New Chat');
        setCurrentChatId(newChat.id);
        const welcomeMessages = getDefaultMessages();
        setMessages(welcomeMessages);
        
        // Save welcome message to the new chat
        const welcomeMsg = welcomeMessages[0];
        chatStorage.addMessageToChat(newChat.id, {
            id: welcomeMsg.id,
            content: welcomeMsg.content,
            sender: welcomeMsg.sender,
            timestamp: welcomeMsg.timestamp.getTime(),
        });
        await chatStorage.save();
        console.log('[ChatStorage] New chat created with welcome message:', newChat.id);
        
        refreshChatList();
        setShowChatList(false);
    };

    const deleteChat = async (chatId: string) => {
        if (!chatStorage) return;
        
        console.log('[ChatStorage] Deleting chat:', chatId);
        chatStorage.deleteChat(chatId);
        await chatStorage.save();
        refreshChatList();
        
        // If we deleted the current chat, load another one
        if (chatId === currentChatId) {
            const remainingChats = chatStorage.getAllChats();
            if (remainingChats.length > 0) {
                loadChat(remainingChats[0].id);
            } else {
                await createNewChat();
            }
        }
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;
        
        // Don't allow sending if storage isn't ready
        if (!chatStorage || !isStorageReady) {
            console.log('[ChatStorage] Cannot send message - storage not ready');
            return;
        }

        // Ensure we have a chat ID
        let activeChatId = currentChatId;
        if (!activeChatId) {
            const newChat = chatStorage.createChat();
            activeChatId = newChat.id;
            setCurrentChatId(newChat.id);
            await chatStorage.save();
        }

        // Parse context from the input (extract [[...]] references) and include active file
        console.log('[Context] Parsing context from input...');
        const context = await parseContext(inputValue, app, { 
            activeFilePath: activeFile?.path 
        });
        console.log('[Context] Found', context.linkedFiles.length, 'context files (including active file)');

        // Build contextual prompt if there are linked files
        const processedContent = buildContextualPrompt(inputValue, context);

        const userMessage: Message = {
            id: Date.now().toString(),
            content: inputValue, // Store original message in UI
            sender: 'user',
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);

        // Save user message to storage (chatStorage is guaranteed to exist here)
        console.log('[ChatStorage] Saving user message to chat:', activeChatId);
        chatStorage.addMessageToChat(activeChatId, {
            id: userMessage.id,
            content: userMessage.content,
            sender: 'user',
            timestamp: userMessage.timestamp.getTime(),
        });
        await chatStorage.save();
        console.log('[ChatStorage] User message saved');

        // Update chat title if this is the first user message
        await updateChatTitle(activeChatId, userMessage.content);

        // Create assistant message with streaming content
        const assistantMessageId = (Date.now() + 1).toString();
        streamingIdRef.current = assistantMessageId;
        let assistantContent = '';

        const assistantMessage: Message = {
            id: assistantMessageId,
            content: '',
            sender: 'assistant',
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        try {
            const conversationMessages = messages
                .filter(m => m.sender === 'user' || m.sender === 'assistant')
                .map(m => ({
                    role: m.sender === 'user' ? 'user' : 'assistant',
                    content: m.content
                }));
            
            // Add system prompt at the beginning
            conversationMessages.unshift({
                role: 'system',
                content: 'You are a markdown writing and formatting assistant. Your purpose is to help users write, format, and structure markdown content for their notes. Focus on creating well-formatted markdown with proper headings, lists, code blocks, tables, and other markdown elements. Be concise and helpful in improving markdown content.'
            });
            
            conversationMessages.push({
                role: 'user',
                content: processedContent // Use processed content with file contents included
            });

            // Stream the response
            for await (const token of streamOllama(ollamaUrl, ollamaModel, conversationMessages, abortControllerRef.current.signal)) {
                if (streamingIdRef.current === assistantMessageId) {
                    assistantContent += token;
                    setMessages(prev => {
                        const updated = [...prev];
                        const msgIndex = updated.findIndex(m => m.id === assistantMessageId);
                        if (msgIndex !== -1) {
                            updated[msgIndex] = {
                                ...updated[msgIndex],
                                content: assistantContent
                            };
                        }
                        return updated;
                    });
                }
            }

            // Save assistant message to storage with complete content
            console.log('[ChatStorage] Saving assistant message to chat:', activeChatId);
            chatStorage.addMessageToChat(activeChatId, {
                id: assistantMessageId,
                content: assistantContent,
                sender: 'assistant',
                timestamp: assistantMessage.timestamp.getTime(),
            });
            await chatStorage.save();
            console.log('[ChatStorage] Assistant message saved');
            refreshChatList();
        } catch (error) {
            // Only show error messages if it's not an abort (user clicking stop)
            console.error('Stream error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                content: `Error: ${error}`,
                sender: 'assistant',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
            streamingIdRef.current = null;
            abortControllerRef.current = null;
        }
    };

    const handleTerminateStream = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '14px',
                fontWeight: 'bold',
                borderBottom: '1px solid var(--divider-color)',
                paddingBottom: '8px',
            }}>
                <span>Ollama Chat</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setShowChatList(!showChatList)}
                        style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--background-modifier-border)',
                            backgroundColor: 'var(--background-secondary)',
                            color: 'var(--text-normal)',
                            fontSize: '12px',
                            cursor: 'pointer',
                        }}
                        title="View all chats"
                    >
                        Chats
                    </button>
                    <button
                        onClick={createNewChat}
                        style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--background-modifier-border)',
                            backgroundColor: 'var(--interactive-accent)',
                            color: 'var(--text-on-accent)',
                            fontSize: '12px',
                            cursor: 'pointer',
                        }}
                        title="New chat"
                    >
                        + New
                    </button>
                </div>
            </div>

            {/* Chat List Overlay */}
            {showChatList && (
                <div style={{
                    position: 'absolute',
                    top: '60px',
                    left: '16px',
                    right: '16px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    backgroundColor: 'var(--background-primary)',
                    border: '1px solid var(--background-modifier-border)',
                    borderRadius: '8px',
                    padding: '8px',
                    zIndex: 100,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
                        All Chats ({allChats.length})
                    </div>
                    {allChats.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>
                            No chats yet. Create a new one!
                        </div>
                    ) : (
                        allChats.map(chat => (
                            <div
                                key={chat.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px',
                                    marginBottom: '4px',
                                    borderRadius: '4px',
                                    backgroundColor: chat.id === currentChatId 
                                        ? 'var(--background-modifier-hover)' 
                                        : 'transparent',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                }}
                                onClick={() => loadChat(chat.id)}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div 
                                        style={{ 
                                            fontWeight: chat.id === currentChatId ? 'bold' : 'normal',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                        title={chat.title}
                                    >
                                        {chat.title}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                        {new Date(chat.updatedAt).toLocaleString()}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Delete this chat?')) {
                                            deleteChat(chat.id);
                                        }
                                    }}
                                    style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        backgroundColor: 'var(--background-modifier-error)',
                                        color: 'var(--text-on-accent)',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    🗑️
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}

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
                                whiteSpace: message.sender === 'user' ? 'pre-wrap' : 'normal',
                                userSelect: 'text',
                                cursor: 'text',
                            }}
                        >
                            {message.sender === 'user' ? (
                                message.content
                            ) : (
                                <div 
                                    dangerouslySetInnerHTML={{ 
                                        __html: marked.parse(message.content) as string 
                                    }}
                                    style={{
                                        wordWrap: 'break-word',
                                    }}
                                    className="markdown-rendered"
                                />
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Context Files Display */}
            {contextFiles.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '8px 0',
                    borderTop: '1px solid var(--divider-color)',
                }}>
                    <span style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginRight: '4px',
                        alignSelf: 'center',
                    }}>
                        Context:
                    </span>
                    {contextFiles.map(file => (
                        <div
                            key={file.path}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                backgroundColor: file.isActive 
                                    ? 'var(--interactive-accent)' 
                                    : 'var(--background-secondary)',
                                color: file.isActive 
                                    ? 'var(--text-on-accent)' 
                                    : 'var(--text-normal)',
                                fontSize: '11px',
                                maxWidth: '150px',
                            }}
                            title={`${file.path}${file.isActive ? ' (active file)' : ''}`}
                        >
                            <span style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {file.isActive ? ' ' : ' '}{file.basename}
                            </span>
                            <button
                                onClick={() => removeContextFile(file.path)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '14px',
                                    height: '14px',
                                    padding: 0,
                                    border: 'none',
                                    borderRadius: '50%',
                                    backgroundColor: 'transparent',
                                    color: 'inherit',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    opacity: 0.7,
                                }}
                                title="Remove from context"
                            >
                                <span>&#10799;</span>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Input Area */}
            <div style={{
                display: 'flex',
                gap: '8px',
                borderTop: contextFiles.length > 0 ? 'none' : '1px solid var(--divider-color)',
                paddingTop: contextFiles.length > 0 ? '0' : '12px',
            }}>
                <PromptInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleSendMessage}
                    disabled={isLoading || !isStorageReady}
                    placeholder={isStorageReady ? "Type a message... (Shift+Enter for new line)" : "Loading..."}
                    app={app}
                />
                {isLoading ? (
                    <button
                        onClick={handleTerminateStream}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: 'var(--background-modifier-error)',
                            color: 'var(--text-on-accent)',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                        }}
                    >
                        ■ Stop
                    </button>
                ) : (
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || !isStorageReady}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: 'var(--interactive-accent)',
                            color: 'var(--text-on-accent)',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            opacity: !inputValue.trim() || !isStorageReady ? 0.5 : 1,
                        }}
                    >
                        Send
                    </button>
                )}
            </div>
        </div>
    );
}