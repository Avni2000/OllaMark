export interface StoredMessage {
    id: string;
    content: string;
    sender: 'user' | 'assistant';
    timestamp: number;
}

export interface Chat {
    id: string;
    title: string;
    messages: StoredMessage[];
    createdAt: number;
    updatedAt: number;
}

export interface ChatsData {
    chats: Chat[];
    currentChatId: string | null;
}

export const DEFAULT_CHATS_DATA: ChatsData = {
    chats: [],
    currentChatId: null,
};

export class ChatStorage {
    private data: ChatsData;
    private saveDataCallback: (data: ChatsData) => Promise<void>;
    private loadDataCallback: () => Promise<ChatsData>;

    constructor(
        loadDataCallback: () => Promise<ChatsData>,
        saveDataCallback: (data: ChatsData) => Promise<void>
    ) {
        this.data = DEFAULT_CHATS_DATA;
        this.loadDataCallback = loadDataCallback;
        this.saveDataCallback = saveDataCallback;
    }

    async load() {
        try {
            const data = await this.loadDataCallback();
            this.data = data || DEFAULT_CHATS_DATA;
        } catch (error) {
            console.error('Failed to load chats:', error);
            this.data = DEFAULT_CHATS_DATA;
        }
    }

    async save() {
        try {
            await this.saveDataCallback(this.data);
        } catch (error) {
            console.error('Failed to save chats:', error);
        }
    }

    createChat(title: string = 'New Chat'): Chat {
        const chat: Chat = {
            id: Date.now().toString(),
            title,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.data.chats.unshift(chat); // Add to beginning for most recent first
        this.data.currentChatId = chat.id;
        return chat;
    }

    getChat(chatId: string): Chat | undefined {
        return this.data.chats.find(c => c.id === chatId);
    }

    getCurrentChat(): Chat | undefined {
        if (!this.data.currentChatId) return undefined;
        return this.getChat(this.data.currentChatId);
    }

    getMostRecentChat(): Chat | undefined {
        return this.data.chats[0];
    }

    getAllChats(): Chat[] {
        return this.data.chats;
    }

    addMessageToChat(chatId: string, message: StoredMessage): void {
        const chat = this.getChat(chatId);
        if (chat) {
            chat.messages.push(message);
            chat.updatedAt = Date.now();
        }
    }

    updateChatMessage(chatId: string, messageId: string, content: string): void {
        const chat = this.getChat(chatId);
        if (chat) {
            const message = chat.messages.find(m => m.id === messageId);
            if (message) {
                message.content = content;
            }
            chat.updatedAt = Date.now();
        }
    }

    setCurrentChat(chatId: string): void {
        if (this.getChat(chatId)) {
            this.data.currentChatId = chatId;
        }
    }

    deleteChat(chatId: string): void {
        const index = this.data.chats.findIndex(c => c.id === chatId);
        if (index !== -1) {
            this.data.chats.splice(index, 1);
            if (this.data.currentChatId === chatId) {
                this.data.currentChatId = this.data.chats[0]?.id || null;
            }
        }
    }

    updateChatTitle(chatId: string, title: string): void {
        const chat = this.getChat(chatId);
        if (chat) {
            chat.title = title;
            chat.updatedAt = Date.now();
        }
    }
}
