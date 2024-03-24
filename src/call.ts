import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import * as fs from 'fs';
import { minimatch } from 'minimatch'

import {Logger} from './logging'
import { CodeAnalyzer } from './code-analyzer';



// TextFormatter ##################################################################################################################
/**
 * A utility class for formatting text by wrapping it to fit within a specified line length.
 */
class TextFormatter {

    /**
     * Unless other length is specified, use this to wrap text to lines.
     */
    public static defaultLineLength = 30;

    /**
     * The soft limit specifies how much before or after the desired breakpoint shall the break
     * be placed if the line cannot be broken at the desired position.
     */
    public static softWrappingLimit = 10;

    /**
     * Wraps text to fit within a specified line length, ensuring proper line breaks.
     * @param text - The text to wrap.
     * @param lengthAbout - The approximate line length to wrap the text.
     * @returns The wrapped text with line breaks.
     */
    public static wrapText(text: string, lengthAbout: number = TextFormatter.defaultLineLength): string {
        let ix = 0;
        let wrappedText: string = "";
        let endReached: boolean = false;
        let chunkStartsAt: number = 0;
        let chunkEndsAt: number = 0;
        let lineBroken: boolean;    

        if (text.length < lengthAbout + TextFormatter.softWrappingLimit) {
            // No need to wrap anything
            return text;
        }

        // Start wrapping into chunks
        while (!endReached) {        
            chunkEndsAt = chunkStartsAt + Math.min(chunkStartsAt + lengthAbout, text.length - chunkStartsAt);
                    
            if (!text.charAt(chunkEndsAt).match(/\s/)) { // The intended end of the line is not a whitespace 
                
                // Let's try to find one nearby. First define three small helper functions.                

                lineBroken = false;
                
                // Tells whether the line can break at the current position and moves chunkEndsAt accordingly
                const canBreakLineAtPosition = () => {
                    lineBroken = chunkStartsAt + lengthAbout + ix === text.length - 1 || text.charAt(chunkStartsAt + lengthAbout + ix).match(/[\s\[\]\.,\:\(\)\{\})]/) !== null;

                    if (lineBroken) {
                        chunkEndsAt = chunkStartsAt + lengthAbout + ix;
                    }
                    
                    return lineBroken;
                }

                // Tells whether the line can be broken nearby forward
                const findNearbySpaceForward = (limit: number = TextFormatter.softWrappingLimit) => {
                    ix = 0;
                    while (++ix < limit && chunkStartsAt + lengthAbout + ix < text.length - 1 && !canBreakLineAtPosition()) {
                        ;
                    }
                }

                // Tells whether the line can be broken nearby backward
                const findNearbySpaceBackward = () => {
                    ix = 0;
                    while (++ix < TextFormatter.softWrappingLimit && chunkStartsAt + lengthAbout + ix > 0 && !canBreakLineAtPosition()) {
                        ;
                    }
                }

                // And now find a suitable breaking point
                // - First check if the text ends soon after the soft wrapping limit to not leave a very short last line
                //   - If the text ends soon after the soft wrapping limit, first try to look for a nearby space backwards,
                //     and only look forward if there is not any
                //   - Otherwise first try to look for a nearby space forward and only go backwards if there's not any
                

                if (text.length - chunkEndsAt < TextFormatter.softWrappingLimit) { // Only a few character would remain if breaking here
                    findNearbySpaceBackward();
                    if (!lineBroken) {
                        findNearbySpaceForward();
                    }
                } else { // There's more to wrap, we are not approaching the end of the text too much yet
                    findNearbySpaceForward();
                    if (!lineBroken) {
                        findNearbySpaceBackward();
                    }
                }

                if (!lineBroken) { // Could not wrap in the neighborhood
                    // No other option but proceeding until we can break the line, if we can break it at all
                    findNearbySpaceForward(text.length);
                }

            }
            
            endReached = chunkEndsAt === text.length - 1;

            wrappedText += text.substring(chunkStartsAt, chunkEndsAt);

            // Add the break if this is not the last chunk
            if (!endReached) {
                wrappedText += "<br>"
            }
            
            // If no more than a line of text remains, add it to the last new line
            if (chunkEndsAt + lengthAbout >= text.length) {
                wrappedText += text.substring(chunkEndsAt)
                endReached = true
            } else {
                // Move the window to the beginning of the unwrapped part
                chunkStartsAt = chunkEndsAt + 1;
            }
        }

