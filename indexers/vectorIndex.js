const lancedb = require('@lancedb/lancedb');
const path = require('path');
const os = require('os');
const { MiniLmEmbeddingProvider } = require('../embeddings/miniLmEmbeddings');

/**
 * Vector index for semantic search using LanceDB
 */
class PerlVectorIndex {
  /**
   * @param {Object} structureIndex - Code structure index
   */
  constructor(structureIndex) {
    this.structureIndex = structureIndex;
    this.embedProvider = new MiniLmEmbeddingProvider();
    this.dbPath = path.join(os.homedir(), '.vscode', 'perl-extension-db');
    this.tableName = 'perl_code_embeddings';
    this.db = null;
    this.table = null;
    this.debug = true; // Enable debug mode
    
    // Initialize the database
    this._initDb();
  }

  /**
   * Log debug information
   * @param {string} message - Message to log
   * @param {any} data - Optional data to log
   * @private
   */
  _debugLog(message, data = null) {
    if (this.debug) {
      console.log(`[DEBUG] ${message}`);
      if (data !== null) {
        if (Array.isArray(data) && data.length > 100) {
          console.log(`Array length: ${data.length}`);
          console.log('First 5 elements:', data.slice(0, 5));
          console.log('Last 5 elements:', data.slice(-5));
        } else if (typeof data === 'object') {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(data);
        }
      }
    }
  }

  /**
   * Initialize LanceDB
   * @private
   */
  async _initDb() {
    try {
      this._debugLog('Initializing LanceDB connection...');
      // Connect to LanceDB
      this.db = await lancedb.connect(this.dbPath);
      this._debugLog(`Connected to LanceDB at ${this.dbPath}`);
      
      // Check if table exists
      const tables = await this.db.tableNames();
      this._debugLog(`Available tables:`, tables);
      
      if (tables.includes(this.tableName)) {
        this._debugLog(`Opening existing table: ${this.tableName}`);
        this.table = await this.db.openTable(this.tableName);
        
        // Get table schema for debugging
        const schema = await this.table.schema();
        this._debugLog('Table schema:', schema);
        
        // Count records for debugging
        const count = await this.table.countRows();
        this._debugLog(`Table contains ${count} records`);
      } else {
        this._debugLog(`Creating new table: ${this.tableName}`);
        // Create table with schema
        this.table = await this.db.createTable(this.tableName, [
          {
            path: '',
            cacheKey: '',
            content: '',
            title: '',
            vector: Array(384).fill(0), // MiniLM-L6-v2 has 384 dimensions
            type: ''
          }
        ]);
        this._debugLog('New table created successfully');
      }
      
      console.log('LanceDB initialized successfully');
    } catch (err) {
      console.error('Error initializing LanceDB:', err);
      this._debugLog('Full error details:', err);
    }
  }

  /**
   * Get all records from the database (for debugging)
   * @returns {Promise<Array<Object>>} All records in the database
   */
  async getAllRecords() {
    if (!this.table) {
      this._debugLog('Table not initialized, initializing now...');
      await this._initDb();
    }
    
    try {
      this._debugLog('Fetching all records from database...');
      
      const query = await this.table.query();
      const results = await query.toArray(); // Convert Arrow Table to JS array
      this._debugLog(
        'Retrieved results: ' +
        JSON.stringify(
          results.map(r => ({
            path:     r.path,
            cacheKey: r.cacheKey,
            "content":r.content,
            "title":r.title,
            "samplevector":r.vector.slice(0, 5),
            "type":r.type
          })),
          null,
          2
        )
      );
      
      this._debugLog(`Retrieved ${results.length} records`);
      
      // Log record distribution by path
      const pathDistribution = {};
      results.forEach(record => {
        pathDistribution[record.path] = (pathDistribution[record.path] || 0) + 1;
      });
      
      this._debugLog('Records by path:', pathDistribution);
      
      // Log record distribution by type
      const typeDistribution = {};
      results.forEach(record => {
        typeDistribution[record.type] = (typeDistribution[record.type] || 0) + 1;
      });
      
      this._debugLog('Records by type:', typeDistribution);
      
      return results;
    } catch (err) {
      console.error('Error retrieving all records:', err);
      this._debugLog('Full retrieval error:', err);
      return [];
    }
  }

