import {App, PluginSettingTab, Setting} from "obsidian";
import type OllaMarkPlugin from "./main";
import { getAvailableModels } from "./utils/ollama";

export interface OllaMarkSettings {
	ollamaUrl: string;
	ollamaModel: string;
	formatComments: boolean;
}

export const DEFAULT_SETTINGS: OllaMarkSettings = {
	ollamaUrl: 'http://localhost:11434',
	ollamaModel: '',
	formatComments: true
}

export class OllaMarkSettingTab extends PluginSettingTab {
	declare plugin: OllaMarkPlugin & { settings: OllaMarkSettings; saveSettings: () => Promise<void> };

	constructor(app: App, plugin: OllaMarkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Ollama URL')
			.setDesc('URL where Ollama is running (default: http://localhost:11434)')
			.addText(text => text
				.setPlaceholder('http://localhost:11434')
				.setValue(this.plugin.settings.ollamaUrl)
				.onChange(async (value) => {
					this.plugin.settings.ollamaUrl = value;
					await this.plugin.saveSettings();
					// Refresh the models dropdown when URL changes
					void this.display();
				}));

		// Create a container for the model dropdown
		const modelSetting = new Setting(containerEl)
			.setName('Ollama model')
			.setDesc('Model to use for formatting');

		// Fetch and populate models
		this.populateModelDropdown(modelSetting);

		new Setting(containerEl)
			.setName('Format comments')
			.setDesc('Allow AI to format HTML comments (<!-- -->). When disabled, comments are preserved as-is.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.formatComments)
				.onChange(async (value) => {
					this.plugin.settings.formatComments = value;
					await this.plugin.saveSettings();
				}));
	}

	private populateModelDropdown(setting: Setting): void {
		void this.populateModelDropdownAsync(setting);
	}

	private async populateModelDropdownAsync(setting: Setting): Promise<void> {
		try {
			const models = await getAvailableModels(this.plugin.settings.ollamaUrl);
			
			if (models.length === 0) {
			setting.setDesc('No models found. Ensure Ollama is running at the specified URL.');
				setting.addText(text => text
					.setPlaceholder('Enter model name manually')
					.setValue(this.plugin.settings.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaModel = value;
						await this.plugin.saveSettings();
					}));
			} else {
				setting.addDropdown(dropdown => {
					models.forEach(model => {
						dropdown.addOption(model, model);
					});
					
					// Auto-select first model if current setting is empty or not in list
					const currentModel = this.plugin.settings.ollamaModel;
					if (!currentModel || !models.includes(currentModel)) {
						this.plugin.settings.ollamaModel = models[0] || '';
						void this.plugin.saveSettings();
					}
					
					dropdown.setValue(this.plugin.settings.ollamaModel);
					dropdown.onChange(async (value) => {
						this.plugin.settings.ollamaModel = value;
						await this.plugin.saveSettings();
					});
				});
			}
		} catch (error) {
			console.error('Error fetching models:', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			setting.setDesc(`Error fetching models: ${errorMessage}. You can enter the model name manually.`);
			setting.addText(text => text
				.setPlaceholder('Enter model name manually')
				.setValue(this.plugin.settings.ollamaModel)
				.onChange(async (value) => {
					this.plugin.settings.ollamaModel = value;
					await this.plugin.saveSettings();
				}));
		}
	}
}
