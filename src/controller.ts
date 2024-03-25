import { CallHierarchyItem, ExtensionContext } from 'vscode';
import * as vscode from 'vscode'

import { SequenceDiagramModel } from './entities';
import { CallAnalyzer } from './call-analyzer';
import { DocumentManager } from './document-manager';

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
            const entries: vscode.CallHierarchyItem[] = await DocumentManager.getSelectedFunctions()                    
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
        let sdm = new SequenceDiagramModel();
        sdm = await new CallAnalyzer().sequenceCalls(root);

        const docMgr = new DocumentManager();
    
        // Save the diagram to a file from the built-up lists
        const uri = await docMgr.saveDataToFile(sdm)
    
        // Try to open the diagram and the preview of the file was saved successfully
        if (uri) {
            await docMgr.openDiagramWithPreview(uri)
        }
    }   

    
}

