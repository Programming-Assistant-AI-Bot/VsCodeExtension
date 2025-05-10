class PerlImportAnalyzer {
    static extractImports(text) {
      const imports = {};
      const regex = /^\s*(use|require)\s+([A-Za-z0-9:]+)(?:\s+qw\(\s*([^)]+)\s*\)|\s*['"]([^'"]+)['"])?/gm;
      let m;
      while ((m = regex.exec(text))) {
        const mod = m[2], syms = m[3]?.split(/\s+/) || (m[4] ? [m[4]] : []);
        imports[mod] = syms;
      }
      return imports;
    }
  
    static findUsedSymbols(text, imports) {
      const used = new Set();
      for (const [mod, syms] of Object.entries(imports)) {
        if (new RegExp(`\\b${mod.replace('::','::')}\\b`).test(text)) used.add(mod);
        syms.forEach(s => {
          if (new RegExp(`\\b${s}\\b`).test(text)) used.add(`${mod}::${s}`);
        });
      }
      return [...used];
    }
  }
  
module.exports = PerlImportAnalyzer;
  