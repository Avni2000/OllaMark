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
			content: `${titleLine}Format the following markdown selection:\n---\n${text}\n---`
		}
	];

	const response = await callOllama(ollamaUrl, model, messages);
	return stripCodeFence(response.trim());
}


// Refactored: formatSelectionWithAI as a standalone function
export async function formatSelectionWithAI(
	editor: Editor,
	app: App,
	settings: { ollamaUrl: string; ollamaModel: string },
	buildSuggestions: Function,
	showInlineSuggestions: Function,
	renameNoteIfNeeded: (file: TFile, requestedTitle: string, app: App) => Promise<void>
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
	const runningNotice = new Notice('Formatting selection with AI...', 8000);

	try {
		const formattedResponse = await formatMarkdownWithAI({
			ollamaUrl: settings.ollamaUrl,
			model: settings.ollamaModel,
			text: selection,
			noteTitle: activeFile?.basename,
		});
		runningNotice.hide();

		const { content, proposedTitle } = extractTitle(formattedResponse);
		if (content === selection && (!proposedTitle || proposedTitle === activeFile?.basename)) {
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

		if (suggestions.length === 0 && !proposedTitle) {
			new Notice('AI kept the selection unchanged.');
			return;
		}

		// Show inline suggestions and wait for user to accept/reject
		const review = await showInlineSuggestions(editorView, suggestions, {
			proposedTitle,
			currentTitle: activeFile?.basename,
		});

		if (!review) {
			new Notice('Formatting canceled.');
			return;
		}

		new Notice('Selection formatted.');

		if (review.renameTo && activeFile) {
			await renameNoteIfNeeded(activeFile, review.renameTo, app);
		}
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
