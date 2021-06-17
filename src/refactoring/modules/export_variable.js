/**
 * Author: Nefeli Sylvia Charalambous
 * Date: 1/10/2017
 * 
 * Tranform code with jscodeshift
 * Export a Variable (defined in the top-level scope of the module represented by astRootCollection).
 * update export codemods with export statement: exports.<alias> = <exportedElement>;
 */


var exports = module.exports = {};

exports.description = "export_variable";

exports.refactoring = function (jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	// console.log(astRootCollection.toSource());
	// console.log("\n\n\n");

	var exportedElement = transformationInfo.exportedElement;

	// console.log(transformationInfo);
	// console.log(exportedElement);
	
	//variable that needs to be exported
	var variableName = exportedElement.variableName;
	// var variableNode = exportedElement.initializationValueNode;

	//search by the start and end of the definition of the variable, instead of its initialization value
	//case (bluebird): what if a variable is declared, but not initialized?
	var variableNode = exportedElement.variableDeclarationNode;
	
	//node that needs to be removed from the AST (commonjs export)
	var exportNode = exportedElement.exportedVariableNode;

	// console.log(variableNode);

	// (i) find AST node representing the definition of the variable that needs to be exported
	// and replace it with an export named declaration (export variable)

	//retrieve 'coordinates' of variableNode (start/end line/column)
	//(variableNode corresponds to the node representing the initialization value of variable)
	var loc = variableNode.loc;
	var startLine = loc.start.line;
	var startColumn = loc.start.column;
	var endLine = loc.end.line;
	var endColumn = loc.end.column;

	//search VariableDeclaration AST nodes by variableName and coordinates (start/end line/column) - 
	//AST nodes between two ASTs may differ (refactoring candidate identification + source code transformation procedure)
	var variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
	{
		type: "VariableDeclarator",
		id: { name: variableName }
	}]}).filter(path => {

		// var variableDeclarationLoc = variableDeclaration.value.loc;
		var variableDeclarationLoc = path.value.loc;
		var variableDeclarationStartLine = variableDeclarationLoc.start.line;
		var variableDeclarationStartColumn = variableDeclarationLoc.start.column;
		var variableDeclarationEndLine = variableDeclarationLoc.end.line;
		var variableDeclarationEndColumn = variableDeclarationLoc.end.column;
		
		return (variableDeclarationStartLine === startLine && variableDeclarationStartColumn === startColumn &&
			   variableDeclarationEndLine === endLine && variableDeclarationEndColumn === endColumn);
	
	}).replaceWith(path => {

		//mark variable as exported (replace variable declaration AST node with an AST node representing the export declaration of this variable)
		//update variable declaration (prevent assignment of exports/module.exports to variables)
		// var transformedVariableDeclaration = variableDeclaration;
		var transformedVariableDeclaration = path;
				
		//the comments are going to inserted in the transformed AST node (export statement)
		// var comments = variableDeclaration.value.comments;
		var comments = path.value.comments;
		transformedVariableDeclaration.value.comments = "";

		//case: variable is initialized with the result of an assignment (prevent assignments of exports/module.exports to variables)
		// var declarations = variableDeclaration.value.declarations;
		var declarations = path.value.declarations;
		for(declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

			var declaration = declarations[declarationIndex];
			var declarationValueNode = declaration.init;
			while(declarationValueNode !== null && 
				  declarationValueNode.type === 'AssignmentExpression') {
					
					declarationValueNode = declarationValueNode.right;
			}

				//the exported element is initialized with the rightmost operand of the assignment
				declaration.init = declarationValueNode;
				// console.log(declarationValueNode);
		}
				
		//initialize an AST node representing the export statement concerning the element defined in transformedVariableDeclaration
		var exportNamedDeclarationNode = jscodeshiftAPI.exportNamedDeclaration(transformedVariableDeclaration.value);

		//initial variable declaration statement's comments are inserted in the export statement
		exportNamedDeclarationNode.comments = comments;

		return exportNamedDeclarationNode;
	});
		
	//(ii) remove exportNode from AST (commonJS export statement)
	astRootCollection.find(jscodeshiftAPI.AssignmentExpression, exportNode).remove();
	
	// console.log(astRootCollection.toSource());
}

