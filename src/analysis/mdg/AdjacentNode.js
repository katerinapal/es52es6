/**
 * http://usejsdoc.org/
 */

/**
 * Node of the adjacent list. Wrapper containing the adjacent MDGNode, along 
 * with the MDGEdge whose in-going node is represented by the specific node.
 * @param MDGNode: the adjacent node
 * @param MDGEdge: the edge whose in-going node corresponds to MDGNode
 * @returns
 */
function AdjacentNode(mdgNode, mdgEdge) {
	
	this.node = (mdgNode == undefined ? 'externalModule' : mdgNode);
	this.moduleDependency = mdgEdge;
	
	this.printAdjacentNode = function() {
		
		var result = "moduleName: " + (this.node.representedModule === undefined ? 'externalModule' : this.node.representedModule.fileName) + "\n";
		if(this.node === 'externalModule') {

			//adjacent node is an external module (e.g. npm package)
			//do not write other information
			return result;
		}

		result += this.moduleDependency.printModuleDependency();

		return result;
	};
}

exports.AdjacentNode = AdjacentNode;