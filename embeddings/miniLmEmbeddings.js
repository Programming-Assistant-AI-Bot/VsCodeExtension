async function loadPipeline() {
    // Dynamically import the ESM package
    const { pipeline } = await import('@xenova/transformers');  
    return pipeline;
  }
  
class MiniLmEmbeddingProvider {
    constructor() {
      this.modelName = 'Xenova/all-MiniLM-L6-v2';
      this.initPromise = this._initialize();
    }
  
    async _initialize() {
      const pipeline = await loadPipeline();
      this.model = await pipeline('feature-extraction', this.modelName);
    }
  
    async embed(text) {
      await this.initPromise;
      const output = await this.model(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    }
  }
  
  module.exports = { MiniLmEmbeddingProvider };
  