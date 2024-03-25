import * as vscode from 'vscode'
import * as fs from 'fs';

import { SequenceDiagramModel } from './entities';

// ################################################################################################################################
export class DocumentManager {

    // ****************************************************************************************************************************
    /**
     * Finds the longest common prefix among an array of strings.
     * @param paths - An array of strings to find the common prefix from.
     * @returns The longest common prefix among the strings.
     */
    public static findLongestCommonPrefix = (paths: string[]): string => {
        if (paths.length === 0) {
            return "";
        }

        // Sort the array to bring potentially common prefixes together
        paths.sort();

        const firstStr = paths[0];
        const lastStr = paths[paths.length - 1];
        let prefix = "";

        for (let i = 0; i < firstStr.length; i++) {
            if (firstStr.charAt(i) === lastStr.charAt(i)) {
                prefix += firstStr.charAt(i);
            } else {
                break;
            }
        }

        return prefix;
    }

    // ****************************************************************************************************************************
    /**
     * Saves participant and message data to a Mermaid diagram file and prompts the user to choose the save location.
     * @param participants - The set of participants in the diagram.
     * @param messages - The array of messages in the diagram.
     * @returns A Promise that resolves to the URI of the saved file, or undefined if the operation was canceled.
     */
    public async saveDataToFile(sequenceDiagramModel: SequenceDiagramModel): Promise<vscode.Uri | undefined> {
        
        const participantsStr = Array.from(sequenceDiagramModel.participants).join('\n');
        const messagesStr = sequenceDiagramModel.messages.join('\n');
        const combinedStr = `%%{init: {'theme':'forest'}}%%\nsequenceDiagram\n${participantsStr}\n\n${messagesStr}`;

        // Retrieve the current workspace root path
        const {workspaceFolders} = vscode.workspace;
        const defaultUri = workspaceFolders && workspaceFolders.length > 0 
            ? vscode.Uri.file(workspaceFolders[0].uri.fsPath) // Use the first workspace folder as default
            : undefined;

        const uri = await vscode.window.showSaveDialog({
            filters: { 
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Mermaid Diagram files (*.mmd; *.mermaid)': ['mmd', 'mermaid'], 
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'All files (*.*)': ['*.*'],
            },
            defaultUri: defaultUri // Set the default save location
        });

        if (!uri) {
            return;
        } // User canceled the dialog

        await fs.promises.writeFile(uri.fsPath, combinedStr, 'utf8');
        vscode.window.showInformationMessage('Diagram file saved successfully!');
        return uri;
    }


    // ****************************************************************************************************************************
    /**
     * Opens a Mermaid diagram file with a preview in the editor.
     * @param uri - The URI of the Mermaid diagram file to open.
     * @returns void
     */
    public async openDiagramWithPreview(uri: vscode.Uri) {
        if (!uri) {
            return;
        }

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand('mermaid-editor.preview', uri);    
    }

    // ****************************************************************************************************************************
    /**
     * Retrieves the selected functions for call hierarchy analysis.
     * @returns A Promise that resolves to an array of CallHierarchyItem representing the selected functions.
     */
    public static async getSelectedFunctions() {
        const activeTextEditor = vscode.window.activeTextEditor!
        const entry: vscode.CallHierarchyItem[] = await vscode.commands.executeCommand(
            'vscode.prepareCallHierarchy',
            activeTextEditor.document.uri,
            activeTextEditor.selection.active
        )
        if (!entry || !entry[0]) {
            const msg = "Can't resolve entry function. Probably it's just a timeout, try again."
            vscode.window.showErrorMessage(msg)
            throw new Error(msg)
        }
    
        return entry
    }
    
}