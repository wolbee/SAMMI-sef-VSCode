import * as path from "path";
import { commands, CompletionList, ExtensionContext, Hover, ProviderResult, Uri, window, workspace } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { fileRegion, getVirtualContent } from "./embeddedSupport";
import { installExtension, uninstallExtension } from "./utils/extensionCommands";
import { getBridges, getExtensionNames, readFile, saveBridge } from "./utils/extensionHelpers";

let client: LanguageClient;

export async function activate(context: ExtensionContext) {
	context.subscriptions.push(
		commands.registerCommand("sammi.installExtension", async () => {
			const extensionPath = window.activeTextEditor?.document.uri.fsPath;
			if (extensionPath === undefined) {
				window.showInformationMessage(`There is no file open`);
				return;
			}
			const bridges = getBridges();
			const selection = await window.showQuickPick(Object.keys(bridges));
			if (selection === undefined) {
				window.showInformationMessage(`Missing Bridge Path`);
				return;
			}
			let bridgePath: string;
			if (bridges[selection] === "new") {
				const newBridge = await window.showInputBox();
				if (newBridge) {
					bridgePath = newBridge;
				} else {
					window.showInformationMessage(`Missing Bridge Path`);
					return;
				}
			} else {
				bridgePath = bridges[selection];
			}
			window.showInformationMessage(`Bridge: ${bridgePath}`);
			const bridgeContent = await readFile("Bridge", bridgePath);
			if (bridgeContent === undefined) return;
			const newBridgeContent = await installExtension(bridgeContent, extensionPath);
			if (newBridgeContent === undefined) return;
			saveBridge(bridgePath, newBridgeContent);
		}),

		commands.registerCommand("sammi.uninstallExtension", async () => {
			const extensionPath = window.activeTextEditor?.document.uri.fsPath;
			if (extensionPath === undefined) {
				window.showInformationMessage(`There is no file open`);
				return;
			}
			const bridges = getBridges();
			const bridgeSelected = await window.showQuickPick(Object.keys(bridges));
			if (bridgeSelected === undefined) {
				window.showInformationMessage(`Missing Bridge Path`);
				return;
			}
			let bridgePath: string;
			if (bridges[bridgeSelected] === "new") {
				const newBridge = await window.showInputBox();
				if (newBridge) {
					bridgePath = newBridge;
				} else {
					window.showInformationMessage(`Missing Bridge Path`);
					return;
				}
			} else {
				bridgePath = bridges[bridgeSelected];
			}
			window.showInformationMessage(`Bridge: ${bridgePath}`);
			const bridgeContent = await readFile("Bridge", bridgePath);
			if (bridgeContent === undefined) return;
			const extensionNames = await getExtensionNames(bridgeContent);
			if (extensionNames === undefined) return;
			if (extensionNames.length === 0) {
				window.showInformationMessage(`There are no extensions installed in the Bridge`);
				return;
			}
			const extensionSelected = await window.showQuickPick(extensionNames);
			if (!extensionSelected) {
				window.showInformationMessage(`No extension selected`);
				return;
			}
			const newBridgeContent = uninstallExtension(bridgeContent, extensionSelected);
			if (newBridgeContent === undefined) {
				return;
			}
			saveBridge(bridgePath, newBridgeContent);
		})
	);

	const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
	const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions,
		},
	};

	const virtualDocumentContents = new Map<string, string>();

	workspace.registerTextDocumentContentProvider("embedded-content", {
		provideTextDocumentContent: (uri) => {
			const extension = uri.path.lastIndexOf(".");
			const originalUri = uri.path.slice(1, extension);
			const decodedUri = decodeURIComponent(originalUri);
			return virtualDocumentContents.get(decodedUri);
		},
	});

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "sef" }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
		},
		markdown: {
			isTrusted: true,
		},
		middleware: {
			provideCompletionItem: async (document, position, context, token, next) => {
				await workspace.openTextDocument(document.uri);
				const region = fileRegion(document, position, true);
				if (region === "SAMMI") {
					return await next(document, position, context, token);
				}

				const originalUri = document.uri.toString(true);
				virtualDocumentContents.set(originalUri, getVirtualContent(region, document.getText()));

				const vdocUriString = `embedded-content://${region}/${encodeURIComponent(originalUri)}.${region}`;
				const vdocUri = Uri.parse(vdocUriString);
				return await commands.executeCommand<CompletionList>(
					"vscode.executeCompletionItemProvider",
					vdocUri,
					position,
					context.triggerCharacter
				);
			},

			provideHover: async (document, position, token, next) => {
				const region = fileRegion(document, position);
				if (region === "SAMMI") {
					return await next(document, position, token);
				}

				const originalUri = document.uri.toString(true);
				const decodedUri = decodeURIComponent(originalUri);
				virtualDocumentContents.set(originalUri, getVirtualContent(region, document.getText()));

				const vdocUriString = `embedded-content://${region}/${encodeURIComponent(decodedUri)}.${region}`;
				const vdocUri = Uri.parse(vdocUriString);

				const hover: ProviderResult<Hover[]> = await commands.executeCommand("vscode.executeHoverProvider", vdocUri, position);

				if (hover) return hover[0];

				return;
			},
		},
	};

	client = new LanguageClient("SAMMILanguageServer", "SAMMI Language Server", serverOptions, clientOptions);

	await client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return;
	}
	return client.stop();
}
