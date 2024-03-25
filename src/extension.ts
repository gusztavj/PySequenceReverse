import * as vscode from 'vscode'
import { Controller } from './controller'

export const output = vscode.window.createOutputChannel('PySequenceReverse')

// ################################################################################################################################
/**
 * Returns the default progress options for a notification progress bar.
 * @param title - The title of the progress bar.
 * @returns The default progress options object.
 */
const getDefaultProgressOptions = (title: string): vscode.ProgressOptions => {
    return {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true
    }
}

// ################################################################################################################################
/**
 * Activates the extension and registers a command to create a sequence diagram.
 * @param context - The VS Code extension context.
 */
export function activate(context: vscode.ExtensionContext) {

    const commandDisposable = vscode.commands.registerCommand(
        'PySequenceReverse.createSequenceDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate sequence diagram'),
                new Controller().generateSequenceDiagram(context)
            )
        }
    )
    context.subscriptions.push(commandDisposable)

}

