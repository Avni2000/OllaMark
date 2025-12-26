import { App, Modal } from 'obsidian';
import { diffLines } from 'diff';

interface DiffSegment {
    kind: 'context' | 'add' | 'remove' | 'replace';
    original: string;
    modified: string;
    accepted: boolean;
}

interface DiffReviewParams {
    originalText: string;
    modifiedText: string;
    currentTitle?: string;
    newTitle?: string;
}

export interface DiffReviewOutcome {
    text: string;
    renameTo?: string;
}

function buildSegments(originalText: string, modifiedText: string): DiffSegment[] {
    const segments: DiffSegment[] = [];
    const parts = diffLines(originalText, modifiedText);
    let pendingRemoval: string | null = null;

    for (const part of parts) {
        if (part.added) {
            if (pendingRemoval !== null) {
                segments.push({
                    kind: 'replace',
                    original: pendingRemoval,
                    modified: part.value,
                    accepted: true,
                });
                pendingRemoval = null;
            } else {
                segments.push({
                    kind: 'add',
                    original: '',
                    modified: part.value,
                    accepted: true,
                });
            }
        } else if (part.removed) {
            if (pendingRemoval !== null) {
                pendingRemoval += part.value;
            } else {
                pendingRemoval = part.value;
            }
        } else {
            if (pendingRemoval !== null) {
                segments.push({
                    kind: 'remove',
                    original: pendingRemoval,
                    modified: '',
                    accepted: true,
                });
                pendingRemoval = null;
            }
            segments.push({
                kind: 'context',
                original: part.value,
                modified: part.value,
                accepted: true,
            });
        }
    }

    if (pendingRemoval !== null) {
        segments.push({
            kind: 'remove',
            original: pendingRemoval,
            modified: '',
            accepted: true,
        });
    }

    return segments;
}

function renderText(text: string): string {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return escaped
        .replace(/\n/g, '<span class="ollamark-diff-newline">\n</span>');
}

export class DiffReviewModal extends Modal {
    private readonly segments: DiffSegment[];
    private titleAccepted: boolean = true;
    private resolve: ((value: DiffReviewOutcome | null) => void) | null = null;
    private readonly currentTitle?: string;
    private readonly proposedTitle?: string;

    constructor(app: App, params: DiffReviewParams) {
        super(app);
        this.segments = buildSegments(params.originalText, params.modifiedText);
        this.currentTitle = params.currentTitle;
        this.proposedTitle = params.newTitle && params.newTitle.trim() !== '' ? params.newTitle.trim() : undefined;
        if (this.proposedTitle && this.currentTitle && this.proposedTitle === this.currentTitle) {
            this.proposedTitle = undefined;
        }
    }

