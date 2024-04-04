# PySequenceReverse

This extension for VS Code enables you to create UML-compliant Mermaid sequence diagrams from Python code to perform reverse engineering and to gain more knowledge about a piece of code.

![Screenshot](art/screenshot.png)

## What's New

### Version 1.1.0:

* Improved sequencing. If there is a call like `foo(bar(x))`, from now on `bar()` will come before `foo()` as it is actually called first.
* Object name matches UML syntax, instead of _class:instance_, _instance :class_ is used from now on.
* New settings to specify [return message label](#diagram-return-message-label), and to choose what message details you want to see, [parameters](#diagram-show-signatures-instead-parameters), [signatures](#diagram-show-signatures-instead-parameters) or [nothing](#diagram-omit-message-details).
* Some fixes.


## Legal Stuff

[MIT license](/LICENSE) applies, so it's all free and open. Donation options available in the [repo](https://github.com/gusztavj/PySequenceReverse) to support further development.

### Credits

This work is loosely based on [VS Code Chartographer](https://github.com/arpinfidel/vscode-chartographer), the call graph creating extension from _Richard Putra_.

Thanks for the valuable advices of [arpicheck](https://github.com/arpicheck).

## Features

* Create UML-compliant sequence diagram for any function in [Mermaid language](https://mermaid.js.org/)
* Limit call depth to have higher-level diagrams
* Ignore calls you don't need
* Ignore calls to 3rd party packages, as well as physical and virtual Python environments
* Automatically view created diagrams for preview using [Mermaid Editor](https://marketplace.visualstudio.com/items?itemName=tomoyukim.vscode-mermaid-editor) from [tomoyukim](https://marketplace.visualstudio.com/publishers/tomoyukim)
* Automatically save created diagrams (in the format and to the location you set in **Mermaid Editor**)

## How to Use?

1. Click in or point to a function's name.
1. Either
   * Right-click and select **PySequenceReverse: Create diagram for this function**

     or

   * Hit `Ctrl+Shift+P` and start typing `PySequenceReverse: Create diagram for this function`, the hit it, too.

1. Wait for the diagram to be created and watch out for status messages.

If [automated saving](#files-save-diagram-file-automatically) and [automatically opening](#files-open-diagram-automatically) diagrams are both enabled, you'll be presented with the diagram once the operation completes. If auto-save is not enabled, first you'll need to save the diagram.

## Configuration Settings

In VS Code, click **File > Preferences > Settings**, select **User** or **Workspace**, expand **Extensions** and select **PySequenceReverse** to view and edit settings.

### Scoping

Set the scope of what you would like to see on the sequence diagrams.

#### Ignore: Ignore on Generate

List file patterns. Files matching these patterns won't be analyzed. If a call targets an item in such a file, it won't be added to the diagram. Use this to ignore calls that are not of much value or only distract the reader. Logging methods may be a typical example.

#### Ignore: Ignore Non-Workspace Files

Limit code analysis to the current VS Code workspace. Calls targeting anything out of it won't be added to the diagrams. You can use this to not analyze third-party packages.

#### Ignore: Ignore Analyzing Third-Party Packages

With this self-explanatory setting. This includes folders named `.venv` and `.conda`, as well as the Python path set in VS Code Settings, as well as the values set in the **Venv folders** and **Venv Path** settings of Python in VS Code Settings.

### Proceeding with Files

Settings to control what to do once a diagram is created.

#### Files: Save Diagram File Automatically

When checked, each diagram you create will be saved automatically to the workspace's root folder, with the file name composed of the name of the function, its containing class or module and workspace-relative path. When not checked, you'll be presented with a dialog to select a location and specify a name for the file.

#### Files: Open Diagram Automatically

When checked, the diagram saved automatically or manually will be displayed in VS Code after successful save if [Mermaid Editor](https://marketplace.visualstudio.com/items?itemName=tomoyukim.vscode-mermaid-editor) is installed.

### Diagram

Settings related to the sequence diagrams, their contents and formatting.

#### Maximum call depth (1 to 32)

Only up this level of nesting will calls be detailed to let you control the amount of information and level of complexity you tolerate on a diagram. When limited depth is reached and there are further function calls to deeper levels, instead of gathering them, a note will let you know next to the relevant method that further details are cut. This way you'll know where to go for further details if you need any.

#### Diagram: Omit Message Details

When checked, messages won't show details (like arguments passed or function signature), only the message name.

#### Diagram: Show Signatures Instead Parameters

When checked, and [message details are not omitted](#diagram-omit-message-details), the signatures of the called functions will be shown for messages instead of the parameters passed to the function.

If unchecked, you'll find the parameters there.

Observed only when [message details are not omitted](#diagram-omit-message-details).

#### Diagram: Return Message Label

The label to show on return messages. The default is **return value**. If you specify an empty value, a space will be used to comply with Mermaid syntax.

## Requirements

**PySequenceReverse** relies on the "call hierarchy" feature of an LSP server. So, to use **PySequenceReverse** for your project analysis, you must have a language server extension that supports "call hierarchy."

 [Mermaid Editor](https://marketplace.visualstudio.com/items?itemName=tomoyukim.vscode-mermaid-editor) from [tomoyukim](https://marketplace.visualstudio.com/publishers/tomoyukim) is required to view **Mermaid** diagrams.

## For more information

Support, bug reports, feature requests and other stuff in the [GitHub repo](https://github.com/gusztavj/PySequenceReverse).
