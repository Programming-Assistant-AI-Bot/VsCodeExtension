const api = require("../api/api")

/**
 * Sends Perl code to the backend to be checked for errors.
 * This function now accepts an AbortSignal to allow for request cancellation.
 * @param {string} code - The Perl code string to analyze.
 * @param {AbortSignal} signal - The signal to cancel the request.
 * @returns {Promise<object>} The full response from the API.
 */
const checkCodeForErrors = (code, signal) => {
  // Use the correct endpoint and pass the signal.
  // If the signal is aborted elsewhere, Axios will cancel this request.
  return api.post('/checkErrors/', { code }, { signal });
};


// 3. Export both the 'api' instance for general use and the specific
//    'checkCodeForErrors' function for its dedicated task.
module.exports =checkCodeForErrors;