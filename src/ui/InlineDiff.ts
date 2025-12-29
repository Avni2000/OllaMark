import {
    EditorState,
    StateField,
    StateEffect,
    Transaction,
    RangeSetBuilder,
} from '@codemirror/state';
import {
    EditorView,
    Decoration,
    DecorationSet,
    WidgetType,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';
import { diffLines } from 'diff';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface InlineSuggestion {
    /** Unique ID for this suggestion */
    id: string;
    /** Document position where the original text starts */
    from: number;
    /** Document position where the original text ends */
    to: number;
    /** The original text that would be replaced */
    originalText: string;
    /** The suggested replacement text */
    suggestedText: string;
}

export interface InlineDiffOutcome {
    text: string;
    renameTo?: string;
}

interface SuggestionState {
    suggestions: InlineSuggestion[];
    proposedTitle?: string;
    currentTitle?: string;
    resolveCallback?: (outcome: InlineDiffOutcome | null) => void;
}

// ─────────────────────────────────────────────────────────────
// State Effects
// ─────────────────────────────────────────────────────────────

/** Set all suggestions at once */
export const setSuggestionsEffect = StateEffect.define<{
    suggestions: InlineSuggestion[];
    proposedTitle?: string;
    currentTitle?: string;
    resolveCallback?: (outcome: InlineDiffOutcome | null) => void;
}>();

/** Accept a specific suggestion by ID */
export const acceptSuggestionEffect = StateEffect.define<string>();

/** Reject a specific suggestion by ID */
export const rejectSuggestionEffect = StateEffect.define<string>();

/** Accept all suggestions */
export const acceptAllEffect = StateEffect.define<null>();

/** Reject all suggestions (clear without applying) */
export const rejectAllEffect = StateEffect.define<null>();

// ─────────────────────────────────────────────────────────────
// State Field
// ─────────────────────────────────────────────────────────────

const suggestionStateField = StateField.define<SuggestionState>({
    create(): SuggestionState {
        return { suggestions: [] };
    },

    update(state: SuggestionState, tr: Transaction): SuggestionState {
        let newState = state;

        for (const effect of tr.effects) {
            if (effect.is(setSuggestionsEffect)) {
                newState = {
                    suggestions: effect.value.suggestions,
                    proposedTitle: effect.value.proposedTitle,
                    currentTitle: effect.value.currentTitle,
                    resolveCallback: effect.value.resolveCallback,
                };
            } else if (effect.is(acceptSuggestionEffect)) {
                // Remove the accepted suggestion (it will be applied via transaction)
                newState = {
                    ...newState,
                    suggestions: newState.suggestions.filter(s => s.id !== effect.value),
                };
            } else if (effect.is(rejectSuggestionEffect)) {
                // Remove the rejected suggestion (no changes applied)
                newState = {
                    ...newState,
                    suggestions: newState.suggestions.filter(s => s.id !== effect.value),
                };
            } else if (effect.is(acceptAllEffect) || effect.is(rejectAllEffect)) {
                newState = { suggestions: [] };
            }
        }

        // Map suggestion positions through document changes
        if (tr.docChanged && newState.suggestions.length > 0) {
            const docLength = tr.newDoc.length;
            newState = {
                ...newState,
                suggestions: newState.suggestions
                    .map(s => {
                        try {
                            const newFrom = tr.changes.mapPos(s.from);
                            const newTo = tr.changes.mapPos(s.to);
                            // Validate new positions are within bounds
                            if (newFrom < 0 || newTo < 0 || newFrom > docLength || newTo > docLength) {
                                return null;
                            }
                            return {
                                ...s,
                                from: newFrom,
                                to: newTo,
                            };
                        } catch {
                            // Position mapping failed, remove this suggestion
                            return null;
                        }
                    })
                    .filter((s): s is InlineSuggestion => s !== null),
            };
        }

        return newState;
    },
});

// ─────────────────────────────────────────────────────────────
// Widgets
// ─────────────────────────────────────────────────────────────

class GhostTextWidget extends WidgetType {
    constructor(private text: string) {
        super();
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'ollamark-inline-ghost';
        span.textContent = this.text;
        return span;
    }

    eq(other: GhostTextWidget): boolean {
        return this.text === other.text;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

class AcceptRejectButtonsWidget extends WidgetType {
    constructor(
        private suggestionId: string,
        private onAccept: () => void,
        private onReject: () => void
    ) {
        super();
    }

    toDOM(): HTMLElement {
        const container = document.createElement('span');
        container.className = 'ollamark-inline-buttons';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'ollamark-inline-btn ollamark-inline-accept';
        acceptBtn.textContent = '✓';
        acceptBtn.title = 'Accept this change';
        acceptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onAccept();
        });

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'ollamark-inline-btn ollamark-inline-reject';
        rejectBtn.textContent = '✗';
        rejectBtn.title = 'Reject this change';
        rejectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onReject();
        });

        container.appendChild(acceptBtn);
        container.appendChild(rejectBtn);

        return container;
    }

    eq(other: AcceptRejectButtonsWidget): boolean {
        return this.suggestionId === other.suggestionId;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

class TitleSuggestionWidget extends WidgetType {
    constructor(
        private currentTitle: string,
        private proposedTitle: string,
        private onAccept: () => void,
        private onReject: () => void
    ) {
        super();
    }

    toDOM(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ollamark-title-suggestion';

        const label = document.createElement('span');
        label.className = 'ollamark-title-label';
        label.textContent = 'Suggested title: ';

        const oldTitle = document.createElement('span');
        oldTitle.className = 'ollamark-title-old';
        oldTitle.textContent = this.currentTitle;

        const arrow = document.createElement('span');
        arrow.className = 'ollamark-title-arrow';
        arrow.textContent = ' → ';

        const newTitle = document.createElement('span');
        newTitle.className = 'ollamark-title-new';
        newTitle.textContent = this.proposedTitle;

        const buttonsContainer = document.createElement('span');
        buttonsContainer.className = 'ollamark-inline-buttons';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'ollamark-inline-btn ollamark-inline-accept';
        acceptBtn.textContent = '✓';
        acceptBtn.title = 'Accept title change';
        acceptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onAccept();
        });

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'ollamark-inline-btn ollamark-inline-reject';
        rejectBtn.textContent = '✗';
        rejectBtn.title = 'Reject title change';
        rejectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onReject();
        });

        buttonsContainer.appendChild(acceptBtn);
        buttonsContainer.appendChild(rejectBtn);

        container.appendChild(label);
        container.appendChild(oldTitle);
        container.appendChild(arrow);
        container.appendChild(newTitle);
        container.appendChild(buttonsContainer);

        return container;
    }

    eq(other: TitleSuggestionWidget): boolean {
        return this.currentTitle === other.currentTitle && 
               this.proposedTitle === other.proposedTitle;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

class ToolbarWidget extends WidgetType {
    constructor(
        private suggestionCount: number,
        private hasTitle: boolean,
        private onAcceptAll: () => void,
        private onRejectAll: () => void
    ) {
        super();
    }

    toDOM(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ollamark-diff-toolbar';

        const info = document.createElement('span');
        info.className = 'ollamark-toolbar-info';
        info.textContent = `${this.suggestionCount} change${this.suggestionCount !== 1 ? 's' : ''} suggested`;

        const buttons = document.createElement('span');
        buttons.className = 'ollamark-toolbar-buttons';

        const acceptAllBtn = document.createElement('button');
        acceptAllBtn.className = 'ollamark-toolbar-btn ollamark-toolbar-accept';
        acceptAllBtn.textContent = 'Accept All';
        acceptAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onAcceptAll();
        });

        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'ollamark-toolbar-btn ollamark-toolbar-reject';
        rejectAllBtn.textContent = 'Reject All';
        rejectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onRejectAll();
        });

        buttons.appendChild(acceptAllBtn);
        buttons.appendChild(rejectAllBtn);

        container.appendChild(info);
        container.appendChild(buttons);

        return container;
    }

    eq(other: ToolbarWidget): boolean {
        return this.suggestionCount === other.suggestionCount && 
               this.hasTitle === other.hasTitle;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────
// Block Decorations (from StateField - required for block widgets)
// ─────────────────────────────────────────────────────────────

// We need to store view reference for callbacks
let currentView: EditorView | null = null;

const blockDecorationField = StateField.define<DecorationSet>({
    create(state) {
        return buildBlockDecorations(state);
    },
    update(decos, tr) {
        if (
            tr.docChanged ||
            tr.effects.some(e =>
                e.is(setSuggestionsEffect) ||
                e.is(acceptSuggestionEffect) ||
                e.is(rejectSuggestionEffect) ||
                e.is(acceptAllEffect) ||
                e.is(rejectAllEffect)
            )
        ) {
            return buildBlockDecorations(tr.state);
        }
        return decos;
    },
    provide: f => EditorView.decorations.from(f),
});

function buildBlockDecorations(state: EditorState): DecorationSet {
    const suggestionState = state.field(suggestionStateField, false);
    if (!suggestionState) return Decoration.none;
    
    const { suggestions, proposedTitle, currentTitle } = suggestionState;

    if (suggestions.length === 0 && !proposedTitle) {
        return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();

    // Find the position of the first suggestion to place toolbar above it
    const firstSuggestionPos = suggestions.length > 0 
        ? Math.min(...suggestions.map(s => s.from))
        : 0;

    // Add toolbar at the start of the selection (first suggestion)
    if (suggestions.length > 0) {
        builder.add(firstSuggestionPos, firstSuggestionPos, Decoration.widget({
            widget: new ToolbarWidget(
                suggestions.length,
                !!proposedTitle,
                () => currentView && acceptAllSuggestions(currentView),
                () => currentView && rejectAllSuggestions(currentView)
            ),
            side: -2,
            block: true,
        }));
    }

    // Add title suggestion if present
    if (proposedTitle && currentTitle) {
        builder.add(0, 0, Decoration.widget({
            widget: new TitleSuggestionWidget(
                currentTitle,
                proposedTitle,
                () => currentView && acceptTitle(currentView),
                () => currentView && rejectTitle(currentView)
            ),
            side: -1,
            block: true,
        }));
    }

    return builder.finish();
}

// ─────────────────────────────────────────────────────────────
// Inline Decorations (from ViewPlugin - for marks and inline widgets)
// ─────────────────────────────────────────────────────────────

const strikethroughDeco = Decoration.mark({ class: 'ollamark-inline-strikethrough' });

function buildInlineDecorations(state: EditorState, view: EditorView): DecorationSet {
    const suggestionState = state.field(suggestionStateField, false);
    if (!suggestionState) return Decoration.none;
    
    const { suggestions } = suggestionState;

    if (suggestions.length === 0) {
        return Decoration.none;
    }

    const decorations: { from: number; to: number; deco: Decoration }[] = [];

    for (const suggestion of suggestions) {
        const hasOriginal = suggestion.originalText.length > 0;
        const hasSuggested = suggestion.suggestedText.length > 0;

        if (hasOriginal && hasSuggested) {
            // Replacement: strikethrough original + ghost text for new
            decorations.push({
                from: suggestion.from,
                to: suggestion.to,
                deco: strikethroughDeco,
            });
            decorations.push({
                from: suggestion.to,
                to: suggestion.to,
                deco: Decoration.widget({
                    widget: new GhostTextWidget(suggestion.suggestedText),
                    side: 1,
                }),
            });
            decorations.push({
                from: suggestion.to,
                to: suggestion.to,
                deco: Decoration.widget({
                    widget: new AcceptRejectButtonsWidget(
                        suggestion.id,
                        () => acceptSuggestion(view, suggestion.id),
                        () => rejectSuggestion(view, suggestion.id)
                    ),
                    side: 2,
                }),
            });
        } else if (hasSuggested) {
            // Pure insertion: ghost text only
            decorations.push({
                from: suggestion.from,
                to: suggestion.from,
                deco: Decoration.widget({
                    widget: new GhostTextWidget(suggestion.suggestedText),
                    side: 1,
                }),
            });
            decorations.push({
                from: suggestion.from,
                to: suggestion.from,
                deco: Decoration.widget({
                    widget: new AcceptRejectButtonsWidget(
                        suggestion.id,
                        () => acceptSuggestion(view, suggestion.id),
                        () => rejectSuggestion(view, suggestion.id)
                    ),
                    side: 2,
                }),
            });
        } else if (hasOriginal) {
            // Pure deletion: strikethrough only
            decorations.push({
                from: suggestion.from,
                to: suggestion.to,
                deco: strikethroughDeco,
            });
            decorations.push({
                from: suggestion.to,
                to: suggestion.to,
                deco: Decoration.widget({
                    widget: new AcceptRejectButtonsWidget(
                        suggestion.id,
                        () => acceptSuggestion(view, suggestion.id),
                        () => rejectSuggestion(view, suggestion.id)
                    ),
                    side: 2,
                }),
            });
        }
    }

    // Sort decorations by position (marks before widgets at same position)
    decorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        if (a.to !== b.to) return a.to - b.to;
        // Marks (from !== to) come before widgets (from === to)
        const aIsWidget = a.from === a.to;
        const bIsWidget = b.from === b.to;
        if (aIsWidget !== bIsWidget) return aIsWidget ? 1 : -1;
        return 0;
    });

    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to, deco } of decorations) {
        builder.add(from, to, deco);
    }

    return builder.finish();
}

const inlineDecorationPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            currentView = view;
            this.decorations = buildInlineDecorations(view.state, view);
        }

        update(update: ViewUpdate) {
            currentView = update.view;
            if (
                update.docChanged ||
                update.transactions.some(tr =>
                    tr.effects.some(e =>
                        e.is(setSuggestionsEffect) ||
                        e.is(acceptSuggestionEffect) ||
                        e.is(rejectSuggestionEffect) ||
                        e.is(acceptAllEffect) ||
                        e.is(rejectAllEffect)
                    )
                )
            ) {
                this.decorations = buildInlineDecorations(update.state, update.view);
            }
        }

        destroy() {
            // Clean up view reference if this plugin is being destroyed
        }
    },
    {
        decorations: v => v.decorations,
    }
);

// ─────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────

// Track title acceptance state separately
let titleAccepted = false;
let titleRejected = false;
let storedProposedTitle: string | undefined = undefined;

function acceptTitle(view: EditorView) {
    const state = view.state.field(suggestionStateField);
    storedProposedTitle = state.proposedTitle;
    titleAccepted = true;
    titleRejected = false;
    // Update state to remove title widget (by clearing proposedTitle)
    view.dispatch({
        effects: setSuggestionsEffect.of({
            suggestions: state.suggestions,
            proposedTitle: undefined,
            currentTitle: state.currentTitle,
            resolveCallback: state.resolveCallback,
        }),
    });
    checkAndResolve(view);
}

