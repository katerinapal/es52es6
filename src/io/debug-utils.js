/**
 * debug-utilities.js. Provides utilities for debugging
*/

/**
 * Utility function for error logging in array streaming operations
 * @param {function} fn : function to be invoked
 * @param {*} msg : message to be logged to console
 */
function logError(fn, msg){
	return x => {
		try {
			return fn(x);
		} catch(err){
			console.log("Error for item:" + msg);
			throw err;
		}
	}
}

exports.logError = logError;
