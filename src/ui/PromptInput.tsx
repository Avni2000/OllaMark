import * as React from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState, Extension, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, CompletionContext, CompletionResult, acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { App, TFile } from 'obsidian';

interface PromptInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    placeholder?: string;
    app: App;
}

/**
 * A CodeMirror 6 based prompt input that integrates with Obsidian's link suggestions.
 * This allows users to type [[ and get Obsidian's native file suggester.
 */
export function PromptInput({ 
    value, 
    onChange, 
    onSubmit, 
    disabled = false, 
    placeholder: placeholderText = 'Type a message...',
    app,
}: PromptInputProps) {
    const editorRef = React.useRef<HTMLDivElement>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    const lastValueRef = React.useRef(value);

    React.useEffect(() => {
        if (!editorRef.current) return;

        // Create custom keymap for Enter handling - use Prec.high so it runs before autocomplete
        const customKeymap = keymap.of([
            {
                key: 'Enter',
                run: (view) => {
                    // If autocomplete is active, let it handle Enter (accept completion)
                    if (completionStatus(view.state) === 'active') {
                        return acceptCompletion(view);
                    }
                    // Otherwise, submit the message
                    if (!disabled) {
                        onSubmit();
                        return true;
                    }
                    return false;
                },
            },
            {
                key: 'Shift-Enter',
                run: (view) => {
                    // Insert a newline
                    view.dispatch({
                        changes: {
                            from: view.state.selection.main.head,
                            insert: '\n',
                        },
                        selection: {
                            anchor: view.state.selection.main.head + 1,
                        },
                    });
                    return true;
                },
            },
        ]);

        // Obsidian's theme integration
        const obsidianTheme = EditorView.theme({
            '&': {
                backgroundColor: 'var(--background-secondary)',
                color: 'var(--text-normal)',
                fontSize: '13px',
                fontFamily: 'var(--font-text)',
                minHeight: '36px',
                maxHeight: '200px',
            },
            '.cm-scroller': {
                overflow: 'auto',
                maxHeight: '200px',
            },
            '.cm-content': {
                padding: '8px 10px',
                minHeight: '36px',
                caretColor: 'var(--text-normal)',
            },
            '.cm-line': {
                padding: 0,
            },
            '&.cm-focused': {
                outline: 'none',
            },
            '.cm-placeholder': {
                color: 'var(--text-muted)',
            },
            '.cm-cursor': {
                borderLeftColor: 'var(--text-normal)',
            },
            '.cm-selectionBackground, ::selection': {
                backgroundColor: 'var(--text-selection)',
            },
            // Autocomplete styling - position above cursor with high z-index
            '.cm-tooltip': {
                zIndex: 1000,
            },
            '.cm-tooltip.cm-tooltip-autocomplete': {
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                overflow: 'hidden',
            },
            '.cm-tooltip.cm-tooltip-autocomplete > ul': {
                fontFamily: 'var(--font-text)',
                fontSize: '13px',
                maxHeight: '200px',
                margin: 0,
                padding: '4px 0',
            },
            '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
                padding: '6px 12px',
                color: 'var(--text-normal)',
                cursor: 'pointer',
            },
            '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
                backgroundColor: 'var(--interactive-accent)',
                color: 'var(--text-on-accent)',
            },
            '.cm-completionLabel': {
                color: 'inherit',
            },
            '.cm-completionDetail': {
                color: 'var(--text-muted)',
                fontStyle: 'italic',
                marginLeft: '8px',
                fontSize: '11px',
            },
        });

        // Create wiki-link autocomplete for [[ syntax
        const wikiLinkCompletion = (context: CompletionContext): CompletionResult | null => {
            // Look for [[ pattern before cursor
            const beforeCursor = context.matchBefore(/\[\[[^\]]*$/);
            if (!beforeCursor) return null;

            // Extract the query (everything after [[)
            const query = beforeCursor.text.slice(2).toLowerCase();

            // Get all markdown files from the vault
            const files = app.vault.getMarkdownFiles();
            
            // Filter and map to completion options
            const options = files
                .filter(file => {
                    const basename = file.basename.toLowerCase();
                    const path = file.path.toLowerCase();
                    return basename.includes(query) || path.includes(query);
                })
                .slice(0, 20) // Limit to 20 suggestions
                .map(file => ({
                    label: file.basename,
                    detail: file.parent?.path || '',
                    apply: (view: EditorView, completion: any, from: number, to: number) => {
                        // Insert the filename and closing brackets
                        const insertText = `${file.basename}]]`;
                        view.dispatch({
                            changes: { from: beforeCursor.from + 2, to, insert: insertText },
                            selection: { anchor: beforeCursor.from + 2 + insertText.length },
                        });
                    },
                }));

            if (options.length === 0) return null;

            return {
                from: beforeCursor.from + 2, // Start after [[
                options,
                validFor: /^[^\]]*$/,
            };
        };

        // Extensions array - order matters! Autocomplete needs to process Enter before our custom keymap
        const extensions: Extension[] = [
            markdown(),
            history(),
            placeholder(placeholderText),
            autocompletion({
                override: [wikiLinkCompletion],
                defaultKeymap: true,
                activateOnTyping: true,
                aboveCursor: true,
            }),
            Prec.high(customKeymap), // High priority so we can check autocomplete state first
            keymap.of([...defaultKeymap, ...historyKeymap]),
            obsidianTheme,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    const newValue = update.state.doc.toString();
                    lastValueRef.current = newValue;
                    onChange(newValue);
                }
            }),
        ];

        // Create the editor state
        const startState = EditorState.create({
            doc: value,
            extensions,
        });

        // Create the editor view
        const view = new EditorView({
            state: startState,
            parent: editorRef.current,
        });

        viewRef.current = view;

        // Cleanup
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, [app, disabled]); // Only recreate when app or disabled changes

    // Update editor content when value prop changes externally (but not from our own updates)
    React.useEffect(() => {
        if (viewRef.current && value !== lastValueRef.current) {
            const view = viewRef.current;
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: value,
                },
            });
            lastValueRef.current = value;
        }
    }, [value]);

    // Handle disabled state
    React.useEffect(() => {
        if (viewRef.current) {
            viewRef.current.contentDOM.contentEditable = disabled ? 'false' : 'true';
        }
    }, [disabled]);

    return (
        <div
            ref={editorRef}
            style={{
                flex: 1,
                borderRadius: '4px',
                border: '1px solid var(--background-modifier-border)',
                backgroundColor: 'var(--background-secondary)',
                opacity: disabled ? 0.5 : 1,
                pointerEvents: disabled ? 'none' : 'auto',
                position: 'relative', // Needed for tooltip positioning
            }}
        />
    );
}
