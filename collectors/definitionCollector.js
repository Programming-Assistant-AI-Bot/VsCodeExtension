// src/collectors/definitionCollector.js
const vscode = require('vscode');

class DefinitionCollector {
  static async getDefinitionsAtPosition(document, position) {
    const defs = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider', document.uri, position
    );
    if (!defs) return [];
    return Promise.all(defs.map(async d => {
      const doc = d.uri.toString() === document.uri.toString()
        ? document
        : await vscode.workspace.openTextDocument(d.uri);
      return {
        text: doc.getText(d.range),
        uri: d.uri.toString(),
        range: d.range
      };
    }));
  }

  static async findVariableDefinitions(document, range) {
    const text = document.getText(range);
    const regex = /(?:\$|\@|\%)\w+\s*=\s*[^;]+;/g;
    return text.match(regex) || [];
  }
}

module.exports = DefinitionCollector;
