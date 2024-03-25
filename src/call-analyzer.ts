import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import { minimatch } from 'minimatch'

import { Logger } from './logging'
import { CodeAnalyzer } from './code-analyzer';
import { SequenceDiagramModel, Participant, CallItemInfo } from './entities';
import { DocumentManager } from './document-manager';
import { TextFormatter } from './text-formatter';



// ################################################################################################################################
/**
 * Represents the result of a skip check operation.
 */
class SkipCheckResult {

    // Properties *****************************************************************************************************************

    /**
     * Tells if a given call shall be skipped from further analysis and the sequence diagrams.
     */
    public readonly skip: boolean = false;
    
    /**
     * The reason for skipping if `skip` is true, empty otherwise.
     */
    public readonly reason: string = "";

    // ****************************************************************************************************************************
    /**
     * Constructs a SkipCheckResult object with skip status and reason.
     * @param skip - A boolean indicating whether to skip the analysis.
     * @param reason - The reason for skipping the analysis.
     */
    constructor(skip: boolean, reason: string) {
        this.skip = skip;
        this.reason = reason;
    }
}

// ################################################################################################################################
export class CallAnalyzer {

    // Properties *****************************************************************************************************************
    protected participants: Set<string> = new Set<string>();
    protected messages: string[] = [];
    protected messageSequenceNumber: string = "";

    // ****************************************************************************************************************************
    /**
     * Retrieves the root paths of the workspace folders.
     * @returns An array of strings representing the root paths of the workspace folders.
     */
    protected static roots(): string[] {
        return vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? []
    } 

    // ****************************************************************************************************************************
    /**
     * Retrieves the common root path of the workspace folders.
     * @returns A string representing the common root path of the workspace folders.
     */
    protected static workspaceRoot(): string {
        return DocumentManager.findLongestCommonPrefix(CallAnalyzer.roots())
    }

    // ****************************************************************************************************************************
    /**
     * Builds the call hierarchy, analyzes outgoing calls, and composes messages for sequence diagrams.
     * @param root - The root CallHierarchyItem to start the traversal.
     */
    public async sequenceCalls(root: CallHierarchyItem): Promise<SequenceDiagramModel> {
        Logger.logResetIndentation();
        Logger.logIndent();
        Logger.log("Start building sequence diagram");
        Logger.log('*'.repeat(80));

        // Start traversal and obtain sequence messages for the diagram
        const sequenceMessages = await this.traverse(root, "self", "", 0)

        // Add the obtained messages to the diagram, if there is any
        this.messages?.push(...sequenceMessages ?? [])
        
        this.optimizeReferences();

        let sdm = new SequenceDiagramModel()
        sdm.participants = this.participants;
        sdm.messages = this.messages;

        Logger.logResetIndentation();            
        
        return sdm;
    }

    // ****************************************************************************************************************************
    /**
     * Traverses the call hierarchy, analyzes outgoing calls, and composes messages for sequence diagrams.
     * @param node - The CallHierarchyItem to traverse.
     * @param myName - The name of the current node.
     * @param parentSequenceNumber - The sequence number of the parent node.
     * @param depth - The depth of the traversal.
     * @returns A Promise that resolves to an array of strings representing the composed messages.
     */
    protected async traverse(node: CallHierarchyItem, myName: string, parentSequenceNumber: string, depth: number): Promise<string[] | undefined> {       
            
        // This function will
        // * investigate what calls are located in the given node, and
        // * create sequence diagram messages for these calls, furthermore
        // * initiate the investigation of these calls (unless one needs to be skipped)
        //
        // This function uses recursion to go deep in the call hierarchy.
        //
        // First we define a small data structure and some local functions:
        // * flattenCalls makes sure that each method call occurrences are processed
        // * shallCallBeSkipped() performs investigations whether to skip a call or not as per user preferences
        // * composeParticipantName determines name variations of participants involved in calls
        // * analyzeCall processes a call to identify participants and compose the proper messages for the sequence diagram
        //

        // ========================================================================================================================
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
            const groupedCalls: vscode.CallHierarchyOutgoingCall[] = await vscode.commands.executeCommand('vscode.provideOutgoingCalls', node);

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

       // ========================================================================================================================
        /**
         * Composes the name of the participant (class or module) based on the URI and position.
         * @param uri - The URI of the document.
         * @param position - The position within the document.
         * @returns A Promise that resolves to a Participant object with the composed name.
         */
        const composeParticipantName = async (uri: vscode.Uri, position: vscode.Position): Promise<Participant> => {
            const pn = new Participant();

            // Find the name of the class containing the method from which to call originates
            pn.className = await CodeAnalyzer.findClassName(uri, position) || '';

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
                return uriString.replace(CallAnalyzer.workspaceRoot(), "");
            }


            pn.qualifiedName = `${trimUri(uri)}/${pn.className}`;    

            return pn;
        }
        
