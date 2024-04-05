import * as vscode from 'vscode'
import * as fs from 'fs';
import * as path from 'path';
import sanitize = require('sanitize-filename');

import { SequenceDiagramModel } from './entities';
import { CallAnalyzer } from './call-analyzer';
import { CodeAnalyzer } from './code-analyzer';

// ################################################################################################################################
export class DocumentManager {

    /**
     * Returns the TextDocument containing the given file
     * 
     * This method retrieves and returns the TextDocument object that is stored within this object.
     * 
     * @returns {vscode.TextDocument} The TextDocument associated with this object.
     */
    public document(): vscode.TextDocument { return this._document; }
    private _document!: vscode.TextDocument;

    /**
     * The URI of this document
     */
    public uri(): vscode.Uri { return this._uri; }
    private _uri!: vscode.Uri

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
     * Creates a default filename for saving the sequence diagram based on the provided model.
     * 
     * @param {SequenceDiagramModel} sequenceDiagram - The sequence diagram model used to generate the default filename.
     * @returns {vscode.Uri} The default URI for saving the diagram.
     */
    public createDefaultFilename(sequenceDiagram: SequenceDiagramModel): vscode.Uri {
        
        // Retrieve the current workspace root path
        const {workspaceFolders} = vscode.workspace;        

        const defaultUri = workspaceFolders && workspaceFolders.length > 0 
            ? vscode.Uri.file(workspaceFolders[0].uri.fsPath) // Use the first workspace folder as default
            : undefined;

        // Construct default file name
        const defaultFileName = 
            vscode.Uri.file(
                path.join(defaultUri?.fsPath || "", sanitize(sequenceDiagram.title(), {replacement: "-"})) + ".mmd")
        
        return this._uri = defaultFileName;
    }

    // ****************************************************************************************************************************
    /**
     * Asks the user to provide a filename for saving the sequence diagram.
     * 
     * @param {SequenceDiagramModel} sequenceDiagram - The sequence diagram model to save.
     * @returns {Promise<vscode.Uri | undefined>} A Promise that resolves with the selected URI or undefined.
     */
    public async askForFilename(sequenceDiagram: SequenceDiagramModel): Promise<vscode.Uri | undefined> {
        
        // Construct default file name
        const defaultFileName = this.createDefaultFilename(sequenceDiagram);

        const uri = await vscode.window.showSaveDialog({
            filters: { 
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Mermaid Diagram files (*.mmd; *.mermaid)': ['mmd', 'mermaid'], 
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'All files (*.*)': ['*.*'],
            },
            defaultUri: defaultFileName // Set the default save location
        });
        
        if (uri) { this._uri = uri; }

        return uri;
    }
    
    // ****************************************************************************************************************************
    /**
     * Saves the diagram contents to a file with the provided filename.
     * 
     * @param {string} contents - The contents of the diagram to be saved.
     * @returns {Promise<void>} A Promise that resolves when the diagram is saved successfully.
     */
    public async saveDiagram(contents: string): Promise<boolean> {

        if (!this.uri()) {
            return false;
        }
        
        const filename: string = this.uri().fsPath;
        let success: boolean = false;

        try {
            await fs.promises.writeFile(filename, contents, 'utf8');
            vscode.window.showInformationMessage('Diagram file saved successfully!');    
            success = true;
        } catch (error) {
            vscode.window.showErrorMessage(`Diagram could not be saved for an error of ${error}`)
            success = false;
        }
        
        return success;
    }


    // ****************************************************************************************************************************
    /**
     * Opens a Mermaid diagram file with a preview in the editor.
     * @returns void
     */
    public async openDiagramWithPreview() {
        if (!this.uri()) {
            return;
        }

        this._document = await vscode.workspace.openTextDocument(this.uri());

        if (this._document) {
            await vscode.window.showTextDocument(this.document(), vscode.ViewColumn.One);
            await vscode.commands.executeCommand('mermaid-editor.preview', this.uri());    
        }
    }

    // ****************************************************************************************************************************
    /**
     * Saves the diagram as an image based on the provided URI.
     * 
     * If the document is not already open, it opens the document before generating and saving the image.
     */
    public async saveDiagramAsImage() {
        if (!this.uri()) {
            return;
        }

        // Make sure the doc is open (the user could have closed it)
        if (!this.document()) {
            this._document = await vscode.workspace.openTextDocument(this.uri());            
        }        
        
        await vscode.window.showTextDocument(this.document(), vscode.ViewColumn.One);
        await vscode.commands.executeCommand('mermaid-editor.generate.file');    
        vscode.window.showInformationMessage('Diagram image saved successfully!');
    }

    // ****************************************************************************************************************************
    /**
     * Closes the current diagram document.
     * 
     * This method opens the document if it exists and then closes the active editor.
     */
    public async closeDiagram() {
        
        if (!this.document()) {
            return;
        }
        
        await vscode.window.showTextDocument(this.document(), vscode.ViewColumn.One);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
}