    openWithPromise(): Promise<DiffReviewOutcome | null> {
        const promise = new Promise<DiffReviewOutcome | null>((resolve) => {
            this.resolve = resolve;
        });
        this.open();
        return promise;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ollamark-diff-modal');

        contentEl.createEl('h2', { text: 'Review AI changes' });
        contentEl.createEl('p', { text: 'Select which edits to keep, then apply or cancel.' });

        if (this.proposedTitle) {
            const titleContainer = contentEl.createDiv({ cls: 'ollamark-diff-title' });
            titleContainer.createEl('h3', { text: 'Proposed title' });

            const current = this.currentTitle ?? 'Untitled note';
            const originalEl = titleContainer.createDiv({ cls: 'ollamark-diff-block ollamark-diff-remove' });
            originalEl.innerHTML = `<strong>Current:</strong> ${renderText(current)}`;

            const proposedEl = titleContainer.createDiv({ cls: 'ollamark-diff-block ollamark-diff-add' });
            proposedEl.innerHTML = `<strong>New:</strong> ${renderText(this.proposedTitle)}`;

            const toggle = titleContainer.createDiv({ cls: 'ollamark-diff-actions' });
            const accept = toggle.createEl('button', { text: '✔ Keep', cls: 'mod-cta' });
            const reject = toggle.createEl('button', { text: '✘ Skip' });

            accept.addEventListener('click', () => {
                this.titleAccepted = true;
                accept.addClass('is-active');
                reject.removeClass('is-active');
            });

            reject.addEventListener('click', () => {
                this.titleAccepted = false;
                reject.addClass('is-active');
                accept.removeClass('is-active');
            });

            accept.addClass('is-active');
        }

        const list = contentEl.createDiv({ cls: 'ollamark-diff-list' });

        for (const segment of this.segments) {
            if (segment.kind === 'context') {
                const contextEl = list.createDiv({ cls: 'ollamark-diff-block ollamark-diff-context' });
                contextEl.innerHTML = renderText(segment.original);
                continue;
            }

            const block = list.createDiv({ cls: 'ollamark-diff-item' });
            const actions = block.createDiv({ cls: 'ollamark-diff-actions' });
            const accept = actions.createEl('button', { text: '✔ Keep', cls: 'mod-cta' });
            const reject = actions.createEl('button', { text: '✘ Skip' });

            assignActiveState(segment.accepted, accept, reject);

            accept.addEventListener('click', () => {
                segment.accepted = true;
                assignActiveState(true, accept, reject);
            });

            reject.addEventListener('click', () => {
                segment.accepted = false;
                assignActiveState(false, accept, reject);
            });

            if (segment.kind === 'replace') {
                const removed = block.createDiv({ cls: 'ollamark-diff-block ollamark-diff-remove' });
                removed.innerHTML = renderText(segment.original);
                const added = block.createDiv({ cls: 'ollamark-diff-block ollamark-diff-add' });
                added.innerHTML = renderText(segment.modified);
            } else if (segment.kind === 'add') {
                const added = block.createDiv({ cls: 'ollamark-diff-block ollamark-diff-add' });
                added.innerHTML = renderText(segment.modified);
            } else if (segment.kind === 'remove') {
                const removed = block.createDiv({ cls: 'ollamark-diff-block ollamark-diff-remove' });
                removed.innerHTML = renderText(segment.original);
            }
        }

        const footer = contentEl.createDiv({ cls: 'ollamark-diff-footer' });
        const applyBtn = footer.createEl('button', { text: 'Apply changes', cls: 'mod-cta' });
        const cancelBtn = footer.createEl('button', { text: 'Cancel' });

        applyBtn.addEventListener('click', () => {
            const resultText = this.buildResultText();
            this.closeWithResult({
                text: resultText,
                renameTo: this.titleAccepted && this.proposedTitle ? this.proposedTitle : undefined,
            });
        });

        cancelBtn.addEventListener('click', () => {
            this.closeWithResult(null);
        });
    }

    onClose() {
        if (this.resolve) {
            this.resolve(null);
            this.resolve = null;
        }
        this.contentEl.empty();
    }

    private buildResultText(): string {
        let output = '';
        for (const segment of this.segments) {
            switch (segment.kind) {
                case 'context':
                    output += segment.original;
                    break;
                case 'replace':
                    output += segment.accepted ? segment.modified : segment.original;
                    break;
                case 'add':
                    output += segment.accepted ? segment.modified : '';
                    break;
                case 'remove':
                    output += segment.accepted ? '' : segment.original;
                    break;
            }
        }
        return output;
    }

    private closeWithResult(result: DiffReviewOutcome | null) {
        if (this.resolve) {
            this.resolve(result);
            this.resolve = null;
        }
        this.close();
    }
}

function assignActiveState(accepted: boolean, acceptBtn: HTMLButtonElement, rejectBtn: HTMLButtonElement) {
    if (accepted) {
        acceptBtn.addClass('is-active');
        rejectBtn.removeClass('is-active');
    } else {
        acceptBtn.removeClass('is-active');
        rejectBtn.addClass('is-active');
    }
}

export async function reviewDiff(app: App, params: DiffReviewParams): Promise<DiffReviewOutcome | null> {
    const modal = new DiffReviewModal(app, params);
    return modal.openWithPromise();
}