        // ========================================================================================================================
        /**
         * Analyzes an outgoing call in the call hierarchy, composes messages for sequence diagrams, and handles nested calls.
         * @param call - The outgoing call to analyze.
         * @param myMessages - The array to store the composed messages.
         * @param callIx - The index of the call in the sequence.
         */
        const analyzeCall = async (call: vscode.CallHierarchyOutgoingCall, myMessages: string[], callIx: number) => {

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
            
            const scr: SkipCheckResult = this.shallCallBeSkipped(call, calledItem);
            if (scr.skip) {
                whatsGoingOn += ` ${scr.reason} and is therefore skipped`;

                Logger.log(whatsGoingOn);
                Logger.logOutdent();
                return;
            }


            // Obtain information on the call -------------------------------------------------------------------------------------
            
            Logger.log(`Getting item info for ${calledItem.name} in ${calledItem.uri} at ${call.fromRanges[0].start.line}:${call.fromRanges[0].start.character}`)            
            const callItemInfo: CallItemInfo = await CodeAnalyzer.getCallItemInfo(node.uri, call.fromRanges[0])
            
            // Increase the last tag of the sequence number as we are about to add a message at the same level
            localSequenceNumberIx++;
            
            
            // Compose names for the caller ---------------------------------------------------------------------------------------

            // Find the name of the class and object from which the call originates and add it to the list of participants
            const caller: Participant = await composeParticipantName(node.uri, node.selectionRange.start);
            caller.fullNameWithAlias = `${caller.qualifiedName} as ${caller.qualifiedName}<br>:${myName}`;

            // Add the callee object to the list of participants
            this.participants.add(caller.fullNameWithAlias);


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
            this.participants.add(callee.fullNameWithAlias);

            
            // Build up message compartments --------------------------------------------------------------------------------------            

            this.messageSequenceNumber = 
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
                `\t${caller.qualifiedName} ${messageType} ${callee.qualifiedName}: ${this.messageSequenceNumber}. ${message}(${TextFormatter.wrapText(callItemInfo.parameters)})`);
            
            // Return call
            afterNestedCalls.unshift(
                `\t${callee.qualifiedName} ${returnMessageType} ${caller.qualifiedName}: ${this.messageSequenceNumber}. : return value`);

            Logger.log(`Call ${callIx} added as ${this.messageSequenceNumber}: ${callFromToken} ->> ${callToToken}: ${callNameToken}`); 

            // Process the callee -------------------------------------------------------------------------------------------------

            nestedCalls = await this.traverse(calledItem, callItemInfo.objectName, this.messageSequenceNumber, depth + 1);

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

    // ****************************************************************************************************************************
    /**
     * Optimizes references by finding the longest common prefix and updating participant and message names accordingly
     * to make them as short as possible while maintaining uniqueness.
     * @returns void
     */
    protected optimizeReferences(): void {        
        
        if (!this.messages || this.messages.length === 0) {
            return;
        }

        // Find the common prefix that we can cut from fully qualified file names
        let commonRoot = DocumentManager.findLongestCommonPrefix(Array.from(this.participants));

        // Remove the common part and make a copy of the participants list with pretty names
        const prettyParticipants = new Set<string>();
        this.participants.forEach(participant => {
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

        this.participants = prettyParticipants;
        
        // Remove the common part and make a copy of the messages list with pretty names
        const prettyMessages: string[] = [""];
        this.messages.forEach(message => {
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

        this.messages = prettyMessages;
    }

    // ****************************************************************************************************************************
    /**
     * Determines whether to skip analyzing a function call based on various criteria.
     * @returns A boolean indicating whether to skip the analysis.
     */
    protected shallCallBeSkipped(call: vscode.CallHierarchyOutgoingCall, calledItem: CallHierarchyItem): SkipCheckResult {

        // Certain calls may be ignored, based on extension settings. Let's see if this needs to be ignored.

        // Obtain configuration data ------------------------------------------------------------------------------------------                        
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

}
