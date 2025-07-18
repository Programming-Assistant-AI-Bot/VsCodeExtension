const api = require("../api/api")

/**
 * Sends Perl code to the backend to be checked for errors.
 * This function uses the pre-configured 'api' instance.
 * @param {string} code - The Perl code string to analyze.
 * @returns {Promise<object>} The full response from the API. The actual data
 * will be in the .data property of the response,
 * which is expected to contain an 'errors' array.
 */
const checkCodeForErrors = (code) => {
  // 2. Use the 'api' instance to make the POST request.
  //    The endpoint '/checkErrors/' will be appended to the baseURL.
  return api.post('/checkErrors/', { code });
};

// 3. Export both the 'api' instance for general use and the specific
//    'checkCodeForErrors' function for its dedicated task.
module.exports =checkCodeForErrors;