  /**
   * Update index with new or changed files
   * @param {Array<{path: string, content: string, cacheKey: string}>} files - Files to update
   */
  async update(files) {
    if (!this.table) {
      this._debugLog('Table not initialized for update, initializing now...');
      await this._initDb();
    }

    for (const file of files) {
      try {
        this._debugLog(`Processing file for update: ${file.path}`);
        
        // First delete existing entries for this file
        await this.delete(file.path);
        
        // Extract code structures
        this._debugLog(`Extracting code structures from: ${file.path}`);
        const structures = await this.structureIndex.getCodeStructures(file.path, file.content);
        this._debugLog(`Found ${structures.length} code structures in file`);
        
        // Generate embeddings for each structure
        const records = [];
        
        for (const structure of structures) {
          try {
            this._debugLog(`Generating embedding for structure: ${structure.name}`);
            
            // Generate embedding for the structure
            const vector = await this.embedProvider.embed(structure.content);
            
            this._debugLog(`Vector generated (${vector.length} dimensions)`);
            this._debugLog(`Vector sample:`, vector.slice(0, 5)); // Show first 5 dimensions
            
            // Create record
            records.push({
              path: file.path,
              cacheKey: file.cacheKey,
              content: structure.content,
              title: structure.name,
              vector: vector,
              type: structure.type
            });
          } catch (err) {
            console.error(`Error embedding structure ${structure.name}:`, err);
            this._debugLog(`Embedding error for structure ${structure.name}:`, err);
          }
        }
        
        // Add records to database in batches
        if (records.length > 0) {
          this._debugLog(`Adding ${records.length} embeddings to database`);
          await this.table.add(records);
          console.log(`Added ${records.length} embeddings for ${file.path}`);
          this._debugLog(`Successfully added embeddings for ${file.path}`);
        } else {
          this._debugLog(`No valid records to add for ${file.path}`);
        }
      } catch (err) {
        console.error(`Error updating vector index for ${file.path}:`, err);
        this._debugLog(`Update error for ${file.path}:`, err);
      }
    }
  }

  /**
   * Delete a file from the index
   * @param {string} filepath - Path to delete
   */
  async delete(filepath) {
    if (!this.table) {
      this._debugLog('Table not initialized for delete, initializing now...');
      await this._initDb();
    }
    
    try {
      this._debugLog(`Deleting entries for path: ${filepath}`);
      
      // Get count before deletion for validation
      const beforeCount = await this.table.countRows();
      this._debugLog(`Row count before deletion: ${beforeCount}`);
      
      // Delete by path
      const sanitizedPath = filepath.replace(/'/g, "''");
      const condition = `path = '${sanitizedPath}'`;
      this._debugLog(`Using delete condition: ${condition}`);
      
      await this.table.delete(condition);
      
      // Get count after deletion to verify
      const afterCount = await this.table.countRows();
      this._debugLog(`Row count after deletion: ${afterCount}`);
      this._debugLog(`Deleted ${beforeCount - afterCount} records`);
      
      console.log(`Deleted embeddings for ${filepath}`);
    } catch (err) {
      console.error(`Error deleting embeddings for ${filepath}:`, err);
      this._debugLog(`Deletion error for ${filepath}:`, err);
    }
  }

  /**
   * Find code similar to the given text
   * @param {string} text - Text to find similar code for
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array<Object>>} Similar code snippets
   */
  async findSimilarCode(text, limit = 5) {
    if (!this.table) {
      this._debugLog('Table not initialized for search, initializing now...');
      await this._initDb();
    }
    
    try {
      this._debugLog(`Finding similar code for query: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      // First, get all records for debugging
      this._debugLog('Retrieving all database records for validation...');
      const allRecords = await this.getAllRecords();
      this._debugLog(`Database contains ${allRecords.length} total records`);
      
      if (allRecords.length === 0) {
        this._debugLog('WARNING: Database is empty, no results will be found');
        return [];
      }
      
      // Generate embedding for the query text
      this._debugLog('Generating embedding for query text...');
      const queryEmbedding = await this.embedProvider.embed(text);
      
      this._debugLog(`Query vector generated (${queryEmbedding.length} dimensions)`);
      this._debugLog('Query vector sample:', queryEmbedding.slice(0, 10)); // Show first 10 dimensions
      
      // Search for similar code
      this._debugLog(`Searching for up to ${limit} similar records...`);
    // Now perform the vector search
      const searchResult = await this.table
        .search(queryEmbedding)    // nearest‑neighbor search on your vector column
        .where("path != ''", /* prefilter= */ true)    // pre‑filter to ignore dummy rows entirely
        .limit(limit)              // return up to `limit` results
        .toArray();                // actually run the query :contentReference[oaicite:1]{index=1}

      this._debugLog('Search completed, raw result:', searchResult);
      
      // Check if searchResult is valid and has data
      if (!searchResult || !Array.isArray(searchResult)) {
        this._debugLog('Invalid search result structure:', searchResult);
        return [];
      }
      
      this._debugLog(`Search returned ${searchResult.length} results`);
      
      // Format results - use data property which contains the array of results
      const formattedResults = searchResult.map(result => ({
        title: result.title,
        content: result.content,
        path: result.path,
        type: result.type,
        score: result._distance
      }));
      
      this._debugLog('Formatted results:', formattedResults);
      
      return formattedResults;
    } catch (err) {
      console.error('Error finding similar code:', err);
      this._debugLog('Search error:', err);
      return [];
    }
  }
}

module.exports = { PerlVectorIndex };