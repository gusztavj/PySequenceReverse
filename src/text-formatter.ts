

// TextFormatter ##################################################################################################################
/**
 * A utility class for formatting text by wrapping it to fit within a specified line length.
 */
export class TextFormatter {

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
        
        let wrappedText: string = "";
        let endReached: boolean = false;
        let chunkStartsAt: number = 0;
        let chunkEndsAt: number = 0;
        let lineBroken: boolean;    

        // Remove line continuation markers
        text = text.replace(/\\/, " ")

        // Remove double spaces
        text = text.replace(/\s\s+/, " ");

        // See if removing junk made it fit one line
        if (text.length < lengthAbout + TextFormatter.softWrappingLimit) {
            // No need to wrap anything
            return text;
        }

        // Start wrapping into chunks
        while (!endReached) {        
            chunkEndsAt = chunkStartsAt + Math.min(lengthAbout + 1, text.length - chunkStartsAt);
                    
            if (!text.charAt(chunkEndsAt).match(/[\s,]/)) { // The intended end of the line is not a whitespace 
                
                // Let's try to find one nearby. First define three small helper functions.                

                lineBroken = false;
                
                // Tells whether the line can break at the current position and moves chunkEndsAt accordingly
                const canBreakLineAtPosition = (position: number) => {

                    if (position < 0 || position >= text.length) {
                        return false;
                    }

                    lineBroken = 
                        position >= text.length - 1 
                        || text.charAt(position).match(/[\s\[\.,\:\(\)\{]/) !== null;

                    if (lineBroken) {
                        chunkEndsAt = position;
                    }
                    
                    return lineBroken;
                }

                // Tells whether the line can be broken nearby forward
                const findNearbySpaceForward = (limit: number = TextFormatter.softWrappingLimit) => {
                    let ix = 0;
                    while (
                        ++ix < limit 
                        && !canBreakLineAtPosition(chunkStartsAt + 1 + lengthAbout + ix)) {
                        ;
                    }
                }

                // Tells whether the line can be broken nearby backward
                const findNearbySpaceBackward = () => {
                    let ix = 0;
                    // We can go backwards no more than what soft wrapping limit enables,
                    // but we also shall make sure we don't cross the previous line break
                    while (
                        --ix > -1 * Math.min(TextFormatter.softWrappingLimit, chunkEndsAt - chunkStartsAt) 
                        && !canBreakLineAtPosition(chunkStartsAt + 1 + lengthAbout + ix)) {
                        ;
                    }
                }

                // And now find a suitable breaking point
                // - First check if the text ends soon after the soft wrapping limit to not leave a very short last line
                //   - If the text ends soon after the soft wrapping limit, first try to look for a nearby space backwards,
                //     and only look forward if there is not any
                //   - Otherwise first try to look for a nearby space forward and only go backwards if there's not any
                

                if (text.length - chunkEndsAt < TextFormatter.softWrappingLimit * 1.5) { // Only a few character would remain if breaking here
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

                // Could not wrap nicely, let's use force
                if (!lineBroken) { // Could not wrap in the neighborhood
                    
                    // Try to break forward wherever we can, unless the remaining unwrapped text is short enough
                    
                    if (chunkStartsAt + lengthAbout + (TextFormatter.softWrappingLimit * 1.5) > text.length) { 
                        // No other option but proceeding until we can break the line, if we can break it at all                    
                        findNearbySpaceForward(text.length);
                    } else {
                        // It's not worth making it ugly, let's just have a longer last line
                    }
                }

            }
            
            endReached = chunkEndsAt >= text.length;

            wrappedText += text.substring(chunkStartsAt, chunkEndsAt + 1).trim();

            // Add the break if this is not the last chunk
            if (!endReached) {
                wrappedText += "<br>"
            }
            
            // If no more than a line of text remains, add it to the last new line
            if (chunkEndsAt + lengthAbout >= text.length) {
                wrappedText += text.substring(chunkEndsAt + 1)
                endReached = true
            } else {
                // Move the window to the beginning of the unwrapped part
                chunkStartsAt = chunkEndsAt;
            }
        }

        // Remove line continuation markers
        wrappedText = wrappedText.replace(/\\/, " ")

        // Remove empty lines (spaces between br tags) as they cause Mermaid syntax error,        
        wrappedText = wrappedText.replace(/\s*<br>\s*<br>\s*/, "<br>");

        // Remove superfluous leading and trailing whitespaces around <br> tags
        wrappedText = wrappedText.replace(/\s*<br>\s*/, "<br>");

        // Remove double spaces
        wrappedText = wrappedText.replace(/\s\s+/, " ");

        return wrappedText;
    }
}
