// src/collectors/contextCollector.js
const vscode = require('vscode');
const { getParser } = require('../parsers/treeSitter');

class ContextCollector {
  static getCodeAround(document, position, linesBefore = 15, linesAfter = 15) {
    const startLine = Math.max(0, position.line - linesBefore);
    const endLine = Math.min(document.lineCount - 1, position.line + linesAfter);

    const endPosition = position.line > 0 
    ? new vscode.Position(position.line - 1, document.lineAt(position.line - 1).text.length)
    : new vscode.Position(0, 0);

    const prefix = document.getText(new vscode.Range(
      new vscode.Position(startLine, 0),
      endPosition
    ));
    const suffix = document.getText(new vscode.Range(
      position,
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    ));

    return { fullPrefix: prefix, fullSuffix: suffix, textAroundCursor: prefix + suffix };
  }

  static async getCurrentBlock(document, position) {
    const parser = getParser();
    if (!parser) return null;
  
    const fileText = document.getText();
    const tree     = parser.parse(fileText);
    const offset   = document.offsetAt(position);
  
    // 1) Find the raw node at the cursor (could be a comment)
    let nodeAtCursor = findNodeAtOffset(tree.rootNode, offset);
  
    // 2) If it's a comment, climb up immediately so we never treat
    //    a comment as its own block.
    if (nodeAtCursor.type === 'comment') {
      nodeAtCursor = nodeAtCursor.parent;
    }
  
    // 3) Collect only those ancestors that strictly contain the offset.
    //    (i.e. startIndex ≤ offset < endIndex)
    const ancestors = [];
    for (let cur = nodeAtCursor; cur; cur = cur.parent) {
      if (cur.startIndex <= offset && offset < cur.endIndex) {
        ancestors.push(cur);
      }
    }
  
    // 4) Pick by your existing priority list
    const priority = [
      'function_definition','anonymous_function',
      'while_statement','until_statement','for_statement_1','for_statement_2',
      'if_statement','elsif_clause','else_clause','unless_statement',
      'block','standalone_block','special_block','continue',
      'package_statement',
      'binary_expression','variable_declaration'
    ];
    for (const type of priority) {
      const found = ancestors.find(n => n.type === type);
      if (found) {
        // console.log(`${type} detected`);
        return fileText.slice(found.startIndex, found.endIndex);
      }
    }
  
    // 5) Nothing matched → top‑level
    // console.log("no block detected");
    return "file_scope";
  }
}

function findNodeAtOffset(node, offset) {
  if (offset < node.startIndex || offset > node.endIndex) return null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const found = findNodeAtOffset(child, offset);
    if (found) return found;
  }
  return node;
}

module.exports = ContextCollector;