        return wrappedText;
    }
}

export const generateSequenceDiagram = (context: vscode.ExtensionContext) => {
    return async () => {
        const entries: vscode.CallHierarchyItem[] = await getSelectedFunctions()        
        getCallHierarchy(entries[0]);
    }
}

async function getSelectedFunctions() {
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

class SequenceDiagramModel {
    public participants: Set<string> = new Set();    
    public messages: string[] = [];
}
// getCallHierarchy ###############################################################################################################
/**
 * Generates a call hierarchy diagram, saves it to a file, and opens a preview if successful.
 * @param root - The root CallHierarchyItem to start the diagram generation.
 */
export async function getCallHierarchy(root: CallHierarchyItem) 
{ 

    let participants: Set<string> = new Set();    
    let messages: string[] = [];

    // Build the call hierarchy and populate the participants and messages lists
    let sdm = new SequenceDiagramModel();
    sdm = await buildCallHierarchy(root);

    // Save the diagram to a file from the built-up lists
    const uri = await saveDataToFile(sdm)

    // Try to open the diagram and the preview of the file was saved successfully
    if (uri) {
        await openDiagramWithPreview(uri)
    }
}


// findLongestCommonPrefix ====================================================================================================
/**
 * Finds the longest common prefix among an array of strings.
 * @param paths - An array of strings to find the common prefix from.
 * @returns The longest common prefix among the strings.
 */
const findLongestCommonPrefix = (paths: string[]): string => {
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

// buildCallHierarchy #############################################################################################################
/**
 * Builds the call hierarchy, analyzes outgoing calls, and composes messages for sequence diagrams.
 * @param root - The root CallHierarchyItem to start the traversal.
 * @param participants - The set to store the names of participants in the sequence diagram.
 * @param messages - An array to store the composed messages for the sequence diagram.
 */
async function buildCallHierarchy(
        root: CallHierarchyItem,        
    ): Promise<SequenceDiagramModel>
{
    // Initialization -------------------------------------------------------------------------------------------------------------

    const command = 'vscode.provideOutgoingCalls'
    let participants: Set<string> = new Set<string>();
    let messages: string[] = [];
    let messageSequenceNumber: string;     
    
    const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? []
    let workspaceRoot = findLongestCommonPrefix(roots)
    

    // traverse *******************************************************************************************************************
    /**
     * Traverses the call hierarchy, analyzes outgoing calls, and composes messages for sequence diagrams.
     * @param node - The CallHierarchyItem to traverse.
     * @param myName - The name of the current node.
     * @param parentSequenceNumber - The sequence number of the parent node.
     * @param depth - The depth of the traversal.
     * @returns A Promise that resolves to an array of strings representing the composed messages.
     */
    const traverse = async (
        node: CallHierarchyItem, 
        myName: string, 
        parentSequenceNumber: string, 
        depth: number): Promise<string[] | undefined> => 
        {       
            
        // This function will
        // * investigate what calls are located in the given node, and
        // * create sequence diagram messages for these calls, furthermore
        // * initiate the investigation of these calls (unless one needs to be skipped)
        //
        // This function uses recursion to go deep in the call hierarchy.
        //
        // First we define a small data structure and some local functions:
        // * flattenCalls makes sure that each method call occurrences are processed
        // * SkipCheckResult contains the result of investigations whether to skip a call or not as per user preferences.
        // * shallCallBeSkipped() performs the aforementioned investigation
        // * Participant contains name variations of participants of a sequence diagram
        // * composeParticipantName determines aforementioned information for calls
        // * analyzeCall processes a call to identify participants and compose the proper messages for the sequence diagram.
        //

        // flattenCalls ===========================================================================================================
        /**
         * Flattens and sorts the outgoing call hierarchy for a given node.
         * @returns A Promise that resolves to an array of CallHierarchyOutgoingCall objects.
         */
        const flattenCalls = async (): Promise<vscode.CallHierarchyOutgoingCall[]> => {
            // VS Code API gives a nice list of the outgoing calls from a function, however it has as many items as many
            // different methods are called. If a method is called multiple times from another, instead of duplicating the call
            // hierarchy item, the respective locations are maintained in the fromRanges property. While this is good for call
            // hierarchy, it's not good for our purposes as we need to reconstruct the sequence of calls as they happen. 
            //
            // For example, is foo() is called twice, from line 7 and line 13 of something(), while bar is called once from 
            // line 9, we need to reconstruct the sequence of foo(), bar(), foo().
            
            
            // Get the calls from VS Code. Note that calls to the same method are grouped
            const groupedCalls: vscode.CallHierarchyOutgoingCall[] = await vscode.commands.executeCommand(command, node);

            let calls: vscode.CallHierarchyOutgoingCall[] = [];
            
            // Flatten out the list and make sure to have an item for all call locations as those may belong to different
            // objects and may come sooner or later in the sequence of calls
            groupedCalls.forEach(gc => {
                gc.fromRanges.forEach(fr => {
                    calls.push(new vscode.CallHierarchyOutgoingCall(gc.to, [fr]))
                })
            });

            // Set up correct sequence of calls by sorting the calls based on location
            calls.sort(
                (a: vscode.CallHierarchyOutgoingCall, b: vscode.CallHierarchyOutgoingCall) =>
                { 
                    if (a.fromRanges[0].start.isBefore(b.fromRanges[0].start)) {
                        return -1;
                    }
                    else if (a.fromRanges[0].start.isAfter(b.fromRanges[0].start)) {
                        return 1;
                    }
                    else {
                        return 0;
                    }
                }
            );

            return calls;
        }

        // SkipCheckResult class ==================================================================================================
        /**
         * Represents the result of a skip check operation.
         */
        class SkipCheckResult {
            public readonly skip: boolean = false;
            public readonly reason: string = "";

            constructor(skip: boolean, reason: string) {
                this.skip = skip;
                this.reason = reason;
            }
        }

        // shallCallBeSkipped =====================================================================================================
        /**
         * Determines whether to skip analyzing a function call based on various criteria.
         * @returns A boolean indicating whether to skip the analysis.
         */
        const shallCallBeSkipped = (
            call: vscode.CallHierarchyOutgoingCall,
            calledItem: CallHierarchyItem
        ): SkipCheckResult => {

            // Certain calls may be ignored, based on extension settings. Let's see if this needs to be ignored.

            // Init stuff
            let skip: boolean = false;
            let reason: string = "";


            // Obtain configuration data ------------------------------------------------------------------------------------------            

            const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? []        
            const configs = vscode.workspace.getConfiguration()


            // Check link/call type -----------------------------------------------------------------------------------------------

            // Don't follow links which doesn't count function calls as per the call hierarchy provider's understandings
            if (!(  call.to.kind === vscode.SymbolKind.Method
                ||  call.to.kind === vscode.SymbolKind.Function
                ||  call.to.kind === vscode.SymbolKind.Property
            )) {
                return new SkipCheckResult(true, "is not a function call");
            }


            // Check ignore globals option ----------------------------------------------------------------------------------------
            
            const ignoreGlobs = configs.get<string[]>('pysequencereverse.ignoreOnGenerate') ?? []

            for (const glob of ignoreGlobs) { // Some globals are requested to be ignored from the diagram
                if (minimatch(calledItem.uri.fsPath, glob)) {                    
                    return new SkipCheckResult(true, "involves ignored globals");
                }
            }


            // Check ignore non-workspace files option ---------------------------------------------------------------------------
            
            const ignoreNonWorkspaceFiles = configs.get<boolean>('pysequencereverse.ignoreNonWorkspaceFiles') ?? false

            if (ignoreNonWorkspaceFiles) { // Methods located in files out of the workspace folders shall be excluded
                let isInWorkspace = false
                for (const workspace of vscode.workspace.workspaceFolders ?? []) {
                    if (calledItem.uri.fsPath.startsWith(workspace.uri.fsPath)) {
                        isInWorkspace = true;
                    }
                }
                if (!isInWorkspace) {
                    return new SkipCheckResult(true, "goes out of workspace");
                }
            }


            // Check ignore (v)env folders option ---------------------------------------------------------------------------------            

            // See if the the user chose to omit calls of functions in/to 3rd party and built-in packages
            const ignoreAnalyzingThirdPartyPackages = configs.get<boolean>('pysequencereverse.ignoreAnalyzingThirdPartyPackages') ?? false

            if (ignoreAnalyzingThirdPartyPackages) { // Requested to not follow functions located in files under (v)env directories

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

                // With paths collected, see if the call's URI is on one of the paths or not
                let isInVenv = false
                for (const path of builtinPackagesPaths ?? []) {
                    if (calledItem.uri.fsPath.includes(path)) {
                        isInVenv = true;
                    }
                }
                if (isInVenv) {
                    return new SkipCheckResult(true, "goes to (v)env module");
                }
            }            

            return new SkipCheckResult(false, "");
        }
        
        // Participant ============================================================================================================
        /**
         * Represents a participant in a sequence diagram with class and qualified names.
         */
        class Participant {
            public className: string = "";
            public qualifiedName: string = "";
            public fullNameWithAlias: string = "";
        }

        // composeParticipantName =================================================================================================
        /**
         * Composes the name of the participant (class or module) based on the URI and position.
         * @param uri - The URI of the document.
         * @param position - The position within the document.
         * @returns A Promise that resolves to a Participant object with the composed name.
         */
        const composeParticipantName = async (uri: vscode.Uri, position: vscode.Position): Promise<Participant> => {
            const pn = new Participant();

            // Find the name of the class containing the method from which to call originates
            pn.className = await CodeAnalyzer.findClassName(uri, position);

            if (pn.className.length === 0) { // Item is not in a class
                // Go with the module name (the containing file's name without extension)
                const moduleName: string | undefined = uri.path.split('/').pop()?.split('?')[0];
                if (moduleName) {
                    pn.className = moduleName;
                }
            }                                    

            /**
             * Trims the workspace root path from a given URI or string.
             * @param uriOrString - The URI or string to trim.
             * @returns The trimmed string.
             */
            const trimUri = (uriOrString: string | vscode.Uri): string => {
                let uriString = typeof uriOrString === 'string' ? uriOrString : uriOrString.toString();
                return uriString.replace(workspaceRoot, "");
            }


            pn.qualifiedName = `${trimUri(uri)}/${pn.className}`;    

            return pn;
        }
        
        // analyzeCall ============================================================================================================
        /**
         * Analyzes an outgoing call in the call hierarchy, composes messages for sequence diagrams, and handles nested calls.
         * @param call - The outgoing call to analyze.
         * @param myMessages - The array to store the composed messages.
         * @param callIx - The index of the call in the sequence.
         */
        const analyzeCall = async (
            call: vscode.CallHierarchyOutgoingCall,
            myMessages: string[],
            callIx: number) => 
            {

            // To make sure activations on the sequence diagrams are correct, we'll add a return message for all calls.
            // Further calls originating from the currently processed calls will be injected between these two.

            let beforeNestedCalls: string[] = [];           // Collect diagram contents for the method call (message and optional notes)
            let afterNestedCalls: string[] = [];            // Collect diagram contents for the return call
            let nestedCalls: string[] | undefined = [];     // Contain the messages discovered when analyzing the called method
            let calledItem: CallHierarchyItem;              // This is the call hierarchy item at which the call is targeted
                
            let message = "";                               // The message conveys. Contains the sequence number, the method name, and may contain params.
            let messageType: string = "";                   // The type of message for the call according to Mermaid specifications
            let returnMessageType: string = "";             // The type of message for the return call according to Mermaid specifications
            

            // Compartments to compose comprehensive log items
            let whatsGoingOn = "";
            let callFromToken = "";
            let callToToken = "";
            let callNameToken = "";            


            // Let's rock ---------------------------------------------------------------------------------------------------------

            whatsGoingOn += `Call ${callIx}`

            Logger.logIndent();
                        
            calledItem = call.to;                        
            callFromToken = Logger.hiMethod(node.name)
            callToToken = Logger.hiMethod(call.to.name)
            whatsGoingOn += ` from ${callFromToken} to ${callToToken}`
            

            // Check if the call shall be skipped from further analysis -----------------------------------------------------------
            
            const scr: SkipCheckResult = shallCallBeSkipped(call, calledItem);
            if (scr.skip) {
                whatsGoingOn += ` ${scr.reason} and is therefore skipped`;

                Logger.log(whatsGoingOn);
                Logger.logOutdent();
                return;
            }


            // Obtain information on the call -------------------------------------------------------------------------------------
            
            Logger.log(`Getting item info for ${calledItem.name} in ${calledItem.uri} at ${call.fromRanges[0].start.line}:${call.fromRanges[0].start.character}`)            
            const callItemInfo = await CodeAnalyzer.getCallItemInfo(node.uri, call.fromRanges[0])
            
            // Increase the last tag of the sequence number as we are about to add a message at the same level
            localSequenceNumberIx++;
            
            
            // Compose names for the caller ---------------------------------------------------------------------------------------

            // Find the name of the class and object from which the call originates and add it to the list of participants
            const caller: Participant = await composeParticipantName(node.uri, node.selectionRange.start);
            caller.fullNameWithAlias = `${caller.qualifiedName} as ${caller.qualifiedName}<br>:${myName}`;

            // Add the callee object to the list of participants
            participants.add(caller.fullNameWithAlias);


            // Compose names for the callee ---------------------------------------------------------------------------------------
            
            // Find the name of the class and object from which the call originates and add it to the list of participants
            const callee: Participant = await composeParticipantName(call.to.uri, call.to.selectionRange.start);

            if (callItemInfo.objectName === "self" && depth > 1) { // Nested call to same object
                // In some nested call a method calls another of the same class' same object, so don't use self as the object name
                // as it would create another participant
                callee.fullNameWithAlias = `${callee.qualifiedName} as ${callee.qualifiedName}<br>:${myName}`;
            } else {
                // Here another object is targeted so let's just use the variable or property name preceding the function name
                callee.fullNameWithAlias = `${callee.qualifiedName} as ${callee.qualifiedName}<br>:${callItemInfo.objectName}`;
            }

            // Add the callee object to the list of participants
            participants.add(callee.fullNameWithAlias);

            
            // Build up message compartments --------------------------------------------------------------------------------------            

            messageSequenceNumber = 
                (parentSequenceNumber === "") 
                ? `${localSequenceNumberIx.toString()}` 
                : `${parentSequenceNumber}.${localSequenceNumberIx.toString()}`;
            
            message = call.to.name;

            if (caller.qualifiedName === callee.qualifiedName) {
                messageType = "->>+";
                returnMessageType = "-->>-";
            } else {
                messageType = "->>+";
                returnMessageType = "-->>-";
            }

            // Compartments for log message
            callFromToken = `${Logger.hiObject(caller.className)}.${callFromToken}`
            callToToken = Logger.hiObject(callee.className)
            callNameToken = Logger.hiMethod(call.to.name)            

            // Add messages -------------------------------------------------------------------------------------------------------

            // Outgoing call
            beforeNestedCalls.push(
                `\t${caller.qualifiedName} ${messageType} ${callee.qualifiedName}: ${messageSequenceNumber}. ${message}(${TextFormatter.wrapText(callItemInfo.parameters)})`);
            
            // Return call
            afterNestedCalls.unshift(
                `\t${callee.qualifiedName} ${returnMessageType} ${caller.qualifiedName}: ${messageSequenceNumber}. : return value`);

            Logger.log(`Call ${callIx} added as ${messageSequenceNumber}: ${callFromToken} ->> ${callToToken}: ${callNameToken}`); 

            // Process the callee -------------------------------------------------------------------------------------------------

            nestedCalls = await traverse(calledItem, callItemInfo.objectName, messageSequenceNumber, depth + 1);

            // Compose messages from compartments ---------------------------------------------------------------------------------

            let localMessages: string[] = [];

            // Inject messages from nested calls between the outgoing call and the return call message(s)
            localMessages.push(...beforeNestedCalls);        
            localMessages.push(...nestedCalls ?? []);        
            localMessages.push(...afterNestedCalls);          

            myMessages?.push(...localMessages);

            Logger.logOutdent();
        }

        // Body (of traverse) =====================================================================================================
    
        // Obtain a unique ID
        const id  = `"${node.uri}#${node.name}@${node.range.start.line}:${node.range.start.character}"`
        
        Logger.log(`Traversing ${Logger.hiMethod(node.name)}, PSEQ ${parentSequenceNumber}, FQN ${id}`)
        
        const calls: vscode.CallHierarchyOutgoingCall[] = await flattenCalls();

        Logger.logIndent()        
        Logger.log(`Call list obtained with ${calls.length} items`)

        // Init the sequence numbering of this level. We'll combine this with the parent sequence number to get a decimal breakdown structure
        let localSequenceNumberIx: number = 0;        

        // Create a list to contain the messages for the sequence diagram originating from this method
        let myMessages: string[] = [];
        
        let callIx: number = 0;

        // Process each call in order of location to identify participants and create sequence diagram messages
        for (const call of calls) {                                
            await analyzeCall(call, myMessages, ++callIx);
        };
        
        Logger.logOutdent();

        return myMessages;        
    }

    // optimizeReferences *********************************************************************************************************
    /**
     * Optimizes references by finding the longest common prefix and updating participant and message names accordingly.
     * @returns void
     */
    const optimizeReferences = () => {        
        
        // Body of saveDataToFile =====================================================================================================

        if (!messages || messages.length === 0) {
            return;
        }

        // Find the common prefix that we can cut from fully qualified file names
        let commonRoot = findLongestCommonPrefix(Array.from(participants));

        // Remove the common part and make a copy of the participants list with pretty names
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

        participants = prettyParticipants;
        
        // Remove the common part and make a copy of the messages list with pretty names
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

        messages = prettyMessages;
    }

    // Body of buildCallHierarchy *************************************************************************************************

    Logger.logResetIndentation();
    Logger.logIndent();
    Logger.log("Start building sequence diagram");
    Logger.log('*'.repeat(80));

    // Start traversal and obtain sequence messages for the diagram
    const sequenceMessages = await traverse(root, "self", "", 0)

    // Add the obtained messages to the diagram, if there is any
    messages?.push(...sequenceMessages ?? [])
    
    optimizeReferences();

    let sdm = new SequenceDiagramModel()
    sdm.participants = participants;
    sdm.messages = messages;

    Logger.logResetIndentation();            
    
    return sdm;
}



// saveDataToFile #################################################################################################################
/**
 * Saves participant and message data to a Mermaid diagram file and prompts the user to choose the save location.
 * @param participants - The set of participants in the diagram.
 * @param messages - The array of messages in the diagram.
 * @returns A Promise that resolves to the URI of the saved file, or undefined if the operation was canceled.
 */
async function saveDataToFile(sequenceDiagramModel: SequenceDiagramModel): Promise<vscode.Uri | undefined> {
    
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
            //'Mermaid Diagram files (*.mmd;*.mermaid)': ['*.mmd', '*.mermaid'], 
            'Mermaid Diagram files (*.mmd; *.mermaid)': ['mmd', 'mermaid'], 
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


// openDiagramWithPreview #########################################################################################################
/**
 * Opens a Mermaid diagram file with a preview in the editor.
 * @param uri - The URI of the Mermaid diagram file to open.
 * @returns void
 */
async function openDiagramWithPreview(uri: vscode.Uri) {
    if (!uri) {
        return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('mermaid-editor.preview', uri);    
}