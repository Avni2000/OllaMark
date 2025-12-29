/**
 * @file formatter.ts
 * @description Utilities for formatting markdown content using AI.
 */
import { callOllama } from './ollama';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, addIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
interface FormatMarkdownOptions {
    ollamaUrl: string;
    model: string;
    text: string;
    noteTitle?: string;
    formatComments?: boolean;
    /** Custom user prompt to guide the AI formatting */
    customPrompt?: string;
}



export async function formatMarkdownWithAI(options: FormatMarkdownOptions): Promise<string> {
	const { ollamaUrl, model, text, noteTitle, formatComments = true, customPrompt } = options;
	const titleLine = noteTitle ? `Title: ${noteTitle}\n` : '';

	// Extract and preserve HTML comments if formatComments is true
	const { textToFormat, comments } = formatComments ? { textToFormat: text, comments: [] } : extractComments(text);

	// Build the system prompt based on whether a custom prompt is provided
	const systemContent = customPrompt
		? `You are a skilled markdown editor. Follow the user's instructions to improve the text. Respond with markdown only.`
		: 'You are a skilled markdown editor. Improve readability, structure, grammar, and formatting. Enhance clarity and flow while keeping the core meaning intact. Respond with markdown only.';

	// Build the user prompt
	const userContent = customPrompt
		? `${titleLine}Instructions: ${customPrompt}\n\nFormat the following markdown selection according to the instructions above:\n---\n${textToFormat}\n---`
		: `${titleLine}Format the following markdown selection:\n---\n${textToFormat}\n---`;

	const messages = [
		{
			role: 'system',
			content: systemContent
		},
		{
			role: 'user',
			content: userContent
		}
	];

	const response = await callOllama(ollamaUrl, model, messages);
	const formatted = escapeWikilinks(stripCodeFence(response.trim()));

	// Restore comments if they were extracted
	return formatComments ? formatted : restoreComments(formatted, comments);
}


// Refactored: formatSelectionWithAI as a standalone function
export async function formatSelectionWithAI(
	editor: Editor,
	app: App,
	settings: { ollamaUrl: string; ollamaModel: string; formatComments: boolean },
	buildSuggestions: Function,
	showInlineSuggestions: Function,
	renameNoteIfNeeded: (file: TFile, requestedTitle: string, app: App) => Promise<void>,
	customPrompt?: string
): Promise<void> {
	const selection = editor.getSelection();
	if (!selection.trim()) {
		new Notice('Select text to format before using AI.');
		return;
	}

	// Capture selection positions BEFORE calling AI (positions might change during async call)
	const selectionFrom = editor.posToOffset(editor.getCursor('from'));
	const selectionTo = editor.posToOffset(editor.getCursor('to'));

	const activeFile = app.workspace.getActiveFile();
	const noticeMessage = customPrompt 
		? 'Formatting selection with custom prompt...' 
		: 'Formatting selection with AI...';
	const runningNotice = new Notice(noticeMessage, 8000);

	try {
		const formattedResponse = await formatMarkdownWithAI({
			ollamaUrl: settings.ollamaUrl,
			model: settings.ollamaModel,
			text: selection,
			noteTitle: activeFile?.basename,
			formatComments: settings.formatComments,
			customPrompt,
		});
		runningNotice.hide();

		const { content } = extractTitle(formattedResponse);
		if (content === selection) {
			new Notice('AI kept the selection unchanged.');
			return;
		}

		// Get the EditorView from Obsidian's editor
		// @ts-expect-error - accessing internal CM6 editor
		const editorView: EditorView | undefined = editor.cm;
		if (!editorView) {
			new Notice('Could not access editor view for inline diff.');
			return;
		}

		// Verify document hasn't changed length at all (user edited during AI call)
		const docLength = editorView.state.doc.length;
		if (selectionTo > docLength) {
			new Notice('Document changed while AI was processing. Please try again.');
			return;
		}

		// Build suggestions from the diff
		const suggestions = buildSuggestions(selection, content, selectionFrom, selectionTo);

		if (suggestions.length === 0) {
			new Notice('AI kept the selection unchanged.');
			return;
		}

		// Show inline suggestions and wait for user to accept/reject
		const review = await showInlineSuggestions(editorView, suggestions, {
			currentTitle: activeFile?.basename,
		});

		if (!review) {
			new Notice('Formatting canceled.');
			return;
		}

		new Notice('Selection formatted.');
	} catch (error) {
		runningNotice.hide();
		console.error('AI formatting failed:', error);
		new Notice('Could not format selection. See console for details.');
	}
}


 function extractTitle(content: string): { content: string; proposedTitle?: string } {
	const normalized = content.replace(/^\uFEFF/, '').replace(/^\u200B/, '');
	const headingMatch = normalized.match(/^\s*#\s+(.+)\s*(?:\r?\n|$)/);
	if (!headingMatch) {
		return { content: normalized };
	}
	const consumed = headingMatch[0] ?? '';
	const remaining = normalized.slice(consumed.length).replace(/^\s+/, '');
	return {
		content: remaining,
		proposedTitle: headingMatch[1]?.trim() || undefined,
	};
}


 function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '').trim();
}


 export async function renameNoteIfNeeded(file: TFile, requestedTitle: string, app: App): Promise<void> {
	const sanitized = sanitizeFileName(requestedTitle);
	if (!sanitized || sanitized === file.basename) {
		return;
	}

	const folderPath = file.parent?.path ?? '';
	const newPath = folderPath ? `${folderPath}/${sanitized}.${file.extension}` : `${sanitized}.${file.extension}`;
	const existing = app.vault.getAbstractFileByPath(newPath);
	if (existing) {
		new Notice('Cannot rename note: target name already exists.');
		return;
	}

	try {
		await app.fileManager.renameFile(file, newPath);
		new Notice(`Note renamed to ${sanitized}.`);
	} catch (error) {
		console.error('Failed to rename note:', error);
		new Notice('Could not rename note. See console for details.');
	}
}

