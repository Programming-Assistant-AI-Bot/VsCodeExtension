const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

/**
 * A Perl Import Analyzer that uses direct file path resolution
 * to retrieve package and subroutine definitions
 */
class PerlImportDefAnalyzer {
  constructor() {
    // No dependency on vectorIndex anymore
  }

  /**
   * Extract module→symbols map from the full file text
   * @param {string} fileText - The content of the Perl file
   * @returns {Object} - Map of module names to their imported symbols
   */
  static extractImports(fileText) {
    const imports = {};
    // Updated regex to handle both module names and quoted file paths
    const regex = /^\s*(?:use|require)\s+(?:([A-Za-z0-9:]+)|["']([^"']+)["'])(?:\s+qw\(\s*([^)]+)\s*\)|\s*["']([^"']+)["']|\s+(.+?)(?:;|$))?/gm;
    
    let match;
    while ((match = regex.exec(fileText))) {
      const moduleName = match[1] || match[2]; // Either bareword module or quoted filename
      let symbols = [];
      
      // Handle various symbol formats - adjust indexes for the capture groups
      if (match[3]) { // qw(...) format
        symbols = match[3].split(/\s+/).filter(Boolean);
      } else if (match[4]) { // quoted string format
        symbols = [match[4]];
      } else if (match[5]) { // any other format
        symbols = [match[5].trim()];
      }
      
      imports[moduleName] = symbols;
      // Add import type (module or file) for proper handling later
      imports[moduleName].importType = match[1] ? 'module' : 'file';
    }
    
    return imports;
  }

