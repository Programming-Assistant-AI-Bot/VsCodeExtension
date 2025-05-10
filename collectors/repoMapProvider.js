const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

class PerlRepositoryMapProvider {
    /**
     * Generate a structured tree map of the workspace, listing only Perl files
     * @returns {Promise<string>} Plain-text folder tree of Perl files
     */
    static async generateTreeMap() {
        const roots = this.getWorkspaceFolders();
        if (!roots.length) throw new Error('No workspace folders found');

        let result = '';
        for (const root of roots) {
            const tree = await this.buildTree(root);
            if (tree.children.length) {
                result += this.renderTree(tree) + '\n';
            }
        }
        return result;
    }

    // Get workspace folder paths
    static getWorkspaceFolders() {
        const folders = vscode.workspace.workspaceFolders || [];
        return folders.map(f => f.uri.fsPath);
    }

    // Determine if a file should be excluded by name
    static shouldExclude(name) {
        const exclude = ['.git', 'blib', '_build', 'local'];
        return exclude.includes(name);
    }

    // Check if a file is a Perl file
    static isPerlFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ['.pl', '.pm', '.t'].includes(ext);
    }

    // Recursively build a tree object, filtering only Perl files and skipping excluded dirs
    static async buildTree(dir) {
        const name = path.basename(dir) + '/';
        const node = { name, children: [] };
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (this.shouldExclude(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const child = await this.buildTree(fullPath);
                // only include directory if it has Perl files inside
                if (child.children.length) {
                    node.children.push(child);
                }
            } else if (this.isPerlFile(entry.name)) {
                node.children.push({ name: entry.name, children: null });
            }
        }
        return node;
    }

    // Render the tree object to indented text
    static renderTree(node, indent = '') {
        let out = indent + node.name + '\n';
        if (node.children) {
            const nextIndent = indent + '  ';
            for (const child of node.children) {
                out += this.renderTree(child, nextIndent);
            }
        }
        return out;
    }
}

module.exports = { PerlRepositoryMapProvider };
