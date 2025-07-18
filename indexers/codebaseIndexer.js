const vscode = require('vscode');
const path = require('path');
const {glob} = require('glob');
const fs = require('fs').promises;
const { PerlCodeStructureIndex } = require('./codeStructureIndex');
const { PerlVectorIndex } = require('./vectorIndex');

/**
 * Main controller for indexing Perl codebase
 */
class PerlCodebaseIndexer {
  /**
   * @param {vscode.WorkspaceFolder} workspace - The workspace to index
   * @param {vscode.FileSystemWatcher} fileWatcher - File watcher for handling changes
   */
  constructor(workspace, fileWatcher) {
    this.workspace = workspace;
    this.fileWatcher = fileWatcher;
    this.structureIndex = new PerlCodeStructureIndex();
    this.vectorIndex = new PerlVectorIndex(this.structureIndex, workspace);    
    // Create output channel for logging
    this.outputChannel = vscode.window.createOutputChannel('Perl Indexer');
    
    // Set up file watchers
    this.setupFileWatchers();
  }

  /**
   * Set up file system watchers to handle incremental updates
   */
  setupFileWatchers() {
    // Handle file creation
    this.fileWatcher.onDidCreate(uri => {
      if (this.isPerlFile(uri.fsPath)) {
        this.refreshFile(uri.fsPath);
      }
    });

    // Handle file changes
    this.fileWatcher.onDidChange(uri => {
      if (this.isPerlFile(uri.fsPath)) {
        this.refreshFile(uri.fsPath);
      }
    });

    // Handle file deletion
    this.fileWatcher.onDidDelete(uri => {
      if (this.isPerlFile(uri.fsPath)) {
        this.deleteFromIndex(uri.fsPath);
      }
    });
  }

  /**
   * Log to VS Code output channel
   * @param {string} message - Message to log
   * @param {boolean} show - Whether to show the output channel
   */
  log(message, show = false) {
    this.outputChannel.appendLine(message);
    if (show) {
      this.outputChannel.show();
    }
  }

  /**
   * Check if file is a Perl file
   * @param {string} filepath - Path to the file
   * @returns {boolean} True if the file is a Perl file
   */
  isPerlFile(filepath) {
    const ext = path.extname(filepath);
    return ext === '.pl' || ext === '.pm' || ext === '.t';
  }

  /**
   * Discover all Perl files in workspace
   * @returns {Promise<string[]>} List of Perl file paths
   */
  async discoverPerlFiles() {
    const rootpath = this.workspace.uri.fsPath;                // e.g. D:\code integration
    try {
      // 1. glob returns relative paths under rootpath
      const relativeFiles = await glob('**/*.{pl,pm,t}', {
        cwd: rootpath,
        ignore: '**/node_modules/**'
      });
  
      // 2. Convert to absolute paths so fs.readFile will find them
      const absoluteFiles = relativeFiles.map(f => path.join(rootpath, f));
      this.log(`discoverPerlFiles → ${JSON.stringify(absoluteFiles)}`);
      return absoluteFiles;
  
    } catch (err) {
      this.log(`ERROR in discoverPerlFiles: ${err.message}`, true);
      return [];  // fail safe
    }
  }
  
  

  /**
   * Index the entire workspace
   * @param {(progress: number) => void} progressCallback - Optional callback for reporting progress
   */
  async indexWorkspace(progressCallback) {
    try {
      // Show output channel to debug
      this.outputChannel.show();
      this.log('Starting workspace indexing...', true);
      
      // Discover all Perl files
      const perlFiles = await this.discoverPerlFiles();
      this.log(`Found ${perlFiles.length} Perl files to index`);
      
      // Create file info objects
      const fileInfos = await Promise.all(perlFiles.map(async (filepath) => {
        try {
          const content = await fs.readFile(filepath, 'utf8');
          
          // Log file content summary
          if (content && content.length > 0) {
            this.log(`Read file ${filepath}: ${content.length} chars, starts with: ${content.substring(0, 50).replace(/\n/g, ' ')}...`);
          } else {
            this.log(`WARNING: Empty file or read error ${filepath}`);
          }
          
          return { 
            path: filepath, 
            content,
            cacheKey: `${filepath}:${Date.now()}` 
          };
        } catch (err) {
          this.log(`Error reading file ${filepath}: ${err.message}`);
          return null;
        }
      }));

      // Filter out nulls from failed reads
      const validFiles = fileInfos.filter(Boolean);
      this.log(`Successfully read ${validFiles.length} of ${perlFiles.length} files`);
      
      // Index files
      let processed = 0;
      for (const file of validFiles) {
        await this.indexFile(file);
        processed++;
        
        if (progressCallback) {
          progressCallback(processed / validFiles.length);
        }
        
        // Log progress periodically
        if (processed % 10 === 0 || processed === validFiles.length) {
          this.log(`Indexed ${processed}/${validFiles.length} files (${Math.round(processed/validFiles.length*100)}%)`);
        }
      }
      
      this.log(`Completed indexing ${processed} Perl files`);
    } catch (err) {
      this.log(`ERROR indexing workspace: ${err.message}`);
      this.log(err.stack);
    }
  }

  /**
   * Index a single file
   * @param {Object} fileInfo - File information object
   * @returns {Promise<void>}
   */
  async indexFile(fileInfo) {
    try {
      // First update structure index
      await this.structureIndex.update([fileInfo]);
      
      // Then update vector index
      await this.vectorIndex.update([fileInfo]);
    } catch (err) {
      this.log(`Error indexing file ${fileInfo.path}: ${err.message}`);
    }
  }

  /**
   * Refresh a file in the index
   * @param {string} filepath - Path to the file to refresh
   */
  async refreshFile(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const fileInfo = {
        path: filepath,
        content,
        cacheKey: `${filepath}:${Date.now()}`
      };
      
      await this.indexFile(fileInfo);
      this.log(`Refreshed index for ${filepath}`);
    } catch (err) {
      this.log(`Error refreshing file ${filepath}: ${err.message}`);
    }
  }

  /**
   * Delete a file from the index
   * @param {string} filepath - Path to the file to delete
   */
  async deleteFromIndex(filepath) {
    try {
      await this.structureIndex.delete(filepath);
      await this.vectorIndex.delete(filepath);
      this.log(`Deleted ${filepath} from index`);
    } catch (err) {
      this.log(`Error deleting file ${filepath} from index: ${err.message}`);
    }
  }

  /**
   * Find code relevant to a comment
   * @param {string} comment - User's comment
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array<Object>>} - Relevant code snippets
   */
  async findRelevantCode(comment, limit = 5) {
    return await this.vectorIndex.findSimilarCode(comment, limit);
  }
}

module.exports = { PerlCodebaseIndexer };