function rejectTitle(view: EditorView) {
    titleAccepted = false;
    titleRejected = true;
    storedProposedTitle = undefined;
    // Update state to remove title widget
    const state = view.state.field(suggestionStateField);
    view.dispatch({
        effects: setSuggestionsEffect.of({
            suggestions: state.suggestions,
            proposedTitle: undefined,
            currentTitle: state.currentTitle,
            resolveCallback: state.resolveCallback,
        }),
    });
    checkAndResolve(view);
}

function acceptSuggestion(view: EditorView, id: string) {
    const state = view.state.field(suggestionStateField);
    const suggestion = state.suggestions.find(s => s.id === id);
    if (!suggestion) return;

    // Validate positions before applying
    const docLength = view.state.doc.length;
    if (suggestion.from < 0 || suggestion.to < 0 || 
        suggestion.from > docLength || suggestion.to > docLength ||
        suggestion.from > suggestion.to) {
        console.warn('Invalid suggestion positions, removing suggestion');
        view.dispatch({
            effects: rejectSuggestionEffect.of(id),
        });
        checkAndResolve(view);
        return;
    }

    // Apply the change
    view.dispatch({
        changes: {
            from: suggestion.from,
            to: suggestion.to,
            insert: suggestion.suggestedText,
        },
        effects: acceptSuggestionEffect.of(id),
    });

    checkAndResolve(view);
}