function stripCodeFence(output: string): string {
    const fenceMatch = output.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
    return fenceMatch?.[1] ?? output;
}

function escapeWikilinks(text: string): string {
    // Escape brackets except when they're part of markdown links [text](url) or inside code blocks
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const codeBlockRegex = /```[\s\S]*?```/g;
    const inlineCodeRegex = /`[^`]*`/g;
    
    const markdownLinks: string[] = [];
    const codeBlocks: string[] = [];
    const inlineCodes: string[] = [];
    let linkCounter = 0;
    let blockCounter = 0;
    let inlineCounter = 0;
    
    let result = text;
    
    // First, temporarily replace code blocks (and unescape any pre-escaped brackets inside them)
    result = result.replace(codeBlockRegex, (match) => {
        // Unescape brackets that the AI may have pre-escaped inside code blocks
        const unescaped = match.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
        codeBlocks.push(unescaped);
        return `__CODEBLOCK_${blockCounter++}__`;
    });
    
    // Then, temporarily replace inline code (and unescape any pre-escaped brackets inside them)
    result = result.replace(inlineCodeRegex, (match) => {
        const unescaped = match.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
        inlineCodes.push(unescaped);
        return `__INLINECODE_${inlineCounter++}__`;
    });
    
    // Then, temporarily replace markdown links
    result = result.replace(markdownLinkRegex, (match) => {
        markdownLinks.push(match);
        return `__MDLINK_${linkCounter++}__`;
    });
    
    // Now escape all remaining brackets
    result = result.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    
    // Restore everything in reverse order
    markdownLinks.forEach((link, index) => {
        result = result.replace(`__MDLINK_${index}__`, link);
    });
    
    inlineCodes.forEach((code, index) => {
        result = result.replace(`__INLINECODE_${index}__`, code);
    });
    
    codeBlocks.forEach((block, index) => {
        result = result.replace(`__CODEBLOCK_${index}__`, block);
    });
    
    return result;
}

interface CommentPlaceholder {
	placeholder: string;
	original: string;
}

function extractComments(text: string): { textToFormat: string; comments: CommentPlaceholder[] } {
	const comments: CommentPlaceholder[] = [];
	let counter = 0;

	// Replace HTML comments with unique placeholders
	const textToFormat = text.replace(/<!--[\s\S]*?-->/g, (match) => {
		const placeholder = `__COMMENT_PLACEHOLDER_${counter}__`;
		comments.push({ placeholder, original: match });
		counter++;
		return placeholder;
	});

	return { textToFormat, comments };
}

function restoreComments(formatted: string, comments: CommentPlaceholder[]): string {
	let result = formatted;
	
	// Restore each comment from its placeholder
	for (const { placeholder, original } of comments) {
		result = result.replace(placeholder, original);
	}
	
	return result;
}
