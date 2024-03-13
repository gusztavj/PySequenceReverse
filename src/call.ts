import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import * as fs from 'fs';
import { output } from './extension'
import { minimatch } from 'minimatch'
import EventEmitter = require('events')

export interface CallHierarchy {
    item: CallHierarchyItem
    from?: CallHierarchyItem
    to?: CallHierarchyItem

    sequenceNumber?: string
}

function findLongestCommonPrefix(paths: string[]): string {
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

let workspaceRoot: string = '';

function trimUri(uriOrString: string|vscode.Uri): string {
    let uriString = typeof uriOrString === 'string' ? uriOrString : uriOrString.toString();
    return uriString.replace(workspaceRoot, "");
}

function getFunctionName(uri: vscode.Uri): string {
    return `${uri.toString().split('/').pop()}::` || "";
}


async function findClassName(uri: vscode.Uri, position: vscode.Position): Promise<string> {
    // Load the document
    const document = await vscode.workspace.openTextDocument(uri);
    return parseToFindClassName(document.getText(), position) || "";
}

function parseToFindClassName(documentText: string, position: vscode.Position): string | undefined {
    const lines = documentText.split('\n');
    let currentIndentation = getIndentationLevel(lines[position.line]);

    for (let i = position.line; i >= 0; i--) {
        const line = lines[i];
        const lineIndentation = getIndentationLevel(line);

        // Check if the current line is less indented than the method's line and contains a class definition
        if (lineIndentation < currentIndentation && line.trim().startsWith('class ')) {
            // Extract the class name from the class definition
            const classNameMatch = line.match(/class\s+([^\(:]+)/);
            return classNameMatch ? classNameMatch[1].trim() : undefined;
        }

        // Update the current indentation level to the line's indentation if it's less indented than the current level
        if (lineIndentation < currentIndentation && line.trim().length > 0) {
            currentIndentation = lineIndentation;
        }
    }

    // No class definition found
    return undefined;
}

function getIndentationLevel(line: string): number {
    // Count leading spaces to determine the indentation level
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
}

export async function getCallHierarchy(
        direction: 'Incoming' | 'Outgoing' | 'Both',
        root: CallHierarchyItem,
        parentSequenceNumber: string,
        addEdge: (edge: CallHierarchy) => void
    ) 
{
    if (direction === 'Both') {
        await getCallHierarchy('Incoming', root, parentSequenceNumber, addEdge)
        await getCallHierarchy('Outgoing', root, parentSequenceNumber, addEdge)
        return
    }

    const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? []
    workspaceRoot = findLongestCommonPrefix(roots)

    const configs = vscode.workspace.getConfiguration()
    const ignoreGlobs = configs.get<string[]>('chartographer-extra.ignoreOnGenerate') ?? []
    const ignoreNonWorkspaceFiles = configs.get<boolean>('chartographer-extra.ignoreNonWorkspaceFiles') ?? false

    // Let the user choose to omit calls of functions in 3rd party and built-in packages
    const ignoreAnalyzingThirdPartyPackages = configs.get<boolean>('chartographer-extra.ignoreAnalyzingThirdPartyPackages') ?? false

    // ----------------------------------------------------------------------------------------------------------------------------
    // Gather potential venv paths and other paths that may contain 3rd party packages 
    // (to optionally exclude their calls from the graph)

    // Two default paths offered by VS Code when creating a virtual environment
    const dotVenv = ".venv";
    const dotConda = ".conda";

    // Start building paths to exclude by adding the default ones
    let builtinPackagesPaths: string[] = [dotVenv, dotConda];

    const pythonSettings = vscode.workspace.getConfiguration('python');    
    
    if (pythonSettings) {
        
        // Check if Python path is set and add it to the list of paths to exclude
        const pyPath = pythonSettings.get('pythonPath');     
        if (pyPath && typeof pyPath === 'string') {
            builtinPackagesPaths.push(pyPath.toString())
        }

        // Check if 'Python: Venv folders' are specified, and add each to the list of paths to exclude
        const venvFolders = pythonSettings.get<string[]>('venvFolders') ?? [];
        for (const folder of venvFolders ?? []) {        
            builtinPackagesPaths.push(folder)
        }

        // Check if 'Python: Venv Path' is defined and add it to the list of paths to exclude
        const venvPath = pythonSettings.get('venvPath');     
        if (venvPath && typeof venvPath === 'string') {
            // Be prepared users may list multiple paths separated by comma or semicolon
            for (const pathItem of venvPath.toString().split(/[;,]/)) {
                builtinPackagesPaths.push(pathItem)
            }
            
        }        
    }

    const command = direction === 'Outgoing' ? 'vscode.provideOutgoingCalls' : 'vscode.provideIncomingCalls'
    const visited: { [key: string]: boolean } = {};
    
    let edgeSequenceNumber: string;

    let participants: Set<string> = new Set();    
    let messages: string[] = [];
    

    const traverse = async (node: CallHierarchyItem, parentSequenceNumber: string) => {
        output.appendLine('resolve: ' + node.name)
        const id  = `"${node.uri}#${node.name}@${node.range.start.line}:${node.range.start.character}"`

        if (visited[id]) {
            return;
        }

        visited[id] = true

        const calls:
            | vscode.CallHierarchyOutgoingCall[]
            | vscode.CallHierarchyIncomingCall[] = await vscode.commands.executeCommand(command, node);

        
        let localSequenceNumberIx: number = 0;
            
        await Promise.all(calls.map(async (call) => {
            let next: CallHierarchyItem
            let edge: CallHierarchy                        
            
            if (call instanceof vscode.CallHierarchyOutgoingCall) {
                edge = { item: node, to: call.to }
                next = call.to
            } else {
                edge = { item: node, from: call.from }
                next = call.from
            }


            let skip = false
            for (const glob of ignoreGlobs) {
                if (minimatch(next.uri.fsPath, glob)) {
                    skip = true
                    break
                }
            }
            if (ignoreNonWorkspaceFiles) {
                let isInWorkspace = false
                for (const workspace of vscode.workspace.workspaceFolders ?? []) {
                    if (next.uri.fsPath.startsWith(workspace.uri.fsPath)) {
                        isInWorkspace = true
                        break
                    }
                }
                if (!isInWorkspace) {
                    skip = true
                }
            }

            if (ignoreAnalyzingThirdPartyPackages) { // don't follow functions in files located under venv directories

                let isInVenv = false
                for (const path of builtinPackagesPaths ?? []) {
                    if (next.uri.fsPath.includes(path)) {
                        isInVenv = true
                        break
                    }
                }
                if (isInVenv) {
                    skip = true
                }
            }

            if (skip) {
                return;
            }

            localSequenceNumberIx++;
            
            const participantName = 
                `${trimUri(node.uri)}/${findClassName(node.uri, node.selectionRange.start)}`;
            
            const participantNameWithAlias = 
                `${participantName} as ${trimUri(node.uri)}<br>${findClassName(node.uri, node.selectionRange.start)}`;

            participants.add(participantNameWithAlias);
            
            // Assemble label based on call direction and nesting level
            if (call instanceof vscode.CallHierarchyOutgoingCall) {
                
                const otherParticipantName = `${trimUri(call.to.uri)}/${findClassName(call.to.uri, call.to.selectionRange.start)}`;
                
                messages.push(`    ${participantName} ->> ${otherParticipantName}: ${call.to.name}`);

                edgeSequenceNumber = 
                    (parentSequenceNumber === "") 
                    ? `${localSequenceNumberIx.toString()}` 
                    : `${parentSequenceNumber}.${localSequenceNumberIx.toString()}`;
                
            } else {

                const otherParticipantName = `${trimUri(call.from.uri)}/${findClassName(call.from.uri, call.from.selectionRange.start)}`;

                messages.push(`    ${otherParticipantName} ->> ${participantName}: ${node.name}`);

                edgeSequenceNumber = 
                    (parentSequenceNumber === "") 
                    ? `\u21A3 ${localSequenceNumberIx.toString()}` 
                    : parentSequenceNumber.startsWith('\u21A3') 
                        ? `${localSequenceNumberIx.toString()} ${parentSequenceNumber}`
                        : `${localSequenceNumberIx.toString()} \u21A3 ${parentSequenceNumber}`;
            }

            edge.sequenceNumber = edgeSequenceNumber;

            addEdge(edge);
            await traverse(next, edgeSequenceNumber);
        }));
    }

    await traverse(root, "")
    saveDataToFile(participants, messages)
    
}



async function saveDataToFile(participants: Set<string>, messages: string[]) {

    let commonRoot = findLongestCommonPrefix(Array.from(participants));

    const prettyParticipants = new Set<string>();
    participants.forEach(participant => {
        let prettyName = participant.replace(commonRoot, "");
        while (true) {
            const evenPrettierName = prettyName.replace(commonRoot, "");
            if (evenPrettierName === prettyName) {
                break;
            }
            prettyName = evenPrettierName;
        } 

        prettyParticipants.add(`    participant ${prettyName}`);
    });
    
    const prettyMessages: string[] = [""];
    messages.forEach(message => {
        let prettyName = message.replace(commonRoot, "");
        while (true) {
            const evenPrettierName = prettyName.replace(commonRoot, "");
            if (evenPrettierName === prettyName) {
                break;
            }
            prettyName = evenPrettierName;
        } 
        
        prettyMessages.push(prettyName);
    });

    const participantsStr = Array.from(prettyParticipants).join('\n');
    const messagesStr = prettyMessages.join('\n');
    const combinedStr = `%%{init: {'theme':'forest'}}%%\nsequenceDiagram\n${participantsStr}\n\n${messagesStr}`;

    // Retrieve the current workspace root path
    const {workspaceFolders} = vscode.workspace;
    const defaultUri = workspaceFolders && workspaceFolders.length > 0 
        ? vscode.Uri.file(workspaceFolders[0].uri.fsPath) // Use the first workspace folder as default
        : undefined;

    const uri = await vscode.window.showSaveDialog({
        filters: { 
            'Mermaid Diagram files (*.mmd;*.mermaid)': ['*.mmd;', '*.mermaid'], 
            'All files (*.*)': ['*.*'],
        },
        defaultUri: defaultUri // Set the default save location
    });

    if (!uri) {
        return;
    } // User canceled the dialog

    await fs.promises.writeFile(uri.fsPath, combinedStr, 'utf8');
    vscode.window.showInformationMessage('Data saved successfully!');
}

function isEqual(a: CallHierarchyItem, b: CallHierarchyItem) {
    return (
        a.name === b.name &&
        a.kind === b.kind &&
        a.uri.toString() === b.uri.toString() &&
        a.range.start.line === b.range.start.line &&
        a.range.start.character === b.range.start.character
    )
}
