export class Logger {
    private static currentLogIndentationLevel = 0

    public static log(message: string) {
        //output.appendLine(`${'\t'.repeat(currentLogIndentationLevel)}${message}`);
        console.log(`${' '.repeat(Logger.currentLogIndentationLevel * 2)}${message}`);
    }

    public static logIndent() {
        Logger.currentLogIndentationLevel++;
    }

    public static logOutdent() {
        if (Logger.currentLogIndentationLevel > 0) {
            Logger.currentLogIndentationLevel--;
        }
    }

    public static logResetIndentation() {
        Logger.currentLogIndentationLevel = 0;
    }

    private static Colors = class {
        public static readonly Yellow = '\x1b[33m'; // ANSI code for yellow
        public static readonly Green = '\x1b[32m'; // ANSI code for green
        public static readonly Default = '\x1b[0m'; // ANSI code to reset color 
    }
    
    public static hiMethod(methodName: string) {
        return (`${Logger.Colors.Yellow}${methodName}()${Logger.Colors.Default}`);
    }

    public static hiObject(objectName: string) {
        return (`${Logger.Colors.Green}${objectName}${Logger.Colors.Default}`); 
    }
}