// ################################################################################################################################
/**
 * Represents a model for a sequence diagram, including participants and messages.
 */
export class SequenceDiagramModel {

    /**
     * The set of participants contributing to the sequence diagram. One participant is listed only once.
     * Note that a participant is either an object or a module, but it's never a class.
     */
    public participants: Set<string> = new Set();    

    /**
     * The message exchanges conducted between participants in the order they happen.
     */
    public messages: string[] = [];
}


// ################################################################################################################################
/**
 * Represents a participant in a sequence diagram with class and qualified names.
 */
export class Participant {

    /**
     * The class to which the method being called or the method initiating the call belongs.
     */
    public className: string = "";

    /**
     * The qualified name of the class. The qualified name may not include the fully qualified name, only as many
     * name compartments as many is required to make it unique within the VS Code workspace.
     */
    public qualifiedName: string = "";

    /**
     * The qualified name with the alias name as per Mermaid's interpretation. The alias is usually the object's name.
     */
    public fullNameWithAlias: string = "";
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
    public parameters: string = ""
}
