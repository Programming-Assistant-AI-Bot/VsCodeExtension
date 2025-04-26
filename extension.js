const {resolve} = require('path')

const vscode = require('vscode');
const api = require('./api/api');


//generate code for user comments
async function fetchGeneratedCode(comment) {
	try {
	  const response = await api.post('/',comment);
	  return response.data.message;
	} catch (err) {
	  console.log(`Error: ${err.message}`);
	  return "Error fetching suggestion"; // Or handle differently
	}
  }

//Debounce utility:delays func until delay ms have passed without new calls
const debounce = (func,delay)=>{
	let debounceTimer;
	return function(...args){
		clearTimeout(debounceTimer);
		return new Promise(resolve=>{
			debounceTimer = setTimeout(() => resolve(func(...args)),delay )
		})
	}
}

const debounceFetchGeneratedCode = debounce(fetchGeneratedCode,500);

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Define an inline completion item provider.
	console.log("Extension activated")
	const provider = {
	 async provideInlineCompletionItems(document, position, context, token) {
		// Get the text of the current line where completion is requested.
		const lineText = document.lineAt(position).text;

		// Check if the line starts with a comment marker ("#")
		if (lineText.trim().startsWith("#")) {
		  const commentText = lineText
			.replace(/^(\s*#\s?)/, "")  
			.trim();    
		  if(commentText.length>0){
			const suggestion = await debounceFetchGeneratedCode({"message":commentText});
			const endOfLine = new vscode.Position(position.line, lineText.length);
			const range = new vscode.Range(endOfLine, endOfLine);
			const multiLineSuggestion = "\n" + suggestion;
			// Return an inline suggestion with the text and the range for insertion.
			return {
			  items: [
				{
				  insertText: multiLineSuggestion,
				  range:range,
				},
			  ],
			};
		  }	

		}
		console.log("No suggestion provided.");
		// If the line is not a comment, return an empty suggestion.
		return { items: [] };
	  },
	};
  
	// Register the inline completion provider for all files ("**").
	// The provider will be activated for any matching document.
	context.subscriptions.push(
	  vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" },
		provider
	  )
	);
  }


function deactivate() {}

module.exports = {
	activate,
	deactivate
}
