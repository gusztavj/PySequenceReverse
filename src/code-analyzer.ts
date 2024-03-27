import * as vscode from 'vscode'

import { CallItemInfo } from './entities';



// ################################################################################################################################
/**
 * A class for analyzing code, providing methods to extract function names and class names, and retrieve information about 
 * function calls.
 */
export class CodeAnalyzer {

    // ****************************************************************************************************************************
    /**
     * 
     * Get the name of the function from the given URI.
     * 
     * @param uri - The URI of the document.
     * @returns The name of the function.
     */
    public static getFunctionName(uri: vscode.Uri): string {
        return `${uri.toString().split('/').pop()}::` || "";
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


    // ****************************************************************************************************************************
    /** 
     * Finds the name of the class containing a given position in a VS Code document.
     * @param uri - The URI of the document to search.
     * @param position - The position within the document to search from.
     * @returns A Promise that resolves to the name of the class, or an empty string if not found.
     */
    public static async findClassName(uri: vscode.Uri, position: vscode.Position): Promise<string | undefined> {

        // getIndentationLevel ------------------------------------------------------------------------------------------------
        /** 
         * Determines the indentation level of a given line by counting leading spaces.
         * @param line - The line of text to analyze.
         * @returns The number of leading spaces indicating the indentation level.
         */
        const getIndentationLevel = (line: string): number => {
            // Count leading spaces to determine the indentation level
            const match = line.match(/^(\s*)/);
            return match ? match[1].length : 0;
        }

        // Body ---------------------------------------------------------------------------------------------------------------

        // Load the document and try to parse the class name from the given position
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(uri);
        const documentText: string = document.getText();

        const lines = documentText.split('\n');
        let currentIndentation = getIndentationLevel(lines[position.line]);

        // Traverse document backwards line by line
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

    
    // ****************************************************************************************************************************
    /**
     * 
     * Retrieves information about a function call at a specific position in a VS Code document.
     * @param uri - The URI of the document to analyze.
     * @param itemNameRange - The range containing the function call name.
     * @returns A Promise that resolves to CallItemInfo object with details about the function call.
     */
    public static async getCallItemInfo(uri: vscode.Uri, itemNameRange: vscode.Range): Promise<CallItemInfo> {
        
        // Get the document and the line containing the call
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(uri);
        const line: vscode.TextLine = document.lineAt(itemNameRange.start.line)    

        let itemInfo: CallItemInfo = new CallItemInfo();

        // We'll do a couple of things here:
        // - Check if the token at the location referenced by `itemNameRange` is likely a method call
        //   This is implemented in checkIfCallIsFunctionCall.
        // - For method calls we'll try to find the object on which the method is called. For a call
        //   of foo.bar(), for example, the object is foo. For self.foo.bar(), it is also foo. This is
        //   implemented in identifyObject.
        // - For method calls we'll try to parse the arguments passed, implemented in collectParameters.
        //
        // Start with the functions


        

        // Body ===================================================================================================================

        itemInfo = CodeAnalyzer.checkIfCallIsFunctionCall(document, line, itemNameRange, itemInfo)
        
        // The followings only makes sense for functions
        if (itemInfo.isFunction) {
            itemInfo = CodeAnalyzer.identifyInvokedObject(line, itemNameRange, itemInfo)
            itemInfo = CodeAnalyzer.collectParameters(document, itemNameRange, itemInfo);
        }

        return itemInfo;
        
    }

    // ****************************************************************************************************************************
    /**
    * Checks if a given item represents a function call based on the context in the document.
    * @param document - The TextDocument containing the item.
    * @param line - The TextLine where the item is located.
    * @param itemNameRange - The Range of the item's name.
    * @param itemInfo - The CallItemInfo object to update with the function call status.
    * @returns The updated CallItemInfo object indicating if the item is a function call.
    */
    protected static checkIfCallIsFunctionCall(document: vscode.TextDocument, line: vscode.TextLine, itemNameRange: vscode.Range, itemInfo: CallItemInfo): CallItemInfo {         
        // We'll check what comes after the name to see if this is a method call or not
        
        if (line.text.charAt(itemNameRange.end.character + 1) === "(") { // Name followed by an opening parenthesis
            
            // This is likely a function call
            itemInfo.isFunction = true;

        } else { // The name is followed by something else, keep investigating as there may be a line break 
                    // before the opening parenthesis, for example

            let restOfLineWithNextLine: String;
            
            // Get the remainder of this line and the next if any
            restOfLineWithNextLine = 
                line.text.substring(itemNameRange.start.character)
                .concat(`\n`)
                .concat(document.lineCount > line.lineNumber ? document.lineAt(itemNameRange.start.line + 1).text : "");

            // Match if the name is followed by whitespaces and then an opening parenthesis
            const continuesWithOpenPara = restOfLineWithNextLine.match(/[\s\r\n]*\(/);

            // If we have a match, we have a function
            itemInfo.isFunction = continuesWithOpenPara !== null;
        }

        return itemInfo;
    }

    // ****************************************************************************************************************************
    /**
     * Identifies the object on which a function is invoked based on the context in the line.
     * @param line - The TextLine containing the function call.
     * @param itemNameRange - The Range of the function name.
     * @param itemInfo - The CallItemInfo object to update with the invoked object information.
     * @returns The updated CallItemInfo object with the identified invoked object.
     */
    protected static identifyInvokedObject(line: vscode.TextLine, itemNameRange: vscode.Range, itemInfo: CallItemInfo): CallItemInfo {
        // We'll take the line containing the call and reverse it, and we'll use a regex to find the whole qualified name
        // in the call. For a.b.c(), this is a.b.
        
        if (line.text[itemNameRange.start.character - 1] === ".") { // Function name preceded by a dot
            // This is a function of an object, let's find the object

            // The the line from the beginning to the beginning of the name, reverse it and match for object.name.patterns.
            // As the line segment is reversed, the first.such.sequence is the fully qualified name of the object on which
            // the function is invoked.

            const lineContentsBeforeFunctionName = line.text.substring(line.firstNonWhitespaceCharacterIndex, itemNameRange.start.character-1);
            const reversedLineContents = lineContentsBeforeFunctionName.split('').reverse().join('');
            
            // Check if the reversed line begins.with.object.qualification
            const reversedQualifierMatch = reversedLineContents.match(/[a-zA-Z0-9_\.]+/)
                        
            if (reversedQualifierMatch !== null) { // Yay, this is an object
                // Take the first match and reverse it to restore the original spelling. Remove references to self as well.
                const reversedQualifier = reversedQualifierMatch[0]
                let objectName = reversedQualifier.split('').reverse().join('').replace("self.", "");
                
                // If the object name is just self, drop it. It will be substituted by the instance name in the caller.
                if (objectName === "self.") {
                    objectName = "self";
                }
                
                // Remove leading "self.". It will be substituted by the instance name in the caller.
                if (objectName !== "self" && objectName.startsWith("self.")) {
                    objectName = objectName.substring(5);
                }

                itemInfo.objectName = objectName;
            }     

        } else { // Function name is not preceded

            // The containing file or module is gonna be the class name and the object name shall remain empty

        }

        return itemInfo;
    }

    // ****************************************************************************************************************************
    /**
     * Collects the parameters of a function call from the document text.
     * @param document - The TextDocument containing the function call.
     * @param itemNameRange - The Range of the function name.
     * @param itemInfo - The CallItemInfo object to update with the collected parameters.
     * @returns The updated CallItemInfo object with the collected parameters.
     */
    protected static collectParameters(document: vscode.TextDocument, itemNameRange: vscode.Range, itemInfo: CallItemInfo): CallItemInfo {
        // Basically we'll grab what comes after the opening parenthesis right after the method name, and collect anything
        // until that parenthesis is closed.

        // Get the position of the last character of the file
        let lastPosition = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount-1).text.length);
        
        // Get the range describing the whole document from right after the function name
        let rangeOfRest = new vscode.Range(itemNameRange.end, lastPosition);
                
        // Load all the text and remove line breaks
        const remainingContents = document.getText(rangeOfRest).replace('\n', "");

        let parenthesesOpen = 1;
        let ix = 1;
        let params: string = "";
        let currentCharacter;
        
        // Start counting parentheses, and when all is closed we collected the parameters
        while (parenthesesOpen > 0) {
            currentCharacter = remainingContents[ix++];

            if (currentCharacter === "(") {
                parenthesesOpen++;
            } else if (currentCharacter === ")") {
                parenthesesOpen--;
            }
            
            // This character is going to be part of the parameters unless it is the final enclosing parenthesis
            if (parenthesesOpen > 0) {
                params += currentCharacter;
            }
        }

        itemInfo.parameters = params;

        return itemInfo;
    }
}