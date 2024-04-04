import * as vscode from 'vscode'
import * as fs from 'fs';
import sanitize = require('sanitize-filename');
import { CallAnalyzer } from './call-analyzer';
import { CodeAnalyzer } from './code-analyzer';
import { Hash } from 'crypto';

// ################################################################################################################################
/**
 * Represents a participant in a sequence diagram with class and qualified names.
 */
export class Participant {

    /**
     * The namespace in which the class is defined or the name of the module containing the participant.
     */
    public namespace: string = "";

    /**
     * The class to which the method being called or the method initiating the call belongs. If the participant
     * is not a class member, this is the name of the containing module.
     */
    public class: string = "";

    /**
     * The name of the object this participant identifies with.
     */
    public object: string = "";

    /**
     * The ID of the participant for the diagram code
     */
    public id!: string;

    /**
     * The qualified name of the class. The qualified name may not include the fully qualified name, only as many
     * name compartments as many is required to make it unique within the VS Code workspace.
     */
    public qualifiedName(): string {
        return `${this.namespace}/${this.class}`;
    }
    
    public alias(): string {
        return `${this.qualifiedName()}<br>:${this.object}`
    }

    public uniqueName(): string {
        return `${this.qualifiedName()}:${this.alias()}`;
    }
            
}

export class Participants extends Map<string, Participant> {
    private uid: number = 0;

    public add(participant: Participant): Participant {

        this.set(participant.uniqueName(), participant);        
        return this.get(participant.uniqueName()) || participant;

    }

    public set(key: string, value: Participant): this {
        
        if (!this.has(value.uniqueName())) {
            value.id = `p${++this.uid}`;        
            super.set(value.uniqueName(), value);
        } 
        
        // Return 'this' to maintain chaining compatibility
        return this;
    }

}

// ################################################################################################################################
/**
 * Represents a model for a sequence diagram, including participants and messages.
 */
export class SequenceDiagramModel {

    /**
     * The set of participants contributing to the sequence diagram. One participant is listed only once.
     * Note that a participant is either an object or a module, but it's never a class.
     */
    public participants: Participants = new Participants();

    /**
     * The message exchanges conducted between participants in the order they happen.
     */
    public messages: string[] = [];

    protected _functionAnalyzed: vscode.CallHierarchyItem;
    public functionAnalyzed(): vscode.CallHierarchyItem { return this._functionAnalyzed; }

    protected _workspaceRoot: string = "";
    public workspaceRoot(): string { return this._workspaceRoot; }

    protected _className: string = ""
    public className(): string { return this._className; }
    
    protected _title: string = "";
    public title(): string { return this._title; }

    public _contents: string = "";
    public contents(): string { return this._contents; }

    constructor(root: vscode.CallHierarchyItem) {
        this._functionAnalyzed = root;
    }

    // ****************************************************************************************************************************
    /**
     * Composes a sequence diagram based on the provided root CallHierarchyItem.
     * 
     * @param {vscode.CallHierarchyItem} root - The root CallHierarchyItem to build the diagram around.
     * @returns {Promise<string>} A Promise that resolves with the composed sequence diagram string.
     */
    public async composeDiagram(): Promise<string> {
        
        this._workspaceRoot = CallAnalyzer.workspaceRoot();
        this._className = await CodeAnalyzer.findClassName(this.functionAnalyzed().uri, this.functionAnalyzed().range.start) || "";
        this._title = 
            `Sequence diagram of ${this.className()}.${this.functionAnalyzed().name}()` +
            ` of ${this.functionAnalyzed().uri.toString().replace(this.workspaceRoot(), "")}`        
                
        const participantsStr = [...this.participants.values()].map(p => `    participant ${p.id} as ${p.alias()}`).join('\n');
        const messagesStr = this.messages.join('\n');

        // The replace at the end is to make sure the lines are not indented in the diagram file as they are below
        const combinedStr = `
            %%{init: {'theme':'forest'}}%%
            sequenceDiagram

                Title ${this.title()}

            ${participantsStr}
            
            ${messagesStr}
        `.replace(/^\s{12,13}/gm, "\n");
        
        this._contents = combinedStr;

        return combinedStr;
    }


}





// ################################################################################################################################
/**
 * Represents information about a call item, including function status, object name, and parameters.
 */
export class CallItemInfo {

    /**
     * Tells if the item being called is a function or not, even if you wonder what the hell it can be if not a function.
     */
    public isFunction: boolean = false;
    
    /**
     * The name of the object on which the call is made. For foo.bar(), it's foo.
     */
    public objectName: string = "";
    
    /**
     * Parameters or arguments passed to the callee.
     */
    public parameters: string = "";

    /**
     * The range specifying the locations where the parameters start and end
     */
    public parametersRange!: vscode.Range;
    
}
