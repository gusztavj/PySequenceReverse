

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
