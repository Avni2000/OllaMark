import {App, PluginSettingTab, Setting} from "obsidian";
import MyPlugin from "./main";
import { getAvailableModels } from "./utils/ollama";

export interface MyPluginSettings {
	ollamaUrl: string;
	ollamaModel: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	ollamaUrl: 'http://localhost:11434',
	ollamaModel: 'qwen2.5:14b'
}

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
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
					this.display();
				}));

		// Create a container for the model dropdown
		const modelSetting = new Setting(containerEl)
			.setName('Ollama Model')
			.setDesc('Model to use for chat');

		// Fetch and populate models
		this.populateModelDropdown(modelSetting);
	}

	private async populateModelDropdown(setting: Setting) {
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
					dropdown.setValue(this.plugin.settings.ollamaModel);
					dropdown.onChange(async (value) => {
						this.plugin.settings.ollamaModel = value;
						await this.plugin.saveSettings();
					});
				});
			}
		} catch (error) {
			console.error('Error fetching models:', error);
			setting.setDesc(`Error fetching models: ${error}. You can enter the model name manually.`);
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
