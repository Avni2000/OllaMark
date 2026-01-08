/**
 * @file InlinePrompt.ts
 * @description Inline floating prompt input that appears below the cursor.
 */
import { Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';

export interface InlinePromptResult {
	prompt: string;
}

/** Preset prompts that can be assigned hotkeys */
export const PRESET_PROMPTS = [
	{ id: 'add-headings', name: 'Add headings to organize content', prompt: 'Add headings to break up and organize the content without losing my voice' },
	{ id: 'make-concise', name: 'Make more concise', prompt: 'Make this more concise without losing my voice' },
	{ id: 'bullet-points', name: 'Convert to bullet points', prompt: 'Convert this to bullet points without losing my voice' },
	{ id: 'fix-grammar', name: 'Fix grammar only', prompt: 'Only fix grammar and punctuation, change nothing else' },
	{ id: 'improve-flow', name: 'Improve paragraph flow', prompt: 'Improve the flow between paragraphs' },
] as const;

export type PresetPromptId = typeof PRESET_PROMPTS[number]['id'];

/**
 * Shows an inline prompt widget below the cursor.
 * Returns the user's prompt or null if cancelled.
 */
export function showInlinePrompt(editor: Editor): Promise<InlinePromptResult | null> {
	return new Promise((resolve) => {
		// @ts-expect-error - accessing internal CM6 editor
		const editorView = editor.cm as EditorView | undefined;
		if (!editorView) {
			resolve(null);
			return;
		}

		// Get cursor position for placement
		const cursor = editor.getCursor('to');
	const offset = editor.posToOffset(cursor);
	let coords;
	try {
		coords = editorView.coordsAtPos(offset);
	} catch {
		// coordsAtPos may throw if position is invalid
		resolve(null);
		return;
	}
	if (!coords) {
		resolve(null);
		return;
	}

	// Create the inline widget
	const widget = new InlinePromptWidget(coords, resolve);
	widget.mount(document.body);
});
}

class InlinePromptWidget {
	private container: HTMLElement;
	private input: HTMLInputElement;
	private dropdown: HTMLElement;
	private dropdownToggle: HTMLElement;
	private dropdownItems: HTMLElement[] = [];
	private selectedIndex = -1;
	private isDropdownOpen = false;
	private isDropup = false;
	private resolve: (value: InlinePromptResult | null) => void;

	constructor(
		private coords: { top: number; left: number; bottom: number },
		resolve: (value: InlinePromptResult | null) => void
	) {
		this.resolve = resolve;
		this.container = this.createContainer();
		const inputElement = this.container.querySelector('.ollamark-inline-input');
		const dropdownElement = this.container.querySelector('.ollamark-inline-dropdown');
		const toggleElement = this.container.querySelector('.ollamark-dropdown-toggle');
		
		if (!(inputElement instanceof HTMLInputElement) || !(dropdownElement instanceof HTMLElement) || !(toggleElement instanceof HTMLElement)) {
			throw new Error('Failed to create inline prompt widget');
		}
		
		this.input = inputElement;
		this.dropdown = dropdownElement;
		this.dropdownToggle = toggleElement;
		this.dropdownItems = Array.from(this.dropdown.querySelectorAll('.ollamark-dropdown-item'));
	}

	private createContainer(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'ollamark-inline-prompt';
		
		// Create elements programmatically to avoid innerHTML security issues
		const inner = document.createElement('div');
		inner.className = 'ollamark-inline-prompt-inner';
		
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'ollamark-inline-input';
		input.placeholder = 'Custom instructions... (↓ for presets)';
		
		const toggleBtn = document.createElement('button');
		toggleBtn.className = 'ollamark-dropdown-toggle';
		toggleBtn.setAttribute('aria-label', 'Show presets');
		toggleBtn.textContent = '▼';
		
		inner.appendChild(input);
		inner.appendChild(toggleBtn);
		
		const dropdown = document.createElement('div');
		dropdown.className = 'ollamark-inline-dropdown ollamark-hidden';
		
		PRESET_PROMPTS.forEach((p, i) => {
			const item = document.createElement('div');
			item.className = 'ollamark-dropdown-item';
			item.dataset.index = String(i);
			item.dataset.prompt = p.prompt;
			item.textContent = p.name;
			dropdown.appendChild(item);
		});
		
		container.appendChild(inner);
		container.appendChild(dropdown);

		// Position below cursor using setCssStyles
		container.setCssStyles({
			position: 'fixed',
			left: `${this.coords.left}px`,
			top: `${this.coords.bottom + 4}px`,
			zIndex: '10000',
		});

		return container;
	}

	mount(parent: HTMLElement): void {
		parent.appendChild(this.container);

		// Bind events
		this.input.addEventListener('keydown', this.handleKeyDown);
		this.input.addEventListener('input', this.handleInput);
		
		const toggleBtn = this.container.querySelector('.ollamark-dropdown-toggle') as HTMLElement;
		toggleBtn.addEventListener('click', this.toggleDropdown);

		this.dropdownItems.forEach((item) => {
			item.addEventListener('click', () => this.selectItem(item));
			item.addEventListener('mouseenter', () => this.highlightItem(parseInt(item.dataset.index || '0', 10)));
		});

		// Close on outside click
		document.addEventListener('mousedown', this.handleOutsideClick);

		// Focus input
		requestAnimationFrame(() => this.input.focus());

		// Ensure widget stays in viewport
		this.adjustPosition();
	}

	private adjustPosition(): void {
		const rect = this.container.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Adjust horizontal if overflowing right
		if (rect.right > viewportWidth - 10) {
			this.container.style.left = `${viewportWidth - rect.width - 10}px`;
		}

		// Adjust vertical if overflowing bottom
		if (rect.bottom > viewportHeight - 10) {
			// Show above cursor instead
			this.container.style.top = `${this.coords.top - rect.height - 4}px`;
		}

		// Check if dropdown should open upward (dropup)
		this.checkDropupNeeded();
	}

	private checkDropupNeeded(): void {
		const rect = this.container.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		
		// Estimate dropdown height (based on number of items)
		const estimatedDropdownHeight = this.dropdownItems.length * 40; // approximate height per item
		
		// Check if dropdown would overflow bottom
		const wouldOverflowBottom = rect.bottom + estimatedDropdownHeight > viewportHeight - 10;
		
		// Check if there's enough space above
		const hasSpaceAbove = rect.top > estimatedDropdownHeight + 10;
		
		this.isDropup = wouldOverflowBottom && hasSpaceAbove;
		
		if (this.isDropup) {
			this.dropdown.classList.add('ollamark-dropup');
			this.dropdownToggle.textContent = '▲';
		} else {
			this.dropdown.classList.remove('ollamark-dropup');
			this.dropdownToggle.textContent = '▼';
		}
	}

	private handleKeyDown = (e: KeyboardEvent): void => {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				this.close(null);
				break;

			case 'Enter':
				e.preventDefault();
				if (this.isDropdownOpen && this.selectedIndex >= 0) {
					const item = this.dropdownItems[this.selectedIndex];
					if (item) this.selectItem(item);
				} else if (this.input.value.trim()) {
					this.close({ prompt: this.input.value.trim() });
				}
				break;

			case 'ArrowDown':
				e.preventDefault();
				if (!this.isDropdownOpen) {
					this.openDropdown();
				} else {
					this.moveSelection(1);
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				if (this.isDropdownOpen) {
					this.moveSelection(-1);
				}
				break;

			case 'Tab':
				if (this.isDropdownOpen) {
					e.preventDefault();
					this.moveSelection(e.shiftKey ? -1 : 1);
				}
				break;
		}
	};

	private handleInput = (): void => {
		// Close dropdown when user types
		if (this.isDropdownOpen && this.input.value) {
			this.closeDropdown();
		}
	};

	private handleOutsideClick = (e: MouseEvent): void => {
		if (!this.container.contains(e.target as Node)) {
			this.close(null);
		}
	};

	private toggleDropdown = (): void => {
		if (this.isDropdownOpen) {
			this.closeDropdown();
		} else {
			this.openDropdown();
		}
	};

	private openDropdown(): void {
		this.checkDropupNeeded();
		this.dropdown.classList.remove('ollamark-hidden');
		this.isDropdownOpen = true;
		this.selectedIndex = 0;
		this.updateHighlight();
		this.dropdownToggle.textContent = this.isDropup ? '▲' : '▼';
	}

	private closeDropdown(): void {
		this.dropdown.classList.add('ollamark-hidden');
		this.isDropdownOpen = false;
		this.selectedIndex = -1;
		this.updateHighlight();
		this.dropdownToggle.textContent = this.isDropup ? '▲' : '▼';
	}

	private moveSelection(delta: number): void {
		const newIndex = this.selectedIndex + delta;
		if (newIndex >= 0 && newIndex < this.dropdownItems.length) {
			this.selectedIndex = newIndex;
			this.updateHighlight();
		}
	}

	private highlightItem(index: number): void {
		this.selectedIndex = index;
		this.updateHighlight();
	}

	private updateHighlight(): void {
		this.dropdownItems.forEach((item, i) => {
			item.classList.toggle('ollamark-dropdown-item-selected', i === this.selectedIndex);
		});

		// Scroll into view if needed
		if (this.selectedIndex >= 0) {
			const item = this.dropdownItems[this.selectedIndex];
			if (item) item.scrollIntoView({ block: 'nearest' });
		}
	}

	private selectItem(item: HTMLElement): void {
		const prompt = item.dataset.prompt;
		if (prompt) {
			this.close({ prompt });
		}
	}

	private close(result: InlinePromptResult | null): void {
		document.removeEventListener('mousedown', this.handleOutsideClick);
		this.container.remove();
		this.resolve(result);
	}
}
