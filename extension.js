const vscode = require('vscode');
const api = require('./api/api');
const { initTreeSitter, getParser } = require('./parsers/treeSitter');
const ContextCollector = require('./collectors/contextCollector');
const DefinitionCollector = require('./collectors/definitionCollector');
const {  PerlImportDefAnalyzer } = require('./collectors/importDefinitionAnalyzer')
const  PerlImportAnalyzer  = require('./collectors/perlImportAnalyzer')
const debounce = require('./utils/debounce');
const { PerlCodebaseIndexer } = require('./indexers/codebaseIndexer');
const { PerlRepositoryMapProvider } = require('./collectors/repoMapProvider');
const { registerCommands } = require('./commands/commands')
const checkCodeForErrors  = require('./utils/checkErrors')
const { AlternativeSuggestionsProvider } = require('./sidebarProvider');
/**
 * Global extension configuration
 */
const config = {
  debounceTime: 500, 
  relevantCodeCount: 2,
  // NEW: Debounce time for error checking (in milliseconds)
  errorCheckDebounceTime: 2000, // 2 seconds, you can set this to 10000 for 10 seconds
  useMemoryIndex:true,
  indexOnStartup: true,
  contextWindowSize: 15, 
};

// Global state for tracking in-flight requests
const inFlightRequests = new Map();


/**
 * Creates a unique key for a request based on comment and context
 * @param {string} comment - The user's comment
 * @param {vscode.TextDocument} doc - Current document
 * @param {vscode.Position} pos - Current cursor position
 * @returns {string} Unique key for the request
 */
function createRequestKey(comment, doc, pos) {
  // Create a unique key that represents this specific request
  return `${doc.fileName}:${pos.line}:${pos.character}:${comment.trim()}`;
}

// Global state
let codebaseIndexer = null;
let outputChannel = null;
let debounceTime = 3000;
// NEW: Diagnostic collection for displaying errors
let errorDiagnostics = null;
// /**
//  * Fetches code suggestion based on a comment
//  * @param {string} comment - The user's comment
//  * @param {vscode.TextDocument} doc - Current document
//  * @param {vscode.Position} pos - Current cursor position
//  * @returns {Promise<string>} Generated code suggestion
//  */
// async function fetchCode(comment, doc, pos) {
//   try {
//     const ctx = await generateContextForComments(comment, doc, pos);
//     const response = await api.post('/commentCode/', { message: comment, context: ctx });
//     return response.data.code;
//   } catch (err) {
//     logError(`Error fetching suggestion: ${err.message}`, err);
//     vscode.window.showErrorMessage(`Failed to generate code: ${err.message}`);
//     return null;
//   }
// }

async function fetchCodeWithDeduplication(comment, doc, pos) {
  const requestKey = createRequestKey(comment, doc, pos);
  
  // Check if we already have a request in progress for this exact same input
  if (inFlightRequests.has(requestKey)) {
    logDebug(`Returning existing promise for request: ${requestKey}`);
    return inFlightRequests.get(requestKey);
  }
  
  // Create new promise for this request
  const requestPromise = (async () => {
    try {
      logDebug(`Starting new request: ${requestKey}`);
      const ctx = await generateContextForComments(comment, doc, pos);
      const response = await api.post('/commentCode/', { message: comment, context: ctx });
      logDebug(`Request completed: ${requestKey}`);
      return response.data.code;
    } catch (err) {
      logError(`Error fetching suggestion for ${requestKey}: ${err.message}`, err);
      vscode.window.showErrorMessage(`Failed to generate code: ${err.message}`);
      return null;
    } finally {
      // Always clean up the request from the map when it's done
      inFlightRequests.delete(requestKey);
      logDebug(`Cleaned up request: ${requestKey}`);
    }
  })();
  
  // Store the promise in our map
  inFlightRequests.set(requestKey, requestPromise);
  
  return requestPromise;
}


/**
 * NEW: Analyzes the entire document for errors and updates diagnostics
 * @param {vscode.TextDocument} doc - The document to check
 */
