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
let errorCheckDebounceTime = 2000;
// NEW: Diagnostic collection for displaying errors
let errorDiagnostics = null;
let errorCheckAbortController = new AbortController();

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
 * Analyzes the document for errors and underlines the entire line.
 * @param {vscode.TextDocument} doc - The document to check.
 */
async function updateErrorDiagnostics(doc) {
  if (doc.languageId !== 'perl') return;

  // Cancel any previous, still-running check to prevent "ghost errors"
  errorCheckAbortController.abort();
  errorCheckAbortController = new AbortController();
  const signal = errorCheckAbortController.signal;

  logInfo(`Running error check for: ${doc.fileName}`);
  try {
    const code = doc.getText();
    const response = await checkCodeForErrors(code, signal);
    const errors = response.data.errors;

    if (!Array.isArray(errors)) {
      logError("Received invalid error format from API.", errors);
      return;
    }

    // --- NEW LOGIC: Underline the entire line ---
    const diagnostics = errors.map(error => {
      // The API now returns only line and message.
      const { line: errorLine, message } = error;
      
      // Convert 1-based line from AI to 0-based for VS Code.
      const lineIndex = Math.max(0, errorLine - 1);

      if (lineIndex >= doc.lineCount) {
        logError(`API returned invalid line number: ${errorLine}`);
        return null; // Skip this error if the line doesn't exist
      }

      const lineText = doc.lineAt(lineIndex);
      // Create a range that covers the entire line, from the first character to the last.
      const range = new vscode.Range(
        new vscode.Position(lineIndex, 0),
        new vscode.Position(lineIndex, lineText.text.length)
      );
      
      const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'Perl AI Assistant';
      return diagnostic;
    }).filter(diag => diag !== null); // Filter out any null diagnostics

    errorDiagnostics.set(doc.uri, diagnostics);
    logInfo(`Found ${diagnostics.length} errors.`);

  } catch (err) {
    // If the error was due to cancellation, it's expected, so we just log it quietly.
    if (err.name === 'CanceledError' || err.name === 'AbortError') {
      logInfo('Error check was cancelled because a new one was started.');
    } else {
      logInfo(`Failed to check for errors: ${err.message}`);
    }
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

  const debouncedErrorCheck = debounce(
      (doc) => updateErrorDiagnostics(doc), 
      errorCheckDebounceTime
  );

  errorDiagnostics = vscode.languages.createDiagnosticCollection("perl-ai-errors");
  context.subscriptions.push(errorDiagnostics);

  context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
          if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
              debouncedErrorCheck(event.document);
          }
      })
  );

  context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
          if (editor) {
              debouncedErrorCheck(editor.document);
          }
      })
  );

  context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(doc => errorDiagnostics.delete(doc.uri))
  );

  if (vscode.window.activeTextEditor) {
      debouncedErrorCheck(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('perlCodeGeneration')) { // FIX: Corrected typo 'perlCodegeneration'
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

// Add these variables at the top with other global state
let lastSelectedText = '';
let lastSuggestions = [];

// Replace the processSelectionForSidebar function with this improved version
const processSelectionForSidebar = debounce(async (event) => {
  const selection = event.selections[0];
  const doc = event.textEditor.document;

  // Enhanced Perl file detection - check both languageId and file extension
  const isPerlFile = doc.languageId === 'perl' || 
                     doc.fileName.endsWith('.pl') || 
                     doc.fileName.endsWith('.pm') || 
                     doc.fileName.endsWith('.t');

  // Handle non-Perl files first
  if (!isPerlFile) {
      logInfo(`Skipping suggestion for non-Perl file: ${doc.languageId}, filename: ${doc.fileName}`);
      treeProvider.refresh([`Error: Only Perl code suggestions are supported. Current file is a '${doc.languageId}' file (${doc.fileName}).`]);
      return; 
  }
  
  if (!selection || selection.isEmpty) {
      // Don't clear immediately - only clear if we had no previous selection
      if (lastSelectedText === '') {
          treeProvider.refresh([]);
      }
      return;
  }

  const selectedText = doc.getText(selection);
  
  // If the selected text is the same as last time, don't make a new request
  if (selectedText.trim() === lastSelectedText.trim() && lastSuggestions.length > 0) {
      logInfo("Using cached suggestions for same selection");
      treeProvider.refresh(lastSuggestions);
      return;
  }

  if (selectedText.trim()) {
    try {
      logInfo("Sending request to backend for alternative suggestions...");
      
      const response = await api.post('/altCode/', { code: selectedText });
      
      const alternatives = response.data.alternatives || [];
      
      const suggestionsForSidebar = alternatives.map(item => item.code);

      if (suggestionsForSidebar.length === 0) {
          suggestionsForSidebar.push("No specific code suggestions received from AI, or response format was unexpected.");
      }

      // Cache the results
      lastSelectedText = selectedText.trim();
      lastSuggestions = suggestionsForSidebar;
      
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
      // Only clear if we're moving away from a selection
      if (lastSelectedText !== '') {
          lastSelectedText = '';
          lastSuggestions = [];
          treeProvider.refresh([]);
      }
  }
}, debounceTime); 
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
