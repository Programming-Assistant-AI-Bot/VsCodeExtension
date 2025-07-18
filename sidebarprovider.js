const vscode = require('vscode');

class AlternativeSuggestionsProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.suggestions = [];
  }

  /**
   * Refreshes the tree view with new suggestions.
   * @param {string[]} suggestions - An array of code suggestion strings.
   */
  refresh(suggestions) {
    this.suggestions = suggestions;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the TreeItem for the given element.
   * @param {vscode.TreeItem} element - The element for which to return the TreeItem.
   * @returns {vscode.TreeItem}
   */
  getTreeItem(element) {
    // In this setup, getTreeItem is called for the already constructed TreeItems from getChildren,
    // so we just return the element itself.
    return element;
  }

  /**
   * Returns the children of the given element or root if no element is passed.
   * @param {vscode.TreeItem} element - The parent element (undefined for root).
   * @returns {vscode.ProviderResult<vscode.TreeItem[]>}
   */
  getChildren(element) {
    if (element) {
      return Promise.resolve([]);
    } else {
      if (this.suggestions.length === 1 && this.suggestions[0].startsWith("Error:")) {
        const errorMessage = this.suggestions[0];
        const item = new vscode.TreeItem("Error occurred!", vscode.TreeItemCollapsibleState.None); 
        item.tooltip = new vscode.MarkdownString(`**Error Details:**\n\n\`\`\`\n${errorMessage}\n\`\`\``); 
        item.command = undefined; 
        return Promise.resolve([item]);
      }

      // Return the top-level suggestions (for actual code suggestions)
      return Promise.resolve(
        this.suggestions.map((suggestion, index) => {
          const label = `Suggestion ${index + 1}`;
          const description = suggestion.split('\n')[0].trim();
          
          const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
          item.description = description;
          item.tooltip = new vscode.MarkdownString(`\`\`\`perl\n${suggestion}\n\`\`\``); 

          item.command = {
            command: 'perlCodeGen.copySuggestion',
            title: 'Copy Suggestion',
            arguments: [suggestion]
          };
          
          return item;
        })
      );
    }
  }
}

module.exports = { AlternativeSuggestionsProvider };