function rejectSuggestion(view: EditorView, id: string) {
    view.dispatch({
        effects: rejectSuggestionEffect.of(id),
    });
    checkAndResolve(view);
}

function acceptAllSuggestions(view: EditorView) {
    const state = view.state.field(suggestionStateField);
    const { suggestions, proposedTitle, resolveCallback } = state;

    // Validate and filter suggestions with valid positions
    const docLength = view.state.doc.length;
    const validSuggestions = suggestions.filter(s => 
        s.from >= 0 && s.to >= 0 && 
        s.from <= docLength && s.to <= docLength &&
        s.from <= s.to
    );

    // Build changes from bottom to top to avoid position shifting issues
    const sortedSuggestions = [...validSuggestions].sort((a, b) => b.from - a.from);
    const changes = sortedSuggestions.map(s => ({
        from: s.from,
        to: s.to,
        insert: s.suggestedText,
    }));

    view.dispatch({
        changes,
        effects: acceptAllEffect.of(null),
    });

    // If there's a proposed title, accept it
    if (proposedTitle) {
        titleAccepted = true;
        storedProposedTitle = proposedTitle;
    }

    if (resolveCallback) {
        resolveCallback({
            text: view.state.doc.toString(),
            renameTo: titleAccepted ? (storedProposedTitle ?? proposedTitle) : undefined,
        });
    }

    // Reset title state
    titleAccepted = false;
    titleRejected = false;
    storedProposedTitle = undefined;
}

