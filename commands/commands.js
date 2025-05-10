const vscode = require('vscode');
const { analyzeImportsForCurrentFileWithLanceDB } = require('../collectors/importDefinitionAnalyzer');
const { PerlRepositoryMapProvider } = require('../collectors/repoMapProvider');
const ContextCollector = require('../collectors/contextCollector');
const DefinitionCollector = require('../collectors/definitionCollector');
const { PerlImportDefAnalyzer } = require('../collectors/importDefinitionAnalyzer');
const PerlImportAnalyzer = require('../collectors/perlImportAnalyzer')
const { getParser } = require('../parsers/treeSitter');

/**
 * Registers all commands for the extension.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {object} dependencies - Dependencies like codebaseIndexer, config, etc.
 */
function registerCommands(context, { config, logError, logInfo, initializeCodebaseIndexer, getCodebaseIndexer }) {

  // Command: Analyze context
  context.subscriptions.push(
    vscode.commands.registerCommand('perlcodegeneration.analyzeContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }
      
      try {
        const doc = editor.document;
        const pos = editor.selection.active;
        
        // Surrounding code
        const codeCtx = ContextCollector.getCodeAround(doc, pos);
        
        // Current subroutine/block
        const block = await ContextCollector.getCurrentBlock(doc, pos);
        
        // Imports and used symbols
        const imports = PerlImportAnalyzer.extractImports(doc.getText());
        const usedModules = PerlImportAnalyzer.findUsedSymbols(codeCtx.textAroundCursor, imports);
        
        // Variable definitions in entire file
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          doc.lineAt(doc.lineCount - 1).range.end
        );
        const varDefs = await DefinitionCollector.findVariableDefinitions(doc, fullRange);

        // Folder structure
        const repostruct = await PerlRepositoryMapProvider.generateTreeMap();
        
        // Build the context payload
        const ctxPayload = {
          codePrefix: codeCtx.fullPrefix,
          codeSuffix: codeCtx.fullSuffix,
          currentBlock: block,
          imports: Object.keys(imports),
          usedModules: usedModules,
          variableDefinitions: varDefs,
          fileName: doc.fileName,
          projectStructure: repostruct
        };
        
        // Print everything for debugging
        const out = vscode.window.createOutputChannel('Perl Code Context');
        out.clear();
        out.appendLine('## CODE PREFIX\n' + codeCtx.fullPrefix);
        out.appendLine('\n## CODE SUFFIX\n' + codeCtx.fullSuffix);
        out.appendLine('\n## CURRENT BLOCK\n' + (block || '<none>'));
        out.appendLine('\n## IMPORTS\n' + JSON.stringify(imports, null, 2));
        out.appendLine('\n## USED MODULES/SYMBOLS\n' + JSON.stringify(usedModules, null, 2));
        out.appendLine('\n## VARIABLE DEFINITIONS\n' + JSON.stringify(varDefs, null, 2));
        out.appendLine('\n## FILE NAME\n' + doc.fileName);
        out.appendLine('\n## Project structure\n' + repostruct);
        out.show();
      } catch (error) {
        logError('Error analyzing context:', error);
        vscode.window.showErrorMessage(`Failed to analyze context: ${error.message}`);
      }
    })
  );

  // Command: Debug Tree-sitter
  context.subscriptions.push(
    vscode.commands.registerCommand('vsExtension.debugTreeSitter', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }

      const document = editor.document;
      const text = document.getText();

      try {
        const parser = getParser();
        if (!parser) {
          vscode.window.showErrorMessage('Tree-sitter parser not available');
          return;
        }

        const tree = parser.parse(text);
        const cursor = tree.walk();

        let output = '';
        let indent = '';
        let visitedChildren = false;

        function logNode() {
          output += `${indent}${cursor.nodeType}: [${cursor.startPosition.row},${cursor.startPosition.column}] - [${cursor.endPosition.row},${cursor.endPosition.column}]\n`;
        }

        while (true) {
          if (!visitedChildren && cursor.gotoFirstChild()) {
            logNode();
            indent += '  ';
            visitedChildren = false;
            continue;
          }

          if (cursor.gotoNextSibling()) {
            logNode();
            visitedChildren = false;
            continue;
          }

          if (cursor.gotoParent()) {
            indent = indent.slice(0, -2);
            visitedChildren = true;
            continue;
          }

          break;
        }

        // Create output channel and show tree
        const channel = vscode.window.createOutputChannel('Tree-sitter Debug');
        channel.append(output);
        channel.show();
      } catch (error) {
        logError('Tree-sitter error:', error);
        vscode.window.showErrorMessage(`Tree-sitter error: ${error.message}`);
      }
    })
  );

  // Command: Find relevant code
  context.subscriptions.push(
    vscode.commands.registerCommand('perlcodegeneration.findRelevantCode', async () => {
      const indexer = getCodebaseIndexer();
      if (!indexer) {
        vscode.window.showInformationMessage('Codebase indexer not initialized. Run "Index Perl Codebase" first.');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }

      const pos = editor.selection.active;
      const line = editor.document.lineAt(pos).text;

      if (!line.trim().startsWith('#')) {
        vscode.window.showInformationMessage('Position cursor on a comment line (starting with #)');
        return;
      }

      const comment = line.replace(/^(\s*#\s?)/, '').trim();
      if (!comment) {
        vscode.window.showInformationMessage('Comment is empty');
        return;
      }

      try {
        const relevantCode = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Finding relevant code',
            cancellable: true,
          },
          async (progress, token) => {
            return indexer.findRelevantCode(comment, config.relevantCodeCount, token);
          }
        );

        const output = vscode.window.createOutputChannel('Relevant Perl Code');
        output.clear();

        if (relevantCode.length === 0) {
          output.appendLine('No relevant code found in codebase');
        } else {
          for (const code of relevantCode) {
            output.appendLine(`## ${code.title} (${code.type}) - Score: ${code.score.toFixed(4)}`);
            output.appendLine(`File: ${code.path}\n`);
            output.appendLine(code.content);
            output.appendLine('\n---\n');
          }
        }

        output.show();
      } catch (error) {
        logError('Error finding relevant code:', error);
        vscode.window.showErrorMessage(`Failed to find relevant code: ${error.message}`);
      }
    })
  );

  // Command: Get imports
  context.subscriptions.push(
    vscode.commands.registerCommand('perlcodegeneration.getImports', async () => {
      const indexer = getCodebaseIndexer();
      if (!indexer) {
        vscode.window.showInformationMessage('Codebase indexer not initialized. Run "Index Perl Codebase" first.');
        return;
      }
  
      try {
        const results = await analyzeImportsForCurrentFileWithLanceDB(indexer.vectorIndex);
        
        if (results) {
          const out = vscode.window.createOutputChannel('Perl Imports (LanceDB)');
          out.clear();
          out.appendLine('\n## Imports\n' + JSON.stringify(results, null, 2));
          out.show();
        } else {
          vscode.window.showInformationMessage('No import information found');
        }
      } catch (error) {
        logError('Error analyzing imports:', error);
        vscode.window.showErrorMessage(`Failed to analyze imports: ${error.message}`);
      }
    })
  );
  
  // New Command: Index Perl Codebase (on-demand)
  context.subscriptions.push(
    vscode.commands.registerCommand('perlcodegeneration.indexCodebase', async () => {
      const indexer = getCodebaseIndexer();
      if (!indexer) {
        const created = await initializeCodebaseIndexer();
        if (!created) {
          vscode.window.showErrorMessage('Failed to create codebase indexer');
          return;
        }
      }
      
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Indexing Perl codebase",
          cancellable: true
        }, async (progress, token) => {
          return indexer.indexWorkspace(progressValue => {
            progress.report({ increment: progressValue * 100 });
          }, token);
        });
        
        vscode.window.showInformationMessage('Perl codebase indexed successfully');
      } catch (error) {
        logError('Error indexing codebase:', error);
        vscode.window.showErrorMessage(`Failed to index codebase: ${error.message}`);
      }
    })
  );
}
module.exports = { registerCommands };