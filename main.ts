import { link, readFile } from 'fs';
import { url } from 'inspector';
import { App, CachedMetadata, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, FileManager, LinkCache, MarkdownView, MetadataCache, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder, TagCache, Vault, Workspace, WorkspaceLeaf, WorkspaceWindow, normalizePath, parseFrontMatterEntry } from 'obsidian';
import { report } from 'process';

// References
//   general
//     [Obsidian Developer Documentation](https://docs.obsidian.md/Home)
//   suggest & modal
//     [main.ts - obsidian-redirect - jglev - Github](https://github.com/jglev/obsidian-redirect/blob/main/main.ts#L155)
//   file
//     [Vault](https://docs.obsidian.md/Plugins/Vault)
//     [Vault class](https://docs.obsidian.md/Reference/TypeScript+API/Vault)
//     access metadata
//       [getFileCache](https://docs.obsidian.md/Reference/TypeScript+API/metadatacache/getFileCache)
//     access file view (source and preview)
//       const view = this.app.workspace.getActiveViewOfType(MarkdownView);
//       access source view (edit view)
//         access text
//           [Editor](https://docs.obsidian.md/Plugins/Editor/Editor)
//             read and modify text
//           [Editor class](https://docs.obsidian.md/Reference/TypeScript+API/Editor)
//         access html
//           view.containerEl  (includes content and file-name)
//           view.contentEl
//       access preview view (reading view)
//         access html
//           view.containerEl  (includes content and file-name)
//           view.contentEl
//           [Markdown post processing](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)
//             a post-processor of preview view
//             when open a preview view, it's called
//             can NOT get source view html-elements
//   callback
//     [Workspace class](https://docs.obsidian.md/Reference/TypeScript+API/Workspace)