function rejectAllSuggestions(view: EditorView) {
    const state = view.state.field(suggestionStateField);
    const { resolveCallback } = state;

    view.dispatch({
        effects: rejectAllEffect.of(null),
    });

    if (resolveCallback) {
        resolveCallback(null);
    }

    // Reset title state
    titleAccepted = false;
    titleRejected = false;
    storedProposedTitle = undefined;
}

function checkAndResolve(view: EditorView) {
    const state = view.state.field(suggestionStateField);
    const { suggestions, proposedTitle, resolveCallback } = state;

    // Only resolve when all suggestions are handled and no title is pending
    if (suggestions.length === 0 && !proposedTitle && resolveCallback) {
        resolveCallback({
            text: view.state.doc.toString(),
            renameTo: titleAccepted ? storedProposedTitle : undefined,
        });
        // Reset title state
        titleAccepted = false;
        titleRejected = false;
        storedProposedTitle = undefined;
    }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** The CM6 extension to register with Obsidian */
export const inlineDiffExtension = [
    suggestionStateField,
    blockDecorationField,
    inlineDecorationPlugin,
];

/** Build suggestions from comparing original and modified text */
export function buildSuggestions(
    originalText: string,
    modifiedText: string,
    selectionStart: number,
    selectionEnd: number
): InlineSuggestion[] {
    const changes = diffLines(originalText, modifiedText);
    const suggestions: InlineSuggestion[] = [];
    let currentPos = selectionStart;
    let idCounter = 0;

    let pendingRemoval: { text: string; from: number; to: number } | null = null;

    for (const change of changes) {
        const text = change.value;

        if (change.added) {
            if (pendingRemoval) {
                // This is a replacement - validate bounds
                if (pendingRemoval.from >= selectionStart && pendingRemoval.to <= selectionEnd) {
                    suggestions.push({
                        id: `suggestion-${idCounter++}`,
                        from: pendingRemoval.from,
                        to: pendingRemoval.to,
                        originalText: pendingRemoval.text,
                        suggestedText: text,
                    });
                }
                pendingRemoval = null;
            } else {
                // Pure insertion - validate bounds
                if (currentPos >= selectionStart && currentPos <= selectionEnd) {
                    suggestions.push({
                        id: `suggestion-${idCounter++}`,
                        from: currentPos,
                        to: currentPos,
                        originalText: '',
                        suggestedText: text,
                    });
                }
            }
        } else if (change.removed) {
            const removeFrom = currentPos;
            const removeTo = currentPos + text.length;
            
            if (pendingRemoval) {
                // Multiple consecutive removals
                pendingRemoval.text += text;
                pendingRemoval.to = removeTo;
            } else {
                pendingRemoval = {
                    text,
                    from: removeFrom,
                    to: removeTo,
                };
            }
            currentPos = removeTo;
        } else {
            // Context (unchanged)
            if (pendingRemoval) {
                // Pure deletion - validate bounds
                if (pendingRemoval.from >= selectionStart && pendingRemoval.to <= selectionEnd) {
                    suggestions.push({
                        id: `suggestion-${idCounter++}`,
                        from: pendingRemoval.from,
                        to: pendingRemoval.to,
                        originalText: pendingRemoval.text,
                        suggestedText: '',
                    });
                }
                pendingRemoval = null;
            }
            currentPos += text.length;
        }
    }

    // Handle trailing removal - validate bounds
    if (pendingRemoval) {
        if (pendingRemoval.from >= selectionStart && pendingRemoval.to <= selectionEnd) {
            suggestions.push({
                id: `suggestion-${idCounter++}`,
                from: pendingRemoval.from,
                to: pendingRemoval.to,
                originalText: pendingRemoval.text,
                suggestedText: '',
            });
        }
    }

    // Filter out suggestions where original and suggested text are identical (no actual change)
    return suggestions.filter(s => s.originalText !== s.suggestedText);
}

/** Show inline suggestions in an editor view */
export function showInlineSuggestions(
    view: EditorView,
    suggestions: InlineSuggestion[],
    options?: {
        proposedTitle?: string;
        currentTitle?: string;
    }
): Promise<InlineDiffOutcome | null> {
    // Reset title state
    titleAccepted = false;
    titleRejected = false;
    storedProposedTitle = undefined;

    // Only show title suggestion if it's actually different from current title
    const effectiveProposedTitle = options?.proposedTitle && 
        options.proposedTitle.trim() !== '' &&
        options.proposedTitle.trim() !== options?.currentTitle?.trim()
            ? options.proposedTitle.trim()
            : undefined;

    return new Promise((resolve) => {
        view.dispatch({
            effects: setSuggestionsEffect.of({
                suggestions,
                proposedTitle: effectiveProposedTitle,
                currentTitle: options?.currentTitle,
                resolveCallback: (outcome) => {
                    resolve(outcome);
                },
            }),
        });
    });
}

/** Clear all suggestions without applying them */
export function clearSuggestions(view: EditorView) {
    view.dispatch({
        effects: rejectAllEffect.of(null),
    });
}

/** Check if there are active suggestions */
export function hasSuggestions(state: EditorState): boolean {
    const suggestionState = state.field(suggestionStateField, false);
    return suggestionState ? suggestionState.suggestions.length > 0 : false;
}