async function updateErrorDiagnostics(doc) {
    if (doc.languageId !== 'perl') {
        return; // Only check Perl files
    }

    logInfo(`Running error check for: ${doc.fileName}`);
    try {
        const code = doc.getText();
        const lines = code.split('\n');
        
        // Create array of lines with their line numbers, including empty lines
        // Create formatted string with padded line numbers
        const totalLines = lines.length;
        const padding = totalLines.toString().length;
        const linesWithNumbers = lines
            .map((text, index) => {
                const lineNumber = (index + 1).toString().padStart(padding, ' ');
                return `${lineNumber}: ${text}`;
            })
            .join('\n');
        

        
        // Send code with line numbers to backend
        const response = await checkCodeForErrors(linesWithNumbers);
        const errors = response.data.errors; // Assuming the errors are in response.data.errors

        if (!Array.isArray(errors)) {
            logError("Received invalid error format from API.", errors);
            return;
        }

        const diagnostics = errors.map(error => {
            // VS Code lines are 0-indexed, API might return 1-indexed
            const line = Math.max(0, error.line - 1);
            const startChar = error.start || 0;
            const endChar = error.end || Math.max(startChar + 1, lines[line]?.length || 0);
            
            const range = new vscode.Range(
                new vscode.Position(line, startChar),
                new vscode.Position(line, endChar)
            );
            
            const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'Perl AI Assistant';
            return diagnostic;
        });

        errorDiagnostics.set(doc.uri, diagnostics);
        logInfo(`Found ${diagnostics.length} errors.`);

    } catch (err) {
        logInfo(`Failed to check for errors: ${err.message}`, err);
        // Do not show an error message to the user to avoid being disruptive
    }
}



/**
 * Collects and generates context for AI code generation
 * @param {string} comment - The user's comment
 * @param {vscode.TextDocument} doc - Current document
 * @param {vscode.Position} pos - Current cursor position
 * @returns {Promise<object>} Context object with code information
 */
  async function generateContextForComments(comment, doc, pos) {
    try {
      // Create analyzer - either memory-based or LanceDB-based depending on config
      let analyzer = new PerlImportDefAnalyzer();
      // Basic context that doesn't require the indexer
      const codeCtx = ContextCollector.getCodeAround(doc, pos);
      const block = await ContextCollector.getCurrentBlock(doc, pos);
      const imports = PerlImportAnalyzer.extractImports(doc.getText());
      const used = PerlImportAnalyzer.findUsedSymbols(codeCtx.textAroundCursor, imports);
      
      const varDefs = await DefinitionCollector.findVariableDefinitions(
        doc,
        new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end)
      );

      // Context payload with mandatory fields
      const ctxPayload = {
        codePrefix: codeCtx.fullPrefix,
        codeSuffix: codeCtx.fullSuffix,
        currentBlock: block,
        imports: imports,
        usedModules: used,
        variableDefinitions: varDefs,
        fileName: doc.fileName,
      };

      // Get import definitions using the chosen analyzer
      if (analyzer) {
        try {
          ctxPayload.projectStructure = await PerlRepositoryMapProvider.generateTreeMap();
          
          ctxPayload.importDefinitions = await analyzer.getImportDefinitions(doc);
          
          // Get relevant code (works with either approach)
          if (codebaseIndexer) {
            ctxPayload.relatedCodeStructures = await codebaseIndexer.findRelevantCode(
              comment, 
              config.relevantCodeCount
            );
          }
        } catch (indexerErr) {
          logError('Error getting advanced context:', indexerErr);
          // Continue with basic context if advanced context fails
        }
      }

      logDebug('Context generated:', ctxPayload);
      return ctxPayload;
    } catch (err) {
      logError('Error generating context:', err);
      throw new Error(`Failed to generate context: ${err.message}`);
    }
  }

/**
 * Loads extension configuration from settings
 */
function loadConfiguration() {
  const settings = vscode.workspace.getConfiguration('perlCodeGeneration');
  config.relevantCodeCount = settings.get('relevantCodeCount', config.relevantCodeCount);
  config.indexOnStartup = settings.get('indexOnStartup', config.indexOnStartup);
  config.contextWindowSize = settings.get('contextWindowSize', config.contextWindowSize);
}

/**
 * Initializes the codebase indexer
 * @returns {Promise<boolean>} True if indexer was initialized successfully
 */
