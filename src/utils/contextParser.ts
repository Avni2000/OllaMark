import { App, TFile } from 'obsidian';

export interface ParsedContext {
    originalText: string;
    processedText: string;
    linkedFiles: Array<{
        linkText: string;
        filePath: string;
        content: string;
        isActiveFile?: boolean;
    }>;
}

export interface ParseContextOptions {
    /** The active file to automatically include in context */
    activeFilePath?: string;
}

/**
 * Parses text for [[...]] wiki-style links and extracts the contents of referenced files.
 * Also includes the active file if provided.
 * @param text The text containing potential [[...]] references
 * @param app The Obsidian app instance to access the vault
 * @param options Optional settings including active file path
 * @returns Parsed context with original text, processed text, and linked file contents
 */
export async function parseContext(text: string, app: App, options?: ParseContextOptions): Promise<ParsedContext> {
    const result: ParsedContext = {
        originalText: text,
        processedText: text,
        linkedFiles: [],
    };

    // Track which files we've already added (to avoid duplicates)
    const addedFilePaths = new Set<string>();

    // Add active file first if provided
    if (options?.activeFilePath) {
        const activeFile = app.vault.getAbstractFileByPath(options.activeFilePath);
        if (activeFile instanceof TFile) {
            try {
                const content = await app.vault.read(activeFile);
                result.linkedFiles.push({
                    linkText: activeFile.basename,
                    filePath: activeFile.path,
                    content: content,
                    isActiveFile: true,
                });
                addedFilePaths.add(activeFile.path);
            } catch (error) {
                console.error(`[ContextParser] Error reading active file ${options.activeFilePath}:`, error);
            }
        }
    }

    // Match [[...]] patterns (basic wiki links)
    // This regex handles: [[filename]], [[filename|alias]], [[folder/filename]]
    const linkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
    const matches = Array.from(text.matchAll(linkRegex));

    if (matches.length === 0) {
        return result;
    }

    // Extract unique file references
    const fileReferences = new Set<string>();
    for (const match of matches) {
        const linkPath = match[1]?.trim();
        if (linkPath) {
            fileReferences.add(linkPath);
        }
    }

    // Fetch file contents
    for (const linkPath of fileReferences) {
        try {
            // Try to resolve the file using Obsidian's metadataCache
            const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
            
            if (file instanceof TFile) {
                // Skip if already added (e.g., if it's the active file)
                if (addedFilePaths.has(file.path)) {
                    continue;
                }
                
                const content = await app.vault.read(file);
                result.linkedFiles.push({
                    linkText: linkPath,
                    filePath: file.path,
                    content: content,
                });
                addedFilePaths.add(file.path);
            } else {
                console.warn(`[ContextParser] Could not resolve file: ${linkPath}`);
            }
        } catch (error) {
            console.error(`[ContextParser] Error reading file ${linkPath}:`, error);
        }
    }

    return result;
}

/**
 * Constructs a prompt with context included.
 * @param userMessage The original user message
 * @param context The parsed context
 * @returns A formatted prompt with file contents included
 */
export function buildContextualPrompt(userMessage: string, context: ParsedContext): string {
    if (context.linkedFiles.length === 0) {
        return userMessage;
    }

    // Build context section
    let contextSection = '\n\n---\n**Referenced Files:**\n\n';
    
    for (const file of context.linkedFiles) {
        const label = file.isActiveFile ? `File (Active): ${file.filePath}` : `File: ${file.filePath}`;
        contextSection += `### ${label}\n\n`;
        contextSection += '```\n';
        contextSection += file.content;
        contextSection += '\n```\n\n';
    }

    contextSection += '---\n\n';
    contextSection += '**User Message:**\n';
    contextSection += userMessage;

    return contextSection;
}