/**
 * Find a file directly by its path or name
 * @param {string} filePath - File name or path (e.g., "functions.pl")
 * @returns {Promise<Object|null>} - File definition or null if not found
 */
  async findFileByPath(filePath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !workspaceFolders.length) {
      return null;
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    const currentFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const currentDir = currentFilePath ? path.dirname(currentFilePath) : rootPath;
    
    try {
      // Try to find the file in these locations:
      const searchPaths = [
        // 1. Directly in the same directory as the current file
        path.join(currentDir, filePath),
        // 2. In the workspace root
        path.join(rootPath, filePath),
        // 3. Search in workspace recursively
        ...(await glob(`**/${filePath}`, {
          cwd: rootPath,
          ignore: ['**/node_modules/**', '**/blib/**']
        })).map(f => path.join(rootPath, f))
      ];
      
      // Try each path
      for (const fullPath of searchPaths) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          console.log(`[PerlImportAnalyzer] Found file for ${filePath} at: ${fullPath}`);
          return {
            filepath: fullPath,
            content: content,
            type: 'file'
          };
        } catch (err) {
          // File not found at this path
          console.error(`[PerlImportAnalyzer] Error finding file by path: ${err.message}`);
        }
      }
      
      console.log(`[PerlImportAnalyzer] No file found for: ${filePath}`);
    } catch (err) {
      console.error(`[PerlImportAnalyzer] Error finding file by path: ${err.message}`);
    }
    
    return null;
  }


  /**
   * Find a module file directly by converting the module name to a file path
   * @param {string} moduleName - Module name (e.g., "reader::import")
   * @returns {Promise<Object|null>} - Module definition or null if not found
   */
  async findModuleByPath(moduleName) {
    // Get workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !workspaceFolders.length) {
      return null;
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // Convert module name to relative file path (reader::import -> reader/import.pm)
    const relativePath = `${moduleName.replace(/::/g, '/')}.pm`;
    
    try {
      // Find all matching files
      const files = await glob(`**/${relativePath}`, {
        cwd: rootPath,
        ignore: ['**/node_modules/**', '**/blib/**']
      });
      
      if (files.length > 0) {
        const fullPath = path.join(rootPath, files[0]);
        const content = await fs.readFile(fullPath, 'utf8');
        console.log(`[PerlImportAnalyzer] Found module file for ${moduleName} at: ${fullPath}`);
        return {
          filepath: fullPath,
          content: content,
          type: 'module'
        };
      } else {
        console.log(`[PerlImportAnalyzer] No file found for module: ${moduleName}`);
      }
    } catch (err) {
      console.error(`[PerlImportAnalyzer] Error finding module by path: ${err.message}`);
    }
    
    return null;
  }
  
  /**
   * Find a symbol in a module file
   * @param {string} moduleDef - The module definition
   * @param {string} symbol - Symbol name to find
   * @returns {Object|null} - Symbol definition or null if not found
   */
  async findSymbolInFile(moduleDef, symbol) {
    if (!moduleDef || !moduleDef.content) {
      return null;
    }
    
    try {
      const content = moduleDef.content;
      const lines = content.split('\n');
      let symbolLine = -1;
      let symbolContent = '';
      
      // Match different forms of subroutine declarations
      const subRegexPatterns = [
        new RegExp(`sub\\s+${symbol}\\s*\\{`, 'i'),                // sub name { 
        new RegExp(`sub\\s+${symbol}\\s*\\(.*?\\)\\s*\\{`, 'i'),   // sub name(...) {
        new RegExp(`\\*${symbol}\\s*=\\s*sub\\s*\\{`, 'i'),        // *name = sub {
        new RegExp(`my\\s+\\$${symbol}\\s*=\\s*sub\\s*\\{`, 'i')   // my $name = sub {
      ];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check each pattern for a match
        for (const pattern of subRegexPatterns) {
          if (pattern.test(line)) {
            symbolLine = i;
            
            // Capture the function content
            let bracketCount = 0;
            let startLine = i;
            
            // Count opening and closing brackets to find the end
            for (let j = i; j < lines.length; j++) {
              const openCount = (lines[j].match(/\{/g) || []).length;
              const closeCount = (lines[j].match(/\}/g) || []).length;
              
              bracketCount += openCount - closeCount;
              
              if (bracketCount === 0 && j > i) {
                // Found the end of the function
                symbolContent = lines.slice(startLine, j + 1).join('\n');
                break;
              }
            }
            
            break;
          }
        }
        
        if (symbolLine !== -1) {
          break;
        }
      }
      
      if (symbolLine !== -1) {
        return {
          filepath: moduleDef.filepath,
          content: symbolContent || `sub ${symbol} { ... }`,
          line: symbolLine,
          type: 'subroutine'
        };
      }
    } catch (err) {
      console.error(`[PerlImportAnalyzer] Error finding symbol: ${err.message}`);
    }
    
    return null;
  }
  /**
   * Get definitions for all imports in the current file using file path approach
   * @param {vscode.TextDocument} document - The current document
   * @returns {Promise<Object>} - Map of module/symbol names to their definitions
   */
  async getImportDefinitions(document) {
    console.log('[PerlImportAnalyzer] Analyzing imports using file path lookup...');
    
    const fileText = document.getText();
    const imports = PerlImportDefAnalyzer.extractImports(fileText);
    const results = {};
    
    console.log(`[PerlImportAnalyzer] Found ${Object.keys(imports).length} imported modules/files`);
    
    // Process each module or file
    for (const importName of Object.keys(imports)) {
      console.log(`[PerlImportAnalyzer] Processing import: ${importName}`);
      
      let moduleDef = null;
      const importType = imports[importName].importType || 'module';
      
      // Use the appropriate finder based on import type
      if (importType === 'module') {
        // Find module using path lookup
        moduleDef = await this.findModuleByPath(importName);
      } else {
        // Find direct file import
        moduleDef = await this.findFileByPath(importName);
      }
      

      // Process symbols for this import
      const symbols = imports[importName].filter(item => typeof item === 'string');
      if (moduleDef) {
        if(symbols.length == 0 ){
          results[importName] = [moduleDef];
        }
      } else {
        results[importName] = [];
        console.log(`[PerlImportAnalyzer] Import not found: ${importName}`);
      }
      
      for (const symbol of symbols) {
        // Skip invalid symbols
        if (symbol.includes('/') || symbol.includes('$') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) {
          console.log(`[PerlImportAnalyzer] Skipping invalid symbol: ${symbol}`);
          continue;
        }
        
        console.log(`[PerlImportAnalyzer] Processing symbol: ${symbol}`);
        
        // Use the file/module we found to locate the symbol
        if (moduleDef) {
          const symbolDef = await this.findSymbolInFile(moduleDef, symbol);
          const fullName = `${importName}::${symbol}`;
          
          if (symbolDef) {
            results[fullName] = [symbolDef];
            console.log(`[PerlImportAnalyzer] Found symbol ${symbol} in ${moduleDef.filepath}`);
          } else {
            results[fullName] = [];
            console.log(`[PerlImportAnalyzer] Symbol not found: ${symbol} in import ${importName}`);
          }
        } else {
          results[`${importName}::${symbol}`] = [];
        }
      }
    }
    
    return results;
  }
}

/**
 * Command handler to analyze imports in the current file using file path approach
 * @returns {Promise<Object|null>} Import definitions or null if error
 */
async function analyzeImportsForCurrentFile() {
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
    
    console.log(`[PerlImportAnalyzer] Analyzing file: ${filepath}`);
    
    const analyzer = new PerlImportDefAnalyzer();
    const results = await analyzer.getImportDefinitions(document);
    
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
  analyzeImportsForCurrentFile
}