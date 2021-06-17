/**
 * http://usejsdoc.org/
 */

/*
 * Pairs of functionDeclarations and their shared attribute set.
 */
function methodPair() {
	this.methods = [];
	this.sharedAttributeSet;
	
	this.updateMethods = function(methods) {
		
		this.methods = methods;
	};
	
	this.updateSharedAttributeSet = function(sharedAttributeSet) {
		
		this.sharedAttributeSet = sharedAttributeSet;
	};
}

exports.methodPair = methodPair;