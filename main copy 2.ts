import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!


interface RedirectorPluginSettings {
	triggerString: string;
}


const DEFAULT_SETTINGS: RedirectorPluginSettings = {
	triggerString: 'r['
}


export default class RedirectorPlugin extends Plugin {
	settings: RedirectorPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerEditorSuggest(
			new RedirectorEditorSuggest(this, this.settings)
		);
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


const toRegex = (str: string) => {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& = the whole matched string
};


class RedirectorEditorSuggest extends EditorSuggest<SuggestionObject> {
	plugin: RedirectorPlugin;
	settings: RedirectorPluginSettings;
	triggerString: string;
	triggerRegex: RegExp;

	constructor(plugin: RedirectorPlugin, settings: RedirectorPluginSettings) {
		super(plugin.app);
		this.plugin = plugin;
		this.settings = settings;
		this.triggerString = this.plugin.settings.triggerString;  // TODO
		this.triggerRegex = new RegExp(toRegex(this.triggerString));
	}

	// return null if not want to popup
	// return info if want to popup
	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);

		const toCursor = line.substring(0, cursor.ch);
		const prefix = toCursor
			.match(this.triggerRegex)
			?.first();
		if (!prefix) return null;

		new Notice("hey");

		const friendBracketsString = this.triggerString.match(/\]+$/)?.first();

		return {
			start: {
				line: cursor.line,
				ch: toCursor.lastIndexOf(prefix),
			},
			end: {
				line: cursor.line,
				ch:
					friendBracketsString &&
					editor.getLine(cursor.line).length > cursor.ch &&
					editor.getRange(cursor, {
						line: cursor.line,
						ch: cursor.ch + 1,
					}) === "]".repeat(friendBracketsString.length)
						? cursor.ch + 1
						: cursor.ch,
			},
			query: toCursor.substring(
				toCursor.lastIndexOf(prefix) + this.triggerString.length,
				toCursor.length
			),
		};
	}

	// TODO
	getSuggestions(context: EditorSuggestContext): SuggestionObject[] {
		return [];
	}

	// TODO
	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		return;
	}

	// TODO
	selectSuggestion(suggestion: SuggestionObject): void {
		return;
	}
}


class SuggestionObject {
	alias: string;
	path: string;
	originTFile: TFile;
	isAlias: boolean;
	embedPath: string;
	extension: string;
	redirectTFile: TFile;
};


class RedirectorModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}


class RedirectorSettingTab extends PluginSettingTab {
	plugin: RedirectorPlugin;

	constructor(app: App, plugin: RedirectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.triggerString)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.triggerString = value;
					await this.plugin.saveSettings();
				}));
	}
}
