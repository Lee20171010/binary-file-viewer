import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {EditorDocument} from './editordocument';
import {ParserSelect} from './parserselect';
import {scopeLessFunctionCall} from './scopelessfunctioncall';


export class EditorProvider implements vscode.CustomReadonlyEditorProvider {

	// Have a weak map to trace all open webviews.
	// Used to update the webview in case the parser changed.
	protected static webViewMap = new WeakMap<EditorDocument, string>();


	/**
	 * Called by vscode when a file is opened.
	 * Create document
	 */
	public openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
		try {
			// Get the parser contents
			const filePath = uri.fsPath;
			let fileExt = path.extname(filePath);
			if (fileExt.length >= 1)
				fileExt = fileExt.slice(1); 	// Remove the '.'
			const parser = ParserSelect.selectParserFile(fileExt, filePath, undefined);
			if (!parser)
				return undefined;	// Nothing found

			// Return a document
			const doc = new EditorDocument();
			doc.uri = uri;
			doc.parser = parser;
			return doc;
		}
		catch (e) {
			console.log(e);
			return undefined;
		}
	}


	/**
	 * Called by vscode.
	 * Here vscode gives us the webview.
	 */
	public resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void | Thenable<void> {
		const doc = document as EditorDocument;
		const filePath = doc.uri.fsPath;
		const parser = doc.parser;

		// Allow js
		webviewPanel.webview.options = {
			enableScripts: true
		};

		try {
			// Handle 'ready' message from the webview
			webviewPanel.webview.onDidReceiveMessage(message => {
				switch (message.command) {
					case 'ready':
						// Read file
						const dataFs = fs.readFileSync(filePath);
						const data = Uint8Array.from(dataFs);
						// Send data
						this.sendDataToWebView(parser.contents, data, webviewPanel);
						break;
					case 'customParserError':
						// An error occurred during execution of the custom parser
						const stacks = message.text.split('\n');
						const match = /.*>:(\d+)/.exec(stacks[1]);
						let line = 0;
						if (match) {
							line = parseInt(match[1]);
							line -= 4;	// The reported number is too high, don't know why.
						}
						ParserSelect.addDiagnosticsMessage(stacks[0], parser.filePath, line);
						break;
				}
			});

			// Create html code
			const html = this.getMainHtml(webviewPanel);
			webviewPanel.webview.html = html;
		}
		catch (e) {
			console.error('Error: ', e);
		}
	}


	/**
	 * Reads the file and sends the data to the webview.
	 * @param parser The parser (js code) as a string
	 * @param data The file data to decode
	 * @param webviewPanel The webview to send the data to.
	 */
	protected sendDataToWebView(parser: string, data: Uint8Array, webviewPanel: vscode.WebviewPanel) {
		// Send file data to webview
		const message = {
			command: 'setData',
			parser,
			data
		};
		webviewPanel.webview.postMessage(message);
	}


	/**
	 * Returns the html code to display the text.
	 */
	protected getMainHtml(webviewPanel: any) {
		// Add the html styles etc.
		const extPath = vscode.extensions.getExtension("maziac.binary-file-viewer")!.extensionPath;
		const mainHtmlFile = path.join(extPath, 'html/main.html');
		let mainHtml = fs.readFileSync(mainHtmlFile).toString();
		// Exchange local path
		const resourcePath = vscode.Uri.file(extPath);
		const vscodeResPath = webviewPanel.webview.asWebviewUri(resourcePath).toString();
		mainHtml = mainHtml.replace('${vscodeResPath}', vscodeResPath);

		// Add a Reload and Copy button for debugging
		//mainHtml = mainHtml.replace('<body>', '<body><button onclick="parseStart()">Reload</button><button onclick="copyHtmlToClipboard()">Copy HTML to clipboard</button>');

		return mainHtml;
	}
}
