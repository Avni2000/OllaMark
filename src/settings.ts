import {App, PluginSettingTab, Setting} from "obsidian";
import MyPlugin from "./main";

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
				}));

		new Setting(containerEl)
			.setName('Ollama Model')
			.setDesc('Model name to use for chat (default: qwen2.5:14b)')
			.addText(text => text
				.setPlaceholder('qwen2.5:14b')
				.setValue(this.plugin.settings.ollamaModel)
				.onChange(async (value) => {
					this.plugin.settings.ollamaModel = value;
					await this.plugin.saveSettings();
				}));
	}
}
