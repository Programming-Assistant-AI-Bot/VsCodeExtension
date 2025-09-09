function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      return new Promise(resolve => {
        timer = setTimeout(() => resolve(fn(...args)), delay);
      });
    };
  }
  
  module.exports = debounce;
  