export default class RedirectorPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'redirector-report-redirect-files',
			name: 'Report redirect-files',
			callback: () => {
				this.command_reportRedirectFiles();
			}
		});
		this.addCommand({
			id: 'redirector-move-redirect-file-besides-its-target',
			name: 'Move redirect-file besides its target',
			callback: () => {
				this.command_moveRedirectFilesBesidesItsTarget();
			}
		});
		this.addCommand({
			id: 'redirector-replace-links-to-redirect-file-with-links-to-its-target',
			name: 'Replace links to redirect-file with links to its target',
			callback: () => {
				this.command_replaceLinksToRedirectFileWithLinksToItsTarget();
			}
		});
		// TODO remove
		this.addCommand({
			id: 'redirector-test',
			name: 'Test',
			callback: () => {
				this.command_test();
			}
		});
	}

	onunload() {
		
	}

	reportName: string = "korc redirect-files report.md";
	parentOfReport_path: string = "";
	reportPath: string = this.parentOfReport_path + this.reportName;
	async command_reportRedirectFiles() {
		// idle
		await this.idle();

		// get redirect files
		var redirectFiles: TFile[] = await this.getRedirectFiles();
		if (redirectFiles.length == 0) {
			new Notice('report finished, NO redirect-file is found');
			return;
		}
		
		// report
		await this.createReport(redirectFiles, this.reportPath, this.reportName, this.parentOfReport_path);
	}

	async command_moveRedirectFilesBesidesItsTarget() {
		// idle
		await this.idle();

		// get redirect files
		var redirectFiles: TFile[] = await this.getRedirectFiles();
		if (redirectFiles.length == 0) {
			new Notice('move finished, NO redirect-file is found');
			return;
		}

		// move
		var rFilesIterator: IterableIterator<TFile> = redirectFiles.values();
		var count = await this.recursiveMoveRedirectFiles(rFilesIterator);
		new Notice('move finished, ' + count + ' redirect-files are moved');
	}

	async command_replaceLinksToRedirectFileWithLinksToItsTarget() {
		// idle
		await this.idle();

		// get redirect files
		var redirectFiles: TFile[] = await this.getRedirectFiles();
		if (redirectFiles.length == 0) {
			new Notice('replace finished, NO redirect-file is found');
			return;
		}

		// replace
		var count = await this.replaceLinksToRedirectFilesWithLinksToItsTarget(redirectFiles);
		new Notice('replace finished, ' + count + ' files are replaced');
	}

	// TODO remove
	async command_test() {
		await this.test();
	}

	// for each redirect-file, move it if necessary
	// return count of moved
	async recursiveMoveRedirectFiles(rFilesIterator: IterableIterator<TFile>): Promise<number> {
		var nextElementContainer = rFilesIterator.next();
		if (nextElementContainer.done) return 0;
		var rFile: TFile = nextElementContainer.value;
		
		// handle current
		var isMove = await this.moveIfNecessary(rFile);

		// next
		var count = await this.recursiveMoveRedirectFiles(rFilesIterator);
		return count + (isMove ? 1 : 0);
	}

	async moveIfNecessary(redirectFile: TFile): Promise<boolean> {
		var rFile: TFile = redirectFile;

		// get link
		var links = this.tryGetLinks(rFile);
		if (!links) return false;
		if (links.length != 1) return false;
		var link = links.at(0);
		if (!(link?.link)) return false;

		// get target
		var targetFile = this.tryGetLinkTarget(link.link, rFile.path);
		if (!targetFile) return false;
		
		// NOT move if same path
		if (targetFile.parent?.path == rFile.parent?.path) return false;

		// need to move
		var newDir = targetFile.parent?.path;
		if (!newDir) newDir = '';
		var newPath = this.concatDirectoryPathAndFileName(newDir, rFile.name);
		await this.moveOrRename_fileOrDirectory(rFile, newPath);

		return true;
	}

	getRedirectFiles(): TFile[] {
		var redirectFiles: TFile[] = this.getMarkdownFiles().filter((file, idx, files) => {
			var someTagSatisfy = this.tryGetFileMetadata(file)?.tags?.some((tag, idx, tags) => {
				return tag.tag.toLowerCase() == "#redirect";
			});
			var isTagSayRedirect = someTagSatisfy;
			if (isTagSayRedirect) {
				return true;
			}

			var frontmatter = this.tryGetFileMetadata(file)?.frontmatter;
			var yamlPropValue = parseFrontMatterEntry(frontmatter, 'redirect');
			var isYamlSayDirect = yamlPropValue == true;
			if (isYamlSayDirect) {
				return true;
			}

			return false;
		});

		return redirectFiles;
	}

	async createReport(redirectFiles: TFile[], 
		reportFilePath: string, reportName: string, parentOfReport_path: string) {
		// delete report if exist
		await this.removeReportFile(reportFilePath);
		var emptyReportText: string = '';
		var reportText: string = await this.getReportText(redirectFiles, reportFilePath, emptyReportText);
		await this.createReportFile(reportFilePath, reportText, emptyReportText);
	}

	async removeReportFile(reportFilePath: string) {
		await this.deleteFileIfExist(reportFilePath);
	}

	async getReportText(
		redirectFiles: TFile[], reportFilePath: string, emptyReportText: string): Promise<string> {
		var reportText: string = emptyReportText;
		reportText += await this.getLinksToRedirectFilesReportText(redirectFiles, reportFilePath, emptyReportText);
		reportText += await this.getIncorrectRedirectFilesPathReportText(redirectFiles, reportFilePath, emptyReportText);
		return reportText;
	}

	// should NOT link to redirect files, should link to its target
	async getLinksToRedirectFilesReportText(
		redirectFiles: TFile[], reportFilePath: string, emptyReportText: string): Promise<string> {
		return await this.getLinksToRedirectFilesReportText_traverseTheVault(redirectFiles, reportFilePath, emptyReportText);
		// return await this.getLinksToRedirectFilesReportText_useHiddenAPIs(redirectFiles, reportFilePath, emptyReportText);
	}

	async getLinksToRedirectFilesReportText_traverseTheVault(
		redirectFiles: TFile[], reportFilePath: string, emptyReportText: string): Promise<string> {
		// report
		var reportText: string = emptyReportText;
		var path2OneOfMap = this.getPath2OneOfMap(redirectFiles);
		// check each file
		var badFileId = 1;
		this.getMarkdownFiles().forEach((file, idx, files) => {
			var reportForThisFile = emptyReportText;
			// check each link
			this.tryGetFileMetadata(file)?.links?.forEach((link, idx, links) => {
				var targetFile = this.tryGetLinkTarget(link.link, file.path);
				if (targetFile == null) return;
				var targetPath = targetFile.path;

				// if good link then return
				var targetIsRedirectFile = false;
				if (path2OneOfMap.get(targetPath)) targetIsRedirectFile = true;
				if (!targetIsRedirectFile) return;

				// need to report this link, because its target is redirect file
				var redirectFile: TFile = targetFile;
				var linkToRedirectFile = this.generateMarkdownLink(redirectFile, reportFilePath);
				reportForThisFile += linkToRedirectFile + '\n\n';
			})
			if (reportForThisFile != emptyReportText) {
				// if any report, add extra-info (includes link to this file)
				var prefix = '';
				var headingForEntry = '## ' + badFileId + '\n';
				var headingForFile = '### bad-file\n';
				var linkToBadFile = this.generateMarkdownLink(file, reportFilePath) + '\n\n';
				var headingForBadLinks = '### link to redirect-files\n';
				prefix += headingForEntry + headingForFile + linkToBadFile + headingForBadLinks;
				reportForThisFile = prefix + reportForThisFile;
				reportText += reportForThisFile;
				badFileId++;
			}
		});
		if (reportText != emptyReportText) {
			// if any report, add extra-info
			reportText = '# should NOT link to Redirect-File\n' + reportText;
		}
		return reportText;
	}

	// very expensive (2023.11.03)
	// is the API async? if it is, should await
	async getLinksToRedirectFilesReportText_useHiddenAPIs(
		redirectFiles: TFile[], reportFilePath: string, emptyReportText: string): Promise<string> {
		// report
		var reportText: string = emptyReportText;
		var path2OneOfMap = this.getPath2OneOfMap(redirectFiles);
		// check each redirect-file
		var badRedirectFileId = 0;
		redirectFiles.forEach((rFile, idx, rFiles) => {
			var reportForThisFile = emptyReportText;
			var backFiles: Array<TFile> = this.tryGetBackFiles_useHiddenAPIs(rFile);
			backFiles.forEach((backFile: TFile, idx: number, backFiles: any) => {
				var badFile = backFile;
				var linkToBadFile = this.generateMarkdownLink(badFile, reportFilePath);
				reportForThisFile += linkToBadFile + '\n\n';
			});
			if (reportForThisFile != emptyReportText) {
				// if any report, add extra-info (includes link to this file)
				var prefix = '';
				var headingForEntry = '## ' + badRedirectFileId + '\n';
				var headingForRedirectFile = '### redirect-file\n';
				var linkToRedirectFile = this.generateMarkdownLink(rFile, reportFilePath) + '\n\n';
				var headingForBadFiles = '### bad-files\n';
				prefix += headingForEntry + headingForRedirectFile + linkToRedirectFile + headingForBadFiles;
				reportForThisFile = prefix + reportForThisFile;
				reportText += reportForThisFile;
				badRedirectFileId++;
			}
		});
		if (reportText != emptyReportText) {
			// if any report, add extra-info
			reportText = '# should NOT link to Redirect-File\n' + reportText;
		}
		return reportText;
	}

	// returns a special map, 
	// input a path of a markdown-file, output is that markdown-file is one of redirect-files, 
	// true stands for yes, undefined or false stands for no
	getPath2OneOfMap(redirectFiles: TFile[]) {
		var map = new Map<string, boolean>();
		redirectFiles.forEach(rFile => {
			map.set(rFile.path, true);
		});
		return map;
	}

	// if there is only 1 link in redirect files, then, 
	// should put redirect files besides it's target, at the same directory
	async getIncorrectRedirectFilesPathReportText(
		redirectFiles: TFile[], reportFilePath: string, emptyReportText: string): Promise<string> {
		// report
		var reportText: string = emptyReportText;
		// report each file
		redirectFiles.forEach((rFile, idx, rFiles) => {
			// get link
			var metadata = this.tryGetFileMetadata(rFile);
			var links = metadata?.links;
			if (!links) return;
			if (links.length != 1) return;
			var link = links.at(0);
			if (!(link?.link)) return;

			// get target
			var targetFile = this.tryGetLinkTarget(link.link, rFile.path);
			if (!targetFile) return;
			
			// compare directory
			if (targetFile.parent?.path != rFile.parent?.path) {
				// need to report
				var mdlink = this.generateMarkdownLink(rFile, reportFilePath);
				reportText += mdlink + '\n\n'
			}
		})
		// if there is any report, add a heading
		if (reportText != emptyReportText) {
			var heading = '# Redirect-Files are placed at incorrect directory\n' + 
							'should put each besides its Target-File\n\n';
			reportText = heading + reportText;
		}
		// return
		return reportText;
	}

	async createReportFile(reportFilePath: string, reportText: string, emptyReportText: string) {
		if (reportText == emptyReportText) {
			new Notice("report finished, nothing to report");
			return;
		}
		var reportFile = await this.createFile(reportFilePath, reportText);
		await this.openFile(reportFile);
		new Notice("report finished, see report-file");
	}

	getMarkdownFiles(): TFile[] {
		return this.getVault().getMarkdownFiles();
	}

	// don't forget suffix .md
	tryGetFile(path: string): TFile | null {
		var file: TFile | null = null;
		var fileOrFolder = this.getVault().getAbstractFileByPath(path);
		if (!fileOrFolder) return null;
		if (fileOrFolder instanceof TFile) {
			file = fileOrFolder;
		}
		return file;
	}

	tryGetDirectory(path: string): TFolder | null {
		var folder: TFolder | null = null;
		var fileOrFolder = this.getVault().getAbstractFileByPath(path);
		if (!fileOrFolder) return null;
		if (fileOrFolder instanceof TFolder) {
			folder = fileOrFolder;
		}
		return folder;
	}

	// if at least 1 link, return links, 
	// else return null
	tryGetLinks(file: TFile): LinkCache[] | null {
		var metadata = this.tryGetFileMetadata(file);
		if (!metadata) return null;
		var links = metadata.links;
		if (!links || links.length == 0) return null;
		return links;
	}

	tryGetFileMetadata(file: TFile): CachedMetadata | null {
		return this.getMetadataCache().getFileCache(file);
	}

	// the files that link to current file
	// [How to get backlinks for a file?](https://forum.obsidian.md/t/how-to-get-backlinks-for-a-file/45314/1)
	// very expensive (2023.11.03)
	// is the API async? if it is, should await
	tryGetBackFiles_useHiddenAPIs(file: TFile): Array<TFile> {
		var backFiles: Array<TFile> = [];
		var metadataCache: any = this.getMetadataCache();
		var backlinksContainer = metadataCache.getBacklinksForFile(file);
		backlinksContainer = backlinksContainer.data;
		Object.keys(backlinksContainer).forEach((filePath) => {
			var backFile = this.tryGetFile(filePath);
			if (!backFile) return;
			backFiles.push(backFile);
		})
		return backFiles;
	}

	// the links towards current file
	// [How to get backlinks for a file?](https://forum.obsidian.md/t/how-to-get-backlinks-for-a-file/45314/1)
	// very expensive (2023.11.03)
	// is the API async? if it is, should await
	tryGetBacklinks_useHiddenAPIs(file: TFile): Array<LinkCache> {
		var backlinks: Array<LinkCache> = [];
		var metadataCache: any = this.getMetadataCache();
		var backlinksContainer = metadataCache.getBacklinksForFile(file);
		backlinksContainer = backlinksContainer.data;
		Object.keys(backlinksContainer).forEach((filePath) => {
			var backlinks0: Array<LinkCache> = backlinksContainer[filePath];
			backlinks0.forEach((backlink) => {
				backlinks.push(backlink);
			})
		})
		return backlinks;
	}

	// at current file, try to get the target of link
	tryGetLinkTarget(link: string, pathOfCurrentFile: string): TFile | null {
		return this.getMetadataCache().getFirstLinkpathDest(link, pathOfCurrentFile);
	}

	// at current file, generate the markdown link of target file
	generateMarkdownLink(targetFile: TFile, pathOfCurrentFile: string): string {
		return this.getFileManager().generateMarkdownLink(targetFile, pathOfCurrentFile);
	}

	// [Move file to other locations dynamically using callbacks](https://forum.obsidian.md/t/move-file-to-other-locations-dynamically-using-callbacks/64334)
	// change the path
	async moveOrRename_fileOrDirectory(fileOrDirectory: TAbstractFile, newPath: string) {
		await this.getFileManager().renameFile(fileOrDirectory, newPath);
	}

	async deleteFileIfExist(path: string) {
		var file = this.tryGetFile(path);
		if (!file) return;
		await this.getVault().delete(file);
	}

	// delete a exist file
	async deleteFile(path: string) {
		var file = this.tryGetFile(path);
		if (!file) {
			this.reportLog('can NOT find file', true, false);
			throw new Error('report error');
		}
		await this.getVault().delete(file);
	}

	async createFile(path: string, content: string) {
		return await this.getVault().create(path, content);
	}

	// [Workspace](https://docs.obsidian.md/Plugins/User+interface/Workspace)
	// [Workspace class](https://docs.obsidian.md/Reference/TypeScript+API/Workspace)
	// [Workspace.getLeaf() method](https://docs.obsidian.md/Reference/TypeScript+API/workspace/getLeaf_1)
	// split display all the childs
	// tabs display one of childs, at any moment
	async openFile(
		file: TFile
	) {
		let leaf: WorkspaceLeaf;

		// open file in new tab
		leaf = this.getWorkspace().getLeaf('tab');
		await leaf.openFile(file);
	
		// focus
		this.getWorkspace().setActiveLeaf(leaf, { focus: true });
	
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

	concatDirectoryPathAndFileName(dirPath: string, fileName: string): string {
		var concated: string = '';
		// get path separator & normalize path
		var sep = this.getPathSeparator();
		var dirPathAsPrefix = normalizePath(dirPath);
		// is root dir?
		var rootDir = false;
		if (dirPathAsPrefix == '' || dirPathAsPrefix == sep) {
			rootDir = true;
		}
		// prepare prefix, the dir path
		if (rootDir) {
			dirPathAsPrefix = '';
		} else {
			if (!dirPathAsPrefix.endsWith(sep)) {
				dirPathAsPrefix += sep;
			}
		}
		// concat & normalize
		concated = normalizePath(dirPathAsPrefix + fileName);
		// return
		return concated;
	}

	sep: string = '';

	getPathSeparator() {
		if (this.sep == '') {
			this.sep = normalizePath('/');
			// if normalizePath() do NOT tell me the separator
			if (this.sep == '') this.sep = '/';
			// check it before return
			if (!['/', '\\'].includes(this.sep)) {
				throw new Error('the accquired path-separator is strange, it\'s ' + this.sep + ' , so stop the execution');
			}
		}
		return this.sep;
	}

	// cached
	// sep str to lines
	strToLinesMap_cache: Map<string, string[]> = new Map();
	cachedStrToLines(str: string, removeSeparatorFromLines: boolean = true, separators : string[]= ['\r\n', '\n']) {
		// return from cache if exist
		var cachedOrNull = this.strToLinesMap_cache.get(str);
		if (cachedOrNull) return cachedOrNull;

		// do compute
		return this.strToLines(str, removeSeparatorFromLines, separators);
	}

	// remove from the cache
	removeCacheFromCachedStrToLines(str: string) {
		this.strToLinesMap_cache.delete(str);
	}

	// sep str to lines
	strToLines(str: string, removeSeparatorFromLines: boolean = true, separators : string[]= ['\r\n', '\n']): string[] {
		// sort sep from long to short
		separators.sort((sep1, sep2) => {
			return sep1.length - sep2.length;
		});
		return this.strToLinesBody(str, 0, separators, removeSeparatorFromLines);
	}

	// sep str-from-a-index to lines
	private strToLinesBody(str: string, strStartIdx: number, separators : string[], removeSeparator: boolean, lines: string[] = []): string[] {
		// try to find next sep in each substr
		var isFoundSep = false;
		var prefix = '';  // includes sep or NOT, depends
		var theFoundSep = '';
		var suffixStartIdx = -1;  // NOT includes sep
		for(var i=strStartIdx; i<str.length; i++) {
			// each substr, is the str starts from i
			// is there a sep?
			for(var j=0; j<separators.length; j++) {
				// each sep
				var sep = separators[j];
				if (str.startsWith(sep, i)) {
					var sepStartIdx = i;
					var sepEndIdxExclusive = sepStartIdx + sep.length;
					isFoundSep = true;
					if (removeSeparator)
						prefix = str.substring(strStartIdx, sepStartIdx);
					else
						prefix = str.substring(strStartIdx, sepEndIdxExclusive);
					theFoundSep = sep;
					suffixStartIdx = sepEndIdxExclusive;
					break;
				}
			}
			if (isFoundSep) break;
		}

		// if NOT found next sep then
		if (!isFoundSep) {
			lines.push(str.substring(strStartIdx));
			return lines;
		}
		
		// found the sep
		lines.push(prefix);
		return this.strToLinesBody(str, suffixStartIdx, separators, removeSeparator, lines);
	}

	standardSeparator: string = '\n';
	linesToStr(strArr: string[]): string {
		var combined = '';
		strArr.forEach((str, idx) => {
			if (idx == 0)
				combined += str;
			else
				combined += this.standardSeparator + str;
		})
		return combined;
	}

	sortLinksFromTailToHead(pairs: MisleadingLinkAndRealTarget[]): MisleadingLinkAndRealTarget[] {
		var sorted = pairs.sort((a, b) => {
			var apos = a.misleadingLink.position;
			var bpos = b.misleadingLink.position;
			if (apos.end <= bpos.start) {
				return -1;
			} else if (bpos.end <= apos.start) {
				return 1;
			} else {
				this.reportLog('fail to sort links');
				return 0;
			}
		})
		return sorted;
	}

	// return how many links is changed
	async replaceLinksInFile(pairs: MisleadingLinkAndRealTarget[], file: TFile, log: boolean = true): Promise<number> {
		var linksChanged = 0;
		var oldLinks: string[] = [];
		var newLinks: string[] = [];

		pairs = this.sortLinksFromTailToHead(pairs);

		await this.updateFile(file, (content) => {
			var newContent = content;
			var lines = this.strToLines(newContent);
			pairs.forEach((pair) => {
				var link = pair.misleadingLink;
				var newTarget = pair.realTarget;

				// link info
				var linkStart = link.position.start;
				var linkEnd = link.position.end;
				var linkContent = link.original;
				var newLink = pair.getRealMarkdownLink();
				if (newLink == linkContent) return;

				// try found link in lines
				var tryFoundLine = lines[linkStart.line];
				var tryFound = tryFoundLine.substring(linkStart.col, linkEnd.col);
				if (tryFound != linkContent) {
					console.log(link);
					this.reportLog('can NOT locate link in file, \n' + 
						`file ${file.name}\n` + 
						`filepath ${file.path}\n` + 
						`expect ${linkContent}\n` + 
						`found ${tryFound}`, 
						false);
					return;
				}
	
				// has found link in content
				var foundLine = tryFoundLine;
				var found = tryFound;
				var prefix = foundLine.substring(0, linkStart.col);
				var suffix = foundLine.substring(linkEnd.col);
				
				// get new line
				var newLine = prefix + newLink + suffix;

				// replace in lines
				lines[linkStart.line] = newLine;

				// others
				linksChanged++;
				oldLinks.push(linkContent);
				newLinks.push(newLink);
			});

			newContent = this.linesToStr(lines);
			return newContent;
		});

		// log
		if (log) {
			if (linksChanged > 0) {
				console.log('\n+++++ File Changed Log Start ++++++++++++++++')
				console.log(
					'\n' + 
					`filename: ${file.name}\n` + 
					`filepath: ${file.path}\n` + 
					`countLinksChanged = ${linksChanged}`);
				var detailedLinksChangeLog = '';
				for(var i=0; i<linksChanged; i++) {
					detailedLinksChangeLog += `\n- oldLink: ${oldLinks[i]}`;
					detailedLinksChangeLog += `\n  - newLink: ${newLinks[i]}`;
				}
				console.log(detailedLinksChangeLog);
				console.log('\n------------- File Changed Log End -----')
			}
		}

		return linksChanged;
	}

	tryGetRedirectFileTarget(redirectFile: TFile): TFile | null {
		var metadata = this.tryGetFileMetadata(redirectFile);
		if (!metadata) return null;

		var links = metadata.links;
		if (!links || links.length == 0) return null;

		var link: LinkCache = links[0];
		var linkStr = link.link;

		var linkTarget = this.tryGetLinkTarget(linkStr, redirectFile.path);
		if (!linkTarget) return null;

		return linkTarget;
	}

	async replaceLinksToRedirectFilesWithLinksToItsTarget(redirectFiles: TFile[]): Promise<number> {
			var path2OneOfMap = this.getPath2OneOfMap(redirectFiles);
			// check each file
			var mdfiles = this.getMarkdownFiles();
			var mdfilesIterator = mdfiles.values();
			return await this.replaceLinksToRedirectFilesWithLinksToItsTarget_loop(
				mdfilesIterator, 
				path2OneOfMap);
	}

	// return count of modified file
	async replaceLinksToRedirectFilesWithLinksToItsTarget_loop(
							mdfilesIterator: IterableIterator<TFile>, 
							path2OneOfMap: Map<string, boolean>): Promise<number> {
		var countModifiedFile = 0;

		while (true) {
			var nextElementContainer = mdfilesIterator.next();
			if (nextElementContainer.done) break;
			var file: TFile = nextElementContainer.value;

			// find badlinks in links
			var pairs: MisleadingLinkAndRealTarget[] = [];
			this.tryGetFileMetadata(file)?.links?.forEach((link, idx, links) => {
				var targetFile = this.tryGetLinkTarget(link.link, file.path);
				if (!targetFile) return;
				var targetPath = targetFile.path;

				// if good link then return
				var targetIsRedirectFile = false;
				if (path2OneOfMap.get(targetPath)) targetIsRedirectFile = true;
				if (!targetIsRedirectFile) return;

				// need to fix this link
				var redirectFile: TFile = targetFile;
				var realTarget = this.tryGetRedirectFileTarget(redirectFile);
				if (!realTarget) return;

				// output found bad links
				var pair = new MisleadingLinkAndRealTarget(file, link, realTarget, this);
				pairs.push(pair);
			})

			// replace if any bad
			if (pairs.length != 0) {
				// replace
				var linksChanged = await this.replaceLinksInFile(pairs, file);
				var filesChanged = linksChanged >= 1 ? 1 : 0;
				countModifiedFile += filesChanged;
				continue;
			} else {
				continue;
			}
		}

		return countModifiedFile;
	}

	async updateFile(file: TFile, callback: (fileContent: string) => string) {
		await this.getVault().process(file, callback);
	}

	async readFile(file: TFile): Promise<string> {
		return await this.getVault().read(file);
	}

	async writeFile(file: TFile, data: string) {
		await this.getVault().modify(file, data);
	}

	getApp(): App {
		return this.app;
	}

	getWorkspace(): Workspace {
		return this.getApp().workspace;
	}

	getVault(): Vault {
		return this.getApp().vault;
	}

	getFileManager(): FileManager {
		return this.getApp().fileManager;
	}

	getMetadataCache(): MetadataCache {
		return this.getApp().metadataCache;
	}

	reportLog(message: string, throwError: boolean = true, toastsNotice: boolean = true, logConsole: boolean = true) {
		if (logConsole) {
			console.log('=========== Report Start ===========');
			console.log(message);
			console.trace();
		}
		if (toastsNotice) {
			new Notice(message);
			new Notice('see more log in console, \n' + 'Ctrl+Shift+I to open console');
		}
		if (throwError)
			throw new Error(message);
	}

	// await me to immediately return a async-function
	async idle() {}

	// TODO remove
	async test() {
		try {
			new Notice('this is redirector');
			// console.clear();
		} catch(err) {
			console.log(err);
		}
	}
}

class MisleadingLinkAndRealTarget {
	readonly currentFile: TFile;
	readonly misleadingLink: LinkCache;
	readonly realTarget: TFile;
	readonly plugin: RedirectorPlugin;

	constructor(currentFile: TFile, misleadingLink: LinkCache, realTarget: TFile, plugin: RedirectorPlugin) {
		this.currentFile = currentFile;
		this.misleadingLink = misleadingLink;
		this.realTarget = realTarget;
		this.plugin = plugin;
	}

	getRealMarkdownLink(): string {
		return this.plugin.generateMarkdownLink(this.realTarget, this.currentFile.path);
	}

	isNeedUpdate(): boolean {
		var real = this.getRealMarkdownLink();
		var prev = this.misleadingLink.original;
		return real != prev;
	}
}