async function initializeCodebaseIndexer() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    logInfo('No workspace folder found, skipping indexer initialization');
    return false;
  }

  try {
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{pl,pm,t}',
      false, 
      false, 
      false  
    );

    codebaseIndexer = new PerlCodebaseIndexer(workspaceFolders[0], fileWatcher);
    
    if (config.indexOnStartup) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Indexing Perl codebase",
        cancellable: true
      }, async (progress, token) => {
        token.onCancellationRequested(() => {
          logInfo('Indexing cancelled by user');
        });
        
        return codebaseIndexer.indexWorkspace(progressValue => {
          progress.report({ increment: progressValue * 100 });
        }, token);
      });
    } else {
      vscode.window.showInformationMessage(
        'Perl codebase indexing is disabled. Enable it in settings or run "Index Perl Codebase" command.'
      );
    }
    
    return true;
  } catch (err) {
    logError('Failed to initialize codebase indexer:', err);
    vscode.window.showErrorMessage(`Failed to initialize indexer: ${err.message}`);
    return false;
  }
}

/**
 * Logging utilities
 */
function ensureOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Perl Code Generation');
  }
  return outputChannel;
}

function logInfo(message, data) {
  const channel = ensureOutputChannel();
  channel.appendLine(`[INFO] ${message}`);
  if (data) channel.appendLine(JSON.stringify(data, null, 2));
}

function logDebug(message, data) {
  const channel = ensureOutputChannel();
  channel.appendLine(`[DEBUG] ${message}`);
  if (data) channel.appendLine(JSON.stringify(data, null, 2));
}

function logError(message, error) {
  const channel = ensureOutputChannel();
  channel.appendLine(`[ERROR] ${message}`);
  if (error) {
    channel.appendLine(error.stack || error.toString());
  }
  console.error(message, error);
}

/**
 * Extension activation handler
 * @param {vscode.ExtensionContext} context 
 */
