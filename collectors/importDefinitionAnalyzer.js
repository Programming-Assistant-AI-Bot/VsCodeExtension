const vscode = require('vscode');
/**
 * A Perl Import Analyzer that uses LanceDB to directly retrieve
 * package and subroutine definitions
 */
class PerlImportDefAnalyzer {
  constructor(vectorIndex) {
    this.vectorIndex = vectorIndex;
  }

  /**
   * Extract module→symbols map from the full file text
   * @param {string} fileText - The content of the Perl file
   * @returns {Object} - Map of module names to their imported symbols
   */
  static extractImports(fileText) {
    // Keep existing implementation
    const imports = {};
    // Regex to match use/require statements
    const regex = /^\s*(?:use|require)\s+([A-Za-z0-9:]+)(?:\s+qw\(\s*([^)]+)\s*\)|\s*['"]([^'"]+)['"]|\s+(.+?)(?:;|$))?/gm;
    
    let match;
    while ((match = regex.exec(fileText))) {
      const moduleName = match[1];
      let symbols = [];
      
      // Handle various symbol formats
      if (match[2]) { // qw(...) format
        symbols = match[2].split(/\s+/).filter(Boolean);
      } else if (match[3]) { // quoted string format
        symbols = [match[3]];
      } else if (match[4]) { // any other format
        symbols = [match[4].trim()];
      }
      
      imports[moduleName] = symbols;
    }
    
    return imports;
  }

  /**
   * Get definitions for all imports in the current file using direct LanceDB queries
   * @param {vscode.TextDocument} document - The current document
   * @returns {Promise<Object>} - Map of module/symbol names to their definitions
   */
  async getImportDefinitionsFromLanceDB(document) {
    console.log('[PerlImportAnalyzer] Analyzing imports using LanceDB...');
    
    if (!this.vectorIndex) {
      console.warn('[PerlImportAnalyzer] Vector index not available, falling back to definition provider');
      return PerlImportAnalyzer.getImportDefinitions(document);
    }
    
    const fileText = document.getText();
    const imports = PerlImportDefAnalyzer.extractImports(fileText);
    const results = {};
    
    console.log(`[PerlImportAnalyzer] Found ${Object.keys(imports).length} imported modules`);
    
    // Process each module
    for (const moduleName of Object.keys(imports)) {
      console.log(`[PerlImportAnalyzer] Processing module: ${moduleName}`);
      
      try {
        // Direct query for exact module name
        const moduleMatches = await this.vectorIndex.table
        .query()                                       
        .where(`type = 'package' AND title = '${moduleName}'`)  
        .limit(1)                                       
        .toArray();
        
        console.log(`[PerlImportAnalyzer] Found ${moduleMatches.length} exact package match(es) for ${moduleName}`);
        
        // Format results
        results[moduleName] = moduleMatches.map(match => ({
          filepath: match.path,
          content: match.content
        }));
        
        // Process symbols for this module
        const symbols = imports[moduleName];
        for (const symbol of symbols) {
          // Skip invalid symbols
          if (symbol.includes('/') || symbol.includes('$') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) {
            console.log(`[PerlImportAnalyzer] Skipping invalid symbol: ${symbol}`);
            continue;
          }
          
          const fullName = `${moduleName}::${symbol}`;
          console.log(`[PerlImportAnalyzer] Processing symbol: ${symbol}`);
          
          try {
            // Direct query for exact subroutine name
              const subMatches = await this.vectorIndex.table
              .query()                                       
              .where(`type = 'subroutine' AND title = '${fullName}'`)  
              .limit(1)                                       
              .toArray();
            
            console.log(`[PerlImportAnalyzer] Found ${subMatches.length} exact subroutine match(es) for ${fullName}`);
            
            // Format results
            results[fullName] = subMatches.map(match => ({
              filepath: match.path,
              content: match.content
            }));
          } catch (err) {
            console.error(`Error processing symbol ${fullName}: ${err.message}`);
            results[fullName] = [];
          }
        }
      } catch (err) {
        console.error(`Error processing module ${moduleName}: ${err.message}`);
        results[moduleName] = [];
      }
    }
    
    return results;
  }
}

/**
 * Command handler to analyze imports in the current file using LanceDB
 * @param {Object} vectorIndex - Instance of PerlVectorIndex
 * @returns {Promise<Object|null>} Import definitions or null if error
 */
async function analyzeImportsForCurrentFileWithLanceDB(vectorIndex) {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return null;
    }
    
    const document = editor.document;
    const filepath = document.uri.fsPath;
    
    // Check if this is a Perl file
    if (!filepath.endsWith('.pl') && !filepath.endsWith('.pm')) {
      vscode.window.showInformationMessage('Not a Perl file');
      return null;
    }
    
    console.log(`[PerlImportAnalyzer] Analyzing file with LanceDB: ${filepath}`);
    
    const analyzer = new PerlImportDefAnalyzer(vectorIndex);
    const results = await analyzer.getImportDefinitionsFromLanceDB(document);
    
    const totalEntries = Object.keys(results).length;
    console.log(`[PerlImportAnalyzer] Analysis complete: ${totalEntries} entries found`);
    
    if (totalEntries === 0) {
      vscode.window.showInformationMessage('No Perl imports detected in this file');
    } else {
      vscode.window.showInformationMessage(`Found ${totalEntries} Perl imports`);
    }
    
    return results;
  } catch (error) {
    console.error(`[PerlImportAnalyzer] Error: ${error.message}`);
    vscode.window.showErrorMessage(`Error analyzing imports: ${error.message}`);
    return null;
  }
}

module.exports = {
  PerlImportDefAnalyzer,
  analyzeImportsForCurrentFileWithLanceDB
}