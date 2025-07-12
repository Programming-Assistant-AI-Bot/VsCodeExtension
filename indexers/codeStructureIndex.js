const { initTreeSitter, getParser } = require('../parsers/treeSitter');

parser = getParser()

/**
 * Specialized index for Perl code structures 
 */
class PerlCodeStructureIndex {
  constructor() {
  this.structures = new Map(); // filepath -> structures
  }

  /**
   * Extract code structures from a Perl file
   * @param {string} filepath - Path to the file
   * @param {string} contents - File contents
   * @returns {Promise<Array<Object>>} - Extracted code structures
   */
  async getCodeStructures(filepath, contents) {
    const structures = [];
    
    try {
      console.log(`Extracting structures from ${filepath}, parser available: ${!!parser}`);
      // Use Tree-sitter if available
      if (parser) {
        const tree = parser.parse(contents);
        this._extractStructuresFromTree(tree.rootNode, contents, structures);
        console.log(`Tree-sitter extracted ${structures.length} structures`);
      } else {
        // Fallback to regex-based extraction
        this._extractStructuresWithRegex(contents, structures);
        console.log(`Regex extracted ${structures.length} structures`);
      }

      // Add file-level structure for small files
      if (contents.length < 10000) {
        structures.push({
          name: filepath.split(/[\/\\]/).pop(), // Get filename
          type: 'file',
          content: contents,
          range: { start: 0, end: contents.length },
          line: 0
        });
      }
      
      return structures;
    } catch (err) {
      console.error(`Error extracting structures from ${filepath}:`, err);
      return structures;
    }
  }

  /**
   * Extract code structures from Tree-sitter parse tree
   * @private
   */
  _extractStructuresFromTree(node, contents, structures, parentPackage = '') {
    // Extract package declarations
    if (node.type === 'package_statement') {
      // extract the package name 
      const packageNameNode = node.child(1);
      if (!packageNameNode) return;
      const packageName = contents.slice(
        packageNameNode.startIndex,
        packageNameNode.endIndex
      );
      parentPackage = packageName;
    }
    
    // Extract subroutine declarations
    if (node.type === 'function_definition' || node.type === 'anonymous_function') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = contents.substring(nameNode.startIndex, nameNode.endIndex);
        const fullName = parentPackage ? `${parentPackage}::${name}` : name;
        structures.push({
          name: fullName,
          type: 'subroutine',
          content: contents.substring(node.startIndex, node.endIndex),
          range: { start: node.startIndex, end: node.endIndex },
          line: node.startPosition.row
        });
      }
    }

    // Visit children
    for (let i = 0; i < node.childCount; i++) {
      this._extractStructuresFromTree(node.child(i), contents, structures, parentPackage);
    }
  }

  /*
   * Extract code structures using regex patterns
   * @private
   */
  _extractStructuresWithRegex(contents, structures) {
    // Track package declarations without adding them as structures
    let currentPackage = '';
    const packageRegex = /^\s*package\s+([A-Za-z0-9:]+)\s*;/gm;
    let match;
    
    // Create a map of package ranges to determine current package context
    const packageRanges = [];
    while ((match = packageRegex.exec(contents)) !== null) {
      packageRanges.push({
        name: match[1],
        start: match.index
      });
    }
    
    // Process package ranges to define boundaries (but don't add to structures)
    for (let i = 0; i < packageRanges.length; i++) {
      packageRanges[i].end = (i < packageRanges.length - 1) 
        ? packageRanges[i + 1].start 
        : contents.length;
    }
    
    // Extract subroutines with proper package qualification
    const subRegex = /^\s*sub\s+([A-Za-z0-9_]+)(?:\s*\{|\s*$|\s*\([^)]*\)\s*\{)/gm;
    while ((match = subRegex.exec(contents)) !== null) {
      const subName = match[1];
      const startPos = match.index;
      
      // Determine which package this sub belongs to
      currentPackage = '';
      for (const pkg of packageRanges) {
        if (startPos >= pkg.start && startPos < pkg.end) {
          currentPackage = pkg.name;
          break;
        }
      }
      
      // Find matching closing brace
      let braceCount = 0;
      let inComment = false;
      let endPos = startPos;

      // Simple brace matching to find sub end
      for (let i = startPos; i < contents.length; i++) {
        const char = contents[i];
        
        if (char === '#' && !inComment) {
          inComment = true;
        } else if (char === '\n' && inComment) {
          inComment = false;
        } else if (!inComment) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
      }
      
      const fullName = currentPackage ? `${currentPackage}::${subName}` : subName;
      const content = contents.substring(startPos, endPos);
      
      structures.push({
        name: fullName,
        type: 'subroutine',
        content,
        range: { start: startPos, end: endPos },
        line: this._getLineNumber(contents, startPos)
      });
    }
  }

  /**
   * Get line number from character position
   * @private
   */
  _getLineNumber(text, offset) {
    return text.substring(0, offset).split('\n').length - 1;
  }

  /**
   * Update index with new or changed files
   * @param {Array<{path: string, content: string}>} files - Files to update
   */
  async update(files) {
    for (const file of files) {
      const structures = await this.getCodeStructures(file.path, file.content);
      this.structures.set(file.path, structures);
    }
  }

  /**
   * Delete a file from the index
   * @param {string} filepath - Path to delete
   */
  async delete(filepath) {
    this.structures.delete(filepath);
  }

  /**
   * Get all indexed structures
   * @returns {Array<Object>} All indexed structures
   */
  getAllStructures() {
    const allStructures = [];
    for (const structures of this.structures.values()) {
      allStructures.push(...structures);
    }
    return allStructures;
  }
}

module.exports = { PerlCodeStructureIndex };