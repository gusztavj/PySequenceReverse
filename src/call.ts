import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import * as fs from 'fs';
import { output } from './extension'
import { minimatch } from 'minimatch'
import EventEmitter = require('events')
import * as chalk from 'chalk';

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
        addEdge: (edge: CallHierarchy) => void
    ) 
{ 

    let participants: Set<string> = new Set();    
    let messages: string[] = [];

    await buildCallHierarchy(direction, root, "", addEdge, participants, messages);

    await saveDataToFile(participants, messages)
}

let currentLogIndentationLevel = 0

function log(message: string) {
    //output.appendLine(`${'\t'.repeat(currentLogIndentationLevel)}${message}`);
    console.log(`${' '.repeat(currentLogIndentationLevel * 2)}${message}`);
}

function logIndent() {
    currentLogIndentationLevel++;
}

function logOutdent() {
    if (currentLogIndentationLevel > 0) {
        currentLogIndentationLevel--;
    }
}

const COLOR_YELLOW = '\x1b[33m'; // ANSI code for yellow
const COLOR_GREEN = '\x1b[32m'; // ANSI code for green
const COLOR_DEFAULT = '\x1b[0m'; // ANSI code to reset color 

function hiMethod(methodName: string) {
    return (`${COLOR_YELLOW}${methodName}()${COLOR_DEFAULT}`);
}

function hiObject(objectName: string) {
    return (`${COLOR_GREEN}${objectName}${COLOR_DEFAULT}`); 
}

function logResetIndentation() {
    currentLogIndentationLevel = 0;
}

