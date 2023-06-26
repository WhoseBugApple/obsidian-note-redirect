import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, FileManager, MarkdownView, MetadataCache, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TagCache, Vault, WorkspaceLeaf, normalizePath, parseFrontMatterEntry } from 'obsidian';

// References
//   general
//     [Obsidian Developer Documentation](https://docs.obsidian.md/Home)
//   suggest & modal
//     [main.ts - obsidian-redirect - jglev - Github](https://github.com/jglev/obsidian-redirect/blob/main/main.ts#L155)

export default class RedirectorPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'report-links-to-redirect-files',
			name: 'Report links to redirect files',
			callback: () => {
				// get redirect files
				var redirectFiles: TFile[] = this.getRedirectFiles();
				if (redirectFiles.length == 0) return;
				
				// report links to redirect files
				this.createReport(redirectFiles);
			}
		});
	}

	onunload() {

	}

	getRedirectFiles(): TFile[] {
		var redirectFiles: TFile[] = app.vault.getMarkdownFiles().filter((file, idx, files) => {

			var redirectTags = app.metadataCache.getFileCache(file)?.tags?.filter((tag, idx, tags) => {
				return tag.tag.toLowerCase() == "#redirect";
			});
			var isTagSayRedirect = redirectTags && (redirectTags.length != 0);
			if (isTagSayRedirect) {
				return true;
			}

			var frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
			var yamlProp = parseFrontMatterEntry(frontmatter, 'redirect');
			var isYamlSayDirect = yamlProp == true;
			if (isYamlSayDirect) {
				return true;
			}

			return false;
		});

		return redirectFiles;
	}

	async createReport(redirectFiles: TFile[]) {
		var reportPath = "redirector report.md";
		var abstFile = app.vault.getAbstractFileByPath(reportPath);
		if (abstFile) {
			app.vault.delete(abstFile).then(() => {
				this.doCreateReport(redirectFiles, reportPath);
			})
		} else {
			this.doCreateReport(redirectFiles, reportPath);
		}
	}

	async doCreateReport(redirectFiles: TFile[], reportPath: string) {
		var reportText = '';
		var reportFile = await app.vault.create(reportPath, '');
		await app.workspace.getMostRecentLeaf()?.openFile(reportFile);
		// report
		var emptyReport = '';
		// report each file
		app.vault.getMarkdownFiles().forEach((file, idx, files) => {
			var reportForThisFile = emptyReport;
			// report each link
			app.metadataCache.getFileCache(file)?.links?.forEach((link, idx, links) => {
				var linkedRedirectFile = redirectFiles.find((rfile, idx, rfiles) => {
					var targetPath = app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path;
					return rfile.path == targetPath;
				})
				if (!linkedRedirectFile) return;
				// report this link
				var redirect: TFile = linkedRedirectFile;
				var linkToRedirect = app.fileManager.generateMarkdownLink(redirect, reportFile.path);
				reportForThisFile += '\t' + linkToRedirect + '\r\n';
				
			})
			if (reportForThisFile != emptyReport) {
				// if any report, add header (link to this file)
				var linkToFile = app.fileManager.generateMarkdownLink(file, reportFile.path);
				reportForThisFile = linkToFile + '\r\n' + reportForThisFile + '\r\n';
			}
			reportText += reportForThisFile;
		});
		if (reportText == emptyReport)
			reportText = 'vault is clean';
		// finish report
		app.vault.append(reportFile, reportText).then(() => {
			new Notice("Report OK");
		});
	}

	async openFile(
		app: App,
		file: TFile
	) {
		let leaf: WorkspaceLeaf;
	
		// open file in new tab
		leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file);
	
		// focus
		app.workspace.setActiveLeaf(leaf, { focus: true });
	
		// source view
		const leafViewState = leaf.getViewState();
		await leaf.setViewState({
			...leafViewState,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			state: {
				...leafViewState.state,
				mode: 'source',
			},
		});
	}
}
