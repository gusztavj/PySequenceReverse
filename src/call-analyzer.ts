import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import { minimatch } from 'minimatch'

import { Logger } from './logging'
import { CodeAnalyzer } from './code-analyzer';
import { SequenceDiagramModel, Participant, CallItemInfo, Participants } from './entities';
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
    protected participants: Participants = new Participants();
    protected messages: string[] = [];
    protected messageSequenceNumber: string = "";
    protected maxCallDepth!: number;

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
    public static workspaceRoot(): string {
        return DocumentManager.findLongestCommonPrefix(CallAnalyzer.roots())
    }

    /**
     * Stores the result of the `getCommonRoot` operation for later retrieval.
     */
    public static commonRoot: string = "";

    /**
     * Finds the common root path among a list of paths.
     * 
     * @param {string[]} listOfPaths - An array of paths to find the common root from.
     * @returns {string} The common root path among the provided paths.
     */
    public static getCommonRoot(listOfPaths: string[]): string {
        CallAnalyzer.commonRoot = DocumentManager.findLongestCommonPrefix(listOfPaths)
        return CallAnalyzer.commonRoot;
    }



    // ****************************************************************************************************************************
    /**
     * Builds the call hierarchy, analyzes outgoing calls, and composes messages for sequence diagrams.
     * @param root - The root CallHierarchyItem to start the traversal.
     */
    public async sequenceCalls(sequenceDiagramModel: SequenceDiagramModel): Promise<SequenceDiagramModel> {
        Logger.logResetIndentation();
        Logger.logIndent();
        Logger.log("Start building sequence diagram");
        Logger.log('*'.repeat(80));


        this.maxCallDepth = vscode.workspace.getConfiguration().get<number>('py-sequence-reverse.Diagram: Max Call Depth') ?? 32
        // Start traversal and obtain sequence messages for the diagram
        const subject = sequenceDiagramModel.functionAnalyzed()        
        const sequenceMessages = await this.traverse(sequenceDiagramModel.functionAnalyzed(), `${subject.name}()`, "", 0)

        // Add the obtained messages to the diagram, if there is any
        this.messages?.push(...sequenceMessages ?? [])
        
        this.optimizeReferences();

        sequenceDiagramModel.participants = this.participants;
        sequenceDiagramModel.messages = this.messages;

        Logger.logResetIndentation();            
        
        return sequenceDiagramModel;
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
            

            // Declare stuff ------------------------------------------------------------------------------------------------------
            let calls: vscode.CallHierarchyOutgoingCall[] = [];

            // ---------------------------------------------------------------------------------------------------------------------
            /**
             * Sorts method calls in a way that if method call is located within the parameters of another, this one comes first
             * as it is actually called first. Otherwise the one above the other comes first.
             * 
             * The method shall be async as we need to collect the parameters for each call, which requires async/await call to VS
             * to open the containing document.
             * 
             * @returns A Promise that resolves to an array of sorted CallHierarchyOutgoingCall objects.
             */
            const sortCalls = async (): Promise<vscode.CallHierarchyOutgoingCall[]> => {

                // Map each call to a promise that resolves to an object containing the call and its CallItemInfo
                const callsWithInfoPromises = 
                    calls.map(
                        async call => ({
                            call,
                            info: await CodeAnalyzer.getCallItemInfo(node.uri, call.fromRanges[0], call.to)
                        })
                    );
            
                // Wait for all promises to resolve
                const callsWithInfo = await Promise.all(callsWithInfoPromises);
            
                // Now sort the calls based on the desired criteria, for example, the start position of the fromRanges
                callsWithInfo.sort((a, b) => {

                    // Check if one call is located in the parameters of the other (only applies if the assumed container is a function call)
                    //
                    if (a.info.isFunction && a.info.parametersRange.contains(b.call.fromRanges[0])) {
                        // Call to 'b' is within the parameters of call 'a', so that call to 'b' is executed first
                        return 1;
                    } else if (b.info.isFunction && b.info.parametersRange.contains(a.call.fromRanges[0])) {
                        // Call to 'a' is within the parameters of call 'b', so that call to 'a' is executed first
                        return -1;

                    // From here no one contains the other so location decides
                    //
                    } else if (a.call.fromRanges[0].start.isBefore(b.call.fromRanges[0].start)) {
                        // Call to a comes first
                        return -1;
                    } else if (a.call.fromRanges[0].start.isAfter(b.call.fromRanges[0].start)) {
                        // Call to a comes later
                        return 1;
                    } else {
                        // Tie, the two calls are the same
                        return 0;
                    }
                });
            
                // Extract the sorted calls
                return calls = callsWithInfo.map(cwi => cwi.call);
            }

            // Body of flattenCalls -----------------------------------------------------------------------------------------------
                    
            // Get the calls from VS Code. Note that calls to the same method are grouped
            const groupedCalls: vscode.CallHierarchyOutgoingCall[] = await vscode.commands.executeCommand('vscode.provideOutgoingCalls', node);
            
            // Flatten out the list and make sure to have an item for all call locations as those may belong to different
            // objects and may come sooner or later in the sequence of calls
            groupedCalls.forEach(gc => {                
                gc.fromRanges.forEach(fr => {
                    if (!CallAnalyzer.shallCallBeSkipped(gc, gc.to).skip) {
                        calls.push(new vscode.CallHierarchyOutgoingCall(gc.to, [fr]))
                    }
                })
            });

            // Sort calls to get the order of sequencing
            calls = await sortCalls();

            return calls;
        }

       // ========================================================================================================================
        /**
         * Composes the name of the participant (class or module) based on the URI and position.
         * @param uri - The URI of the document.
         * @param position - The position within the document.
         * @returns A Promise that resolves to a Participant object with the composed name.
         */
        const identifyParticipant = async (uri: vscode.Uri, position: vscode.Position): Promise<Participant> => {
            const participant = new Participant();

            // Find the name of the class containing the method from which to call originates
            participant.class = await CodeAnalyzer.findClassName(uri, position) || '';

            if (participant.class.length === 0) { // Item is not in a class
                // Go with the module name (the containing file's name without extension)
                const moduleName: string | undefined = uri.path.split('/').pop()?.split('?')[0];
                if (moduleName) {
                    participant.class = moduleName;
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

            participant.namespace = trimUri(uri);

            return participant;
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
            
            const scr: SkipCheckResult = CallAnalyzer.shallCallBeSkipped(call, calledItem);
            if (scr.skip) {
                whatsGoingOn += ` ${scr.reason} and is therefore skipped`;

                Logger.log(whatsGoingOn);
                Logger.logOutdent();
                return;
            }


            // Obtain information on the call -------------------------------------------------------------------------------------
            
            Logger.log(`Getting item info for ${calledItem.name} in ${calledItem.uri} at ${call.fromRanges[0].start.line}:${call.fromRanges[0].start.character}`)            
            const callItemInfo: CallItemInfo = await CodeAnalyzer.getCallItemInfo(node.uri, call.fromRanges[0], call.to)
            
            // Increase the last tag of the sequence number as we are about to add a message at the same level
            localSequenceNumberIx++;
            
            
            // Compose names for the caller ---------------------------------------------------------------------------------------

            // Find the name of the class and object from which the call originates and add it to the list of participants
            let caller: Participant = await identifyParticipant(node.uri, node.selectionRange.start);
            caller.object = myName;
            
            caller = this.participants.add(caller);


            // Compose names for the callee ---------------------------------------------------------------------------------------
            
            // Find the name of the class and object from which the call originates and add it to the list of participants
            let callee: Participant = await identifyParticipant(call.to.uri, call.to.selectionRange.start);

            if (callItemInfo.objectName === "self") { // Nested call to same object
                // In some nested call a method calls another of the same class' same object, so don't use self as the object name
                // as it would create another participant
                callee.object = myName;
            } else {
                // Here another object is targeted so let's just use the variable or property name preceding the function name
                callee.object = callItemInfo.objectName;
            }

            // Add the callee object to the list of participants
            callee = this.participants.add(callee);
            

            
            // Build up message compartments --------------------------------------------------------------------------------------            

            this.messageSequenceNumber = 
                (parentSequenceNumber === "") 
                ? `${localSequenceNumberIx.toString()}` 
                : `${parentSequenceNumber}.${localSequenceNumberIx.toString()}`;
            
            message = call.to.name;

            if (caller.qualifiedName() === callee.qualifiedName()) {
                messageType = "->>+";
                returnMessageType = "-->>-";
            } else {
                messageType = "->>+";
                returnMessageType = "-->>-";
            }

            // Compartments for log message
            callFromToken = `${Logger.hiObject(caller.class)}.${callFromToken}`
            callToToken = Logger.hiObject(callee.class)
            callNameToken = Logger.hiMethod(call.to.name)            

            // Add messages -------------------------------------------------------------------------------------------------------

            // Outgoing call
            beforeNestedCalls.push(
                `\t${caller.id} ${messageType} ${callee.id}: ${includeSequenceNumbers ? this.messageSequenceNumber + ":" : ""} ${message}${TextFormatter.wrapText(callItemInfo.parameters)}`);
            
            // Return call
            let returnLabel = vscode.workspace.getConfiguration().get<boolean>('py-sequence-reverse.Diagram: Return Message Label') ?? "return value"
            if (returnLabel === "") { returnLabel = " "; }
            afterNestedCalls.unshift(
                `\t${callee.id} ${returnMessageType} ${caller.id}: ${includeSequenceNumbers ? this.messageSequenceNumber : ""}: ${returnLabel}`);

            Logger.log(`Call ${callIx} added as ${this.messageSequenceNumber}: ${callFromToken} ->> ${callToToken}: ${callNameToken}`); 

            // Process the callee unless depth limit is reached -------------------------------------------------------------------

            if (depth < this.maxCallDepth) {
                nestedCalls = await this.traverse(calledItem, callee.object, this.messageSequenceNumber, depth + 1);
                if (nestedCalls === undefined) {
                    beforeNestedCalls.push(
                        `\tNote right of ${callee.id}: Further calls ignored for reaching max depth`
                    )
                }
            } 

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

        const includeSequenceNumbers: boolean = !vscode.workspace.getConfiguration().get<boolean>('py-sequence-reverse.Diagram: Omit Sequence Numbers') ?? true
        
        Logger.log(`Traversing ${Logger.hiMethod(node.name)}, PSEQ ${parentSequenceNumber}, FQN ${id}`)
        
        const calls: vscode.CallHierarchyOutgoingCall[] = await flattenCalls();

        if (calls.length > 0 && depth === this.maxCallDepth) {
            // Max depth reached, don't process these calls
            return undefined
        }

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
        let commonRoot = CallAnalyzer.getCommonRoot([...this.participants.values()].map(p => p.namespace));

        // Remove the common part and make a copy of the participants list with pretty names        
        this.participants.forEach(participant => {
            let prettyName = participant.namespace.replace(commonRoot, "");
            while (true) {
                const evenPrettierName = prettyName.replace(commonRoot, "");
                if (evenPrettierName === prettyName) {
                    break;
                }
                prettyName = evenPrettierName;
            }; 

            participant.namespace = prettyName;
        });
        
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
    public static shallCallBeSkipped(call: vscode.CallHierarchyOutgoingCall, calledItem: CallHierarchyItem): SkipCheckResult {

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
        
        const ignoreGlobs = configs.get<string[]>('py-sequence-reverse.Ignore: Ignore on Generate') ?? []

        for (const glob of ignoreGlobs) { // Some globals are requested to be ignored from the diagram
            if (minimatch(calledItem.uri.fsPath, glob)) {                    
                return new SkipCheckResult(true, "involves ignored globals");
            }
        }


        // Check ignore non-workspace files option ---------------------------------------------------------------------------
        
        const ignoreNonWorkspaceFiles = configs.get<boolean>('py-sequence-reverse.Ignore: Ignore Non-Workspace Files') ?? false

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
        const ignoreAnalyzingThirdPartyPackages = configs.get<boolean>('py-sequence-reverse.Ignore: Ignore Analyzing Third-Party Packages') ?? false

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
                    break;
                }
            }
            if (isInVenv) {
                return new SkipCheckResult(true, "goes to (v)env module");
            }
        }            

        return new SkipCheckResult(false, "");
    }    

}