async function activate(context) {
  logInfo("Extension activated");
  
  loadConfiguration();
  
  try {
    await initTreeSitter();
    const parser = getParser();
    logDebug("Tree-sitter initialized", parser ? "Parser available" : "Parser not available");
  } catch (error) {
    logError("Failed to initialize Tree-sitter", error);
    vscode.window.showWarningMessage("Perl parser initialization failed. Some features may not work correctly.");
  }

  setTimeout(() => {
    initializeCodebaseIndexer().then(success => {
      if (success) {
        logInfo("Codebase indexer initialized successfully");
      }
    });
  }, 300);


  // Create debounced version of fetchCode
  const debouncedFetch = debounce(fetchCodeWithDeduplication, debounceTime);

  // NEW: Create a debounced version of the error checker
  const debouncedErrorCheck = debounce(
      (doc) => updateErrorDiagnostics(doc), 
      config.errorCheckDebounceTime
  );
  logInfo("Step 4: Debounced functions created.");

  // NEW: Initialize Diagnostics Collection
  logInfo("Step 5: Initializing diagnostics collection...");
  errorDiagnostics = vscode.languages.createDiagnosticCollection("perl-ai-errors");
  context.subscriptions.push(errorDiagnostics);
  logInfo("Step 5: Diagnostics collection initialized.");

  // NEW: Register event listener for when a text document is changed
  logInfo("Step 6: Registering event listeners...");
  context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
          if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
              debouncedErrorCheck(event.document);
          }
      })
  );

  // NEW: Register event listener for when the active editor changes
  context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
          if (editor) {
              // Trigger an immediate check when switching to a new file
              debouncedErrorCheck(editor.document);
          }
      })
  );
  logInfo("Step 6: Event listeners registered.");

  // NEW: Clear diagnostics when a document is closed
  context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(doc => errorDiagnostics.delete(doc.uri))
  );

  // Initial check for the currently active file, if any
  logInfo("Step 7: Performing initial check for active editor...");
  if (vscode.window.activeTextEditor) {
      debouncedErrorCheck(vscode.window.activeTextEditor.document);
  }
  logInfo("Step 7: Initial check complete.");

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('perlCodeGeneration')) {
        loadConfiguration();
        logInfo("Configuration updated", config);
      }
    })
  );

  const inlineCompletionProvider = {
    async provideInlineCompletionItems(doc, pos) {
      const line = doc.lineAt(pos).text;
      if (!line.trim().startsWith('#')) return { items: [] };
      
      const comment = line.replace(/^(\s*#\s?)/, '').trim();
      if (!comment || comment.length < 3) return { items: [] };

      const suggestion = await debouncedFetch(comment, doc, pos);

      if (!suggestion) return { items: [] };
      const cleanCode = suggestion.replace(/```[\w]*\n|\n```/g, '');
      console.log(cleanCode);
      const insertPos = new vscode.Position(pos.line, line.length);
      return {
        items: [{
          insertText: '\n' + cleanCode,
          range: new vscode.Range(insertPos, insertPos)
        }]
      };
    }
  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**/*.{pl,pm}' }, 
      inlineCompletionProvider
    )
  );
  const treeProvider = new AlternativeSuggestionsProvider();
  const treeView = vscode.window.createTreeView('perlCodeGen.alternativeSuggestions', {
    treeDataProvider: treeProvider
  });
  context.subscriptions.push(treeView);

  registerCommands(context, { config, logError, logInfo, initializeCodebaseIndexer, getCodebaseIndexer: () => codebaseIndexer})
  
  logInfo("Extension setup complete");

  const processSelectionForSidebar = debounce(async (event) => {
    const selection = event.selections[0];
    const doc = event.textEditor.document;

    // Handle non-Perl files first
    if (doc.languageId !== 'perl') {
        logInfo(`Skipping suggestion for non-Perl file: ${doc.languageId}`);
        // Display an error message if it's not a Perl file
        treeProvider.refresh([`Error: Only Perl code suggestions are supported. Current file is a '${doc.languageId}' file.`]);
        return; 
    }
    
    if (!selection || selection.isEmpty) {
        treeProvider.refresh([]); // Clear sidebar if selection is empty in a Perl file
        return;
    }

    const selectedText = doc.getText(selection);

    if (selectedText.trim()) {
      try {
        logInfo("Sending request to backend for alternative suggestions...");
        
        const response = await api.post('/altCode/', { code: selectedText });
        
        const alternatives = response.data.alternatives || [];
        
        const suggestionsForSidebar = alternatives.map(item => item.code);

        if (suggestionsForSidebar.length === 0) {
            suggestionsForSidebar.push("No specific code suggestions received from AI, or response format was unexpected.");
        }

        treeProvider.refresh(suggestionsForSidebar); 
        logInfo("Sidebar refreshed with backend suggestions.");

      } catch (err) {
        logError('Failed to fetch alternative suggestions from backend', err);
        
        let userFacingErrorMessage = "An unexpected error occurred. Please check the Debug Console for details.";

        if (err.code === 'ECONNREFUSED') {
            userFacingErrorMessage = "Error: Backend server is not running. Please start your FastAPI backend.";
        } else if (err.response && err.response.data && err.response.data.alternatives && err.response.data.alternatives.length > 0) {
            userFacingErrorMessage = `Backend Error: ${err.response.data.alternatives[0].code}`;
        } else if (err.message) {
            userFacingErrorMessage = `Error fetching suggestions: ${err.message}`;
        }

        treeProvider.refresh([userFacingErrorMessage]);
      }
    } else {
        treeProvider.refresh([]); 
    }
  }, config.debounceTime); 
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(processSelectionForSidebar)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perlcodegeneration.showSuggestions', () => {
      const dummySuggestions = ['Suggested fix 1', 'Suggested snippet 2'];
      treeProvider.refresh(dummySuggestions);  // use the same instance!
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perlCodeGen.copySuggestion', async (codeToCopy) => {
        await vscode.env.clipboard.writeText(codeToCopy);
        vscode.window.showInformationMessage('Suggestion copied to clipboard!');
    })
  );


}
exports.activate = activate;


/**
 * Extension deactivation handler
 */
function deactivate() {
  logInfo("Extension deactivated");
  
  // Clean up resources
  if (codebaseIndexer) {
    codebaseIndexer.dispose();
    codebaseIndexer = null;
  }
  
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
}
exports.deactivate = deactivate;

function getCodebaseIndexer() {
  return codebaseIndexer;
}


function escapeHtml(str) {
  return str.replace(/[&<>"']/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[tag]));
}


module.exports = {
  activate,
  deactivate,
  getCodebaseIndexer
};
