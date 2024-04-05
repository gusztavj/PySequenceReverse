import { CallHierarchyItem, ExtensionContext } from 'vscode';
import * as vscode from 'vscode'

import { SequenceDiagramModel } from './entities';
import { CallAnalyzer } from './call-analyzer';
import { DocumentManager } from './document-manager';
import { CodeAnalyzer } from './code-analyzer';

// ################################################################################################################################
/**
 * Controller class for generating sequence diagrams and managing call hierarchy diagrams.
 * Manages the generation, saving, and previewing of diagrams.
 */
export class Controller {
    
    // ****************************************************************************************************************************
    /**
     * Generates a sequence diagram based on selected functions.
     * @param context - The VS Code extension context.
     * @returns An asynchronous function to generate the sequence diagram.
     */
    public generateSequenceDiagram = (context: vscode.ExtensionContext) => {
        return async () => {
            const entries: vscode.CallHierarchyItem[] = await CodeAnalyzer.getSelectedFunctions()                    
            await this.createSequenceDiagram(entries[0]);
        }
    }

    // ****************************************************************************************************************************
    /**
     * Generates a call hierarchy diagram, saves it to a file, and opens a preview if successful.
     * @param root - The root CallHierarchyItem to start the diagram generation.
     */
    public async createSequenceDiagram(root: CallHierarchyItem) { 
    
        // Build the call hierarchy and populate the participants and messages lists
        let sdm = new SequenceDiagramModel(root);
        sdm = await new CallAnalyzer().sequenceCalls(sdm);

        // Have the diagram text composed
        await sdm.composeDiagram();

        // Obtain configuration data ------------------------------------------------------------------------------------------                        
        const configs = vscode.workspace.getConfiguration()

        const saveAutomatically = configs.get<string[]>('py-sequence-reverse.Files: Save Diagram File Automatically') ?? false;
        const openAutomatically = configs.get<string[]>('py-sequence-reverse.Files: Open Diagram Automatically') ?? true;        

        // Create a document manager and file URI
        const docMgr = new DocumentManager();
        let fileUri: vscode.Uri | undefined;

        if (saveAutomatically) {
            fileUri = docMgr.createDefaultFilename(sdm);
        } else {
            // Ask the user for the file name
            fileUri = await docMgr.askForFilename(sdm);            
        }


        // See if the user wants to save the file or we could create a file name
        if (fileUri) { // The user selected a file name or we could create the file name

            // Save the diagram to a file from the built-up lists 
            let savedSuccessfully: boolean = await docMgr.saveDiagram(sdm.contents())
            
            if (savedSuccessfully && openAutomatically) {
                // Open the preview
                await docMgr.openDiagramWithPreview();

                if (saveAutomatically) {
                    await docMgr.saveDiagramAsImage();
                    await docMgr.closeDiagram();
                }
            }

            
        }

    }   

    
}

