# Perl Programming Assistant - VS Code Extension

A powerful VS Code extension that provides AI-powered assistance for Perl development, featuring intelligent code suggestions, error detection, and context-aware recommendations.

## 🚀 Features

### 🤖 AI-Powered Code Generation
- **Comment-to-Code**: Write comments starting with `#` and get intelligent code suggestions
- **Context-Aware Suggestions**: Leverages your project structure, imports, and variable definitions for accurate code generation
- **Smart Caching**: Prevents duplicate requests for the same comments, improving performance

### 📋 Alternative Code Suggestions
- **Sidebar Integration**: Select any code block to see alternative implementations in the sidebar
- **Copy to Clipboard**: One-click copying of suggested code alternatives
- **Real-time Updates**: Suggestions update automatically as you select different code blocks

### 🔍 Intelligent Error Detection
- **Real-time Analysis**: Automatic error detection as you type with configurable debounce timing
- **Visual Indicators**: Errors are highlighted directly in your code with detailed descriptions
- **AI-Powered**: Uses advanced AI to detect logical and syntactical issues beyond traditional linting

### 📚 Advanced Code Understanding
- **Project Structure Analysis**: Automatically indexes your Perl codebase for better context
- **Import Resolution**: Tracks and resolves module imports and dependencies
- **Variable Definition Tracking**: Understands variable scope and definitions across files
- **Symbol Usage Analysis**: Identifies how symbols are used throughout your project

## 📦 Installation

1. **Install the Extension**
   ```bash
   # Clone the repository
   git clone <repository-url>
   cd git_check/VsCodeExtension
   
   # Install dependencies
   npm install
   ```

2. **Package the Extension**
   ```bash
   # Install vsce if you haven't already
   npm install -g vsce
   
   # Package the extension
   vsce package
   ```

3. **Install in VS Code**
   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X)
   - Click the "..." menu and select "Install from VSIX..."
   - Select the generated `.vsix` file

## 🛠️ Prerequisites

### Backend Server
This extension requires the Programming Assistant AI Bot backend server to be running:

```bash
# Start the backend server (typically on port 8000)
cd ../backend
python -m uvicorn main:app --reload
```

### Supported File Types
- `.pl` - Perl scripts
- `.pm` - Perl modules  
- `.t` - Perl test files

## ⚙️ Configuration

Access settings through `File > Preferences > Settings` and search for "Perl Code Generation":

### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `perlCodeGeneration.relevantCodeCount` | `3` | Number of relevant code examples to retrieve for context |
| `perlCodeGeneration.indexOnStartup` | `true` | Automatically index the Perl codebase when extension activates |
| `perlCodeGeneration.contextWindowSize` | `15` | Number of lines to consider around cursor for context |
| `perlCodeGeneration.useMemoryIndex` | `true` | Use in-memory index instead of LanceDB for module resolution |

### Example Configuration
```json
{
  "perlCodeGeneration.relevantCodeCount": 5,
  "perlCodeGeneration.indexOnStartup": true,
  "perlCodeGeneration.contextWindowSize": 20,
  "perlCodeGeneration.useMemoryIndex": true
}
```

## 🎯 Usage

### Comment-to-Code Generation

1. **Write a Comment**: Start any line with `#` followed by your description
   ```perl
   # Create a subroutine that validates email addresses
   ```

2. **Get Suggestions**: The extension will automatically generate code based on your comment
   ```perl
   # Create a subroutine that validates email addresses
   sub validate_email {
       my ($email) = @_;
       return $email =~ /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
   }
   ```

### Alternative Code Suggestions

1. **Select Code**: Highlight any block of Perl code
2. **View Sidebar**: Check the "Perl Code Suggestions" panel in the sidebar
3. **Copy Alternatives**: Click on any suggestion to copy it to your clipboard

### Error Detection

- **Automatic Detection**: Errors are automatically detected as you type
- **Visual Feedback**: Problematic code is underlined with error descriptions
- **Configurable Timing**: Adjust detection sensitivity in settings

## 🏗️ Project Structure

```
VsCodeExtension/
├── extension.js              # Main extension entry point
├── package.json             # Extension manifest and configuration
├── api/
│   └── api.js              # Backend API communication
├── collectors/             # Context and code analysis
│   ├── contextCollector.js
│   ├── definitionCollector.js
│   ├── importDefinitionAnalyzer.js
│   ├── perlImportAnalyzer.js
│   └── repoMapProvider.js
├── commands/
│   └── commands.js         # VS Code command implementations
├── indexers/               # Codebase indexing and search
│   ├── codebaseIndexer.js
│   ├── codeStructureIndex.js
│   └── vectorIndex.js
├── parsers/
│   └── treeSitter.js       # Tree-sitter parser integration
├── utils/
│   ├── checkErrors.js      # Error detection utilities
│   └── debounce.js        # Performance optimization
└── test/
    └── extension.test.js   # Unit tests
```

## 🔧 Available Commands

Access commands through the Command Palette (Ctrl+Shift+P):

- **`Perl: Index Codebase`** - Manually trigger codebase indexing
- **`Perl: Show Suggestions`** - Display code suggestions panel
- **`Perl: debugName`** - Debug module name resolution
- **`Perl: debugImports`** - Debug import analysis

## 🚦 Status Indicators

- **Indexing Progress**: Progress notifications during codebase analysis
- **Error Count**: Status bar indicator showing detected errors
- **Backend Connection**: Visual feedback for backend server connectivity

## 🔍 Troubleshooting

### Common Issues

1. **Backend Connection Failed**
   ```
   Error: Backend server is not running
   ```
   **Solution**: Ensure the backend server is running on `http://localhost:8000`

2. **No Code Suggestions**
   ```
   No specific code suggestions received from AI
   ```
   **Solution**: Check that your selection contains valid Perl code and the backend is responding

3. **Indexing Failed**
   ```
   Failed to initialize indexer
   ```
   **Solution**: Ensure you have a workspace folder open with Perl files

### Debug Information

Enable debug logging by checking the "Perl Code Generation" output channel:
- `View > Output > Perl Code Generation`

## 🧪 Development

### Running Tests
```bash
npm test
```

### Development Setup
```bash
# Install dependencies
npm install

# Run in development mode
# Press F5 in VS Code to launch Extension Development Host
```

### Building
```bash
# Lint code
npm run lint

# Package extension
vsce package
```

## 📋 Requirements

- **VS Code**: Version 1.60.0 or higher
- **Node.js**: Version 14.0 or higher
- **Backend Server**: Programming Assistant AI Bot backend running on port 8000
- **Perl**: For testing and validation (optional)

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is part of the Programming Assistant AI Bot system. Please refer to the main project license for usage terms.

## 🔗 Related Projects

- **Frontend Interface**: `../frontend` - Web-based chat interface
- **Backend API**: `../backend` - AI processing server
- **Documentation**: Full project documentation

