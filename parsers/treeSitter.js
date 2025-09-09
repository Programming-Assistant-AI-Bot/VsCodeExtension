const Parser = require('tree-sitter');
const Perl = require('@ganezdragon/tree-sitter-perl');

let perlParser = null;
let initialized = false;

/**
 * Initializes the Tree-sitter parser for Perl using the native binding.
 * @returns {Parser|null} the initialized Parser instance, or null on failure
 */
function initTreeSitter() {
  if (initialized) return perlParser;

  try {
    // Create a new Tree-sitter parser
    const parser = new Parser();

    // Attach the Perl grammar
    parser.setLanguage(Perl);

    perlParser = parser;
    initialized = true;
    console.log('Tree-sitter (native) parser initialized for Perl');
    return perlParser;
  } catch (err) {
    console.error('Failed to initialize native Tree-sitter parser for Perl:', err);
    return null;
  }
}

module.exports = {
  initTreeSitter,
  getParser: () => perlParser
};
