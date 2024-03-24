import * as vscode from 'vscode'
import { generateSequenceDiagram } from './call'

export const output = vscode.window.createOutputChannel('PySequenceReverse')

const getDefaultProgressOptions = (title: string): vscode.ProgressOptions => {
    return {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true
    }
}

export function activate(context: vscode.ExtensionContext) {

    const commandDisposable = vscode.commands.registerCommand(
        'PySequenceReverse.createSequenceDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate call graph'),
                generateSequenceDiagram(context)
            )
        }
    )
    context.subscriptions.push(commandDisposable)

}