async function buildCallHierarchy(
        direction: 'Incoming' | 'Outgoing' | 'Both',
        root: CallHierarchyItem,
        parentSequenceNumber: string,
        addEdge: (edge: CallHierarchy) => void,
        participants: Set<string>,
        messages: string[]    
    ) 
{
    if (direction === 'Both') {
        await buildCallHierarchy('Incoming', root, parentSequenceNumber, addEdge, participants, messages)
        await buildCallHierarchy('Outgoing', root, parentSequenceNumber, addEdge, participants, messages)
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
    

    const traverse = async (node: CallHierarchyItem, parentSequenceNumber: string, depth: number) => {        
        
        const id  = `"${node.uri}#${node.name}@${node.range.start.line}:${node.range.start.character}"`
        
        log(`Traversing ${hiMethod(node.name)}, PSEQ ${parentSequenceNumber}, FQN ${id}`)

        // if (visited[id]) {
        //     return;
        // }

        // visited[id] = true

        
        const calls: vscode.CallHierarchyOutgoingCall[] | vscode.CallHierarchyIncomingCall[] 
            = await vscode.commands.executeCommand(command, node);
        
        logIndent()
        
        log(`Call list obtained with ${calls.length} items`)
        
        let localSequenceNumberIx: number = 0;
        let callIx: number = 0;
            
        for (const call of calls) {            

            let whatsGoingOn = "";
            let callFrom = "";
            let callTo = "";
            let callName = "";

            // log(`Processing call ${++callIx} of ${calls.length}`);

            whatsGoingOn += `Call ${++callIx}`

            logIndent();

            let next: CallHierarchyItem;
            let edge: CallHierarchy;                 
            
            if (call instanceof vscode.CallHierarchyOutgoingCall) {
                edge = { item: node, to: call.to };
                next = call.to;

                // log(`- Identified as an outgoing call from ${hiMethod(node.name)} to ${hiMethod(call.to.name)}`);
                whatsGoingOn += ` from ${hiMethod(node.name)} to ${hiMethod(call.to.name)}`
                callFrom = hiMethod(node.name)
                callTo = hiMethod(call.to.name)
            } else {
                edge = { item: node, from: call.from };
                next = call.from;

                // log(`- Identified as an incoming call from ${hiMethod(call.from.name)} to ${hiMethod(node.name)}`);
                whatsGoingOn += ` from ${hiMethod(call.from.name)} to ${hiMethod(node.name)}`;
                callFrom = hiMethod(call.from.name)
                callTo = hiMethod(node.name)
            }            

            let skip = false
            for (const glob of ignoreGlobs) {
                if (minimatch(next.uri.fsPath, glob)) {
                    skip = true;
                    // log("Call involves ignored globals");
                    whatsGoingOn += " involves ignored globals"
                }
            }

            if (ignoreNonWorkspaceFiles) {
                let isInWorkspace = false
                for (const workspace of vscode.workspace.workspaceFolders ?? []) {
                    if (next.uri.fsPath.startsWith(workspace.uri.fsPath)) {
                        isInWorkspace = true;
                    }
                }
                if (!isInWorkspace) {
                    skip = true;
                    //log("Call goes out of workspace");
                    whatsGoingOn += " goes out of workspace"
                }
            }

            if (ignoreAnalyzingThirdPartyPackages) { // don't follow functions in files located under venv directories

                let isInVenv = false
                for (const path of builtinPackagesPaths ?? []) {
                    if (next.uri.fsPath.includes(path)) {
                        isInVenv = true;
                    }
                }
                if (isInVenv) {
                    skip = true;
                    //log("Call goes to (v)env module");
                    whatsGoingOn += " goes to (v)env module"
                }
            }

            if (skip) {
                // log(`Call skipped`)
                whatsGoingOn += " and is therefore skipped"

                log(whatsGoingOn);
                logOutdent();
                continue;
            }

            

            localSequenceNumberIx++;
            
            const participantClassName = await findClassName(node.uri, node.selectionRange.start);
            const participantName = 
                `${trimUri(node.uri)}/${participantClassName}`;                        

            const participantNameWithAlias = 
                `${participantName} as ${trimUri(node.uri)}<br>${participantClassName}`;

            participants.add(participantNameWithAlias);

            //log(`Identified participant ${hiObject(participantClassName)} with FQN [${participantName}]`);
            
            let messageType: string = "";
            let returnFrom: string = "";
            let returnTo: string = "";

            // Assemble label based on call direction and nesting level
            if (call instanceof vscode.CallHierarchyOutgoingCall) {
                
                const otherParticipantClassName = await findClassName(call.to.uri, call.to.selectionRange.start);
                const otherParticipantName = `${trimUri(call.to.uri)}/${otherParticipantClassName}`;
                
                edgeSequenceNumber = 
                    (parentSequenceNumber === "") 
                    ? `${localSequenceNumberIx.toString()}` 
                    : `${parentSequenceNumber}.${localSequenceNumberIx.toString()}`;
                                
                callFrom = `${hiObject(participantClassName)}.${callFrom}`
                callTo = hiObject(otherParticipantClassName)
                callName = hiMethod(call.to.name)

                if (participantClassName === otherParticipantClassName) {
                    messageType = "->>+";
                    returnFrom = otherParticipantName;
                    returnTo = participantName
                } else {
                    messageType = "->>"
                }

                messages.push(`    ${participantName} ${messageType} ${otherParticipantName}: ${edgeSequenceNumber}. ${call.to.name}`);

                // log(`Recorded call ${edgeSequenceNumber}: ${hiObject(participantClassName)} ->> ${hiObject(otherParticipantClassName)}: ${hiMethod(call.to.name)}`);
                
                
            } else {

                const otherParticipantClassName = await findClassName(call.from.uri, call.from.selectionRange.start);
                const otherParticipantName = `${trimUri(call.from.uri)}/${otherParticipantClassName}`;                

                edgeSequenceNumber = 
                    (parentSequenceNumber === "") 
                    ? `\u21A3 ${localSequenceNumberIx.toString()}` 
                    : parentSequenceNumber.startsWith('\u21A3') 
                        ? `${localSequenceNumberIx.toString()} ${parentSequenceNumber}`
                        : `${localSequenceNumberIx.toString()} \u21A3 ${parentSequenceNumber}`;

                if (participantClassName === otherParticipantClassName) {
                    messageType = "->>+";
                    returnFrom = participantName;
                    returnTo = otherParticipantName
                } else {
                    messageType = "->>"
                }

                callFrom = `${hiObject(otherParticipantClassName)}.${callFrom}`
                callTo = hiObject(participantClassName)
                callName = hiMethod(node.name)

                messages.push(`    ${otherParticipantName} ${messageType} ${participantName}: ${edgeSequenceNumber}. ${node.name}`);

                // log(`Recorded call ${edgeSequenceNumber}: ${hiObject(otherParticipantClassName)} ->> ${hiObject(participantClassName)}: ${hiMethod(node.name)}`);
                
            }

            log(`Call ${callIx} added as ${edgeSequenceNumber}: ${callFrom} ->> ${callTo}: ${callName}`); 

            edge.sequenceNumber = edgeSequenceNumber;

            addEdge(edge);

            await traverse(next, edgeSequenceNumber, depth + 1);
            
            if (returnFrom !== "") {
                messages.push(`    ${returnFrom} -->>- ${returnTo}: ${edgeSequenceNumber}. return`);
                log(`${edgeSequenceNumber}: Returning from ${returnFrom} to ${returnTo}`);
            }
            

            logOutdent();
        };

        logOutdent();
    }

    logResetIndentation();
    logIndent();
    log("Start building sequence diagram");
    log('*'.repeat(80));

    await traverse(root, "", 0)
    
    logResetIndentation();

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
            //'Mermaid Diagram files (*.mmd;*.mermaid)': ['*.mmd', '*.mermaid'], 
            'Mermaid Diagram files (*.mmd)': ['*.mmd'], 
            'All files (*.*)': ['*.*'],
        },
        defaultUri: defaultUri // Set the default save location
    });

    if (!uri) {
        return;
    } // User canceled the dialog

    await fs.promises.writeFile(uri.fsPath, combinedStr, 'utf8');
    vscode.window.showInformationMessage('Diagram file saved successfully!');

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('mermaid-editor.preview', uri);    
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
