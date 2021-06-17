/**
 * Export Property codemod. Used in cases when an object literal is exported through its assignment to exports/module.exports
 */

var exports = module.exports = {};


exports.description = "export_property";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	var exportedElement = transformationInfo.exportedElement;

	//retrieve name, node and export statement node of exported property
	var exportedPropertyName = exportedElement.propertyName;
	var exportedPropertyNode = exportedElement.propertyNode;
	var exportedPropertyExportStatementNode = exportedElement.exportStatementNode;

	//case 1: exportedProperty is exported through assignment to module.exports, export default declaration
	//case 2: exportedProperty is exported through assignment to exports, export named declaration (use the name of the property of exports)

	// console.log(exportedPropertyExportStatementNode);

	var leftOperand = exportedPropertyExportStatementNode.left;
	var accessedObject = leftOperand.object;
	var accessedProperty = leftOperand.property;
	var accessedPropertyName;

	var propertyExportStatementLoc = exportedPropertyExportStatementNode.loc;
	var propertyExportStatementStart = propertyExportStatementLoc.start;
	var startLine = propertyExportStatementStart.line;
	var startColumn = propertyExportStatementStart.column;
	var propertyExportStatementEnd = propertyExportStatementLoc.end;
	var endLine = propertyExportStatementEnd.line;
	var endColumn = propertyExportStatementEnd.column;

	var comments = null;

	//replacing retrieved AST node with exportedPropertyNode resulted from analysis bug (case: lodash, uglify.options.js) =>
	//transform retrieved AST node, instead of replacing with exportedPropertyNode
// 	if(accessedObject.name === 'module' && accessedProperty.name === 'exports') {

// 		//exportedProperty is exported through assignment to module.exports - create an export default declaration

// 		// console.log(jscodeshiftAPI(exportedPropertyNode).toSource());

// 		exportedNode = jscodeshiftAPI.exportDefaultDeclaration(exportedPropertyNode);
// 	}
// 	else if(accessedObject.name === 'exports') {

// 		//exportedProperty is exported through assignment to exports - create an export named declaration
// 		accessedPropertyName = accessedProperty.name;

// 		//create a variable declaration (variable declarator is named accessedPropertyName, initialization value is represented by exportedPropertyNode)
// 		//create identifier
// 		var variableIdentifier = jscodeshiftAPI.identifier(accessedPropertyName);
					
// 		//create variable declarator for variableName (syntax: <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
// 		var variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, exportedPropertyNode);
		
// 		//print statement represented by the variable declarator AST node (mainly for debugging)
// //		console.log(jscodeshiftAPI(variableDeclarator).toSource());
		
// 		//create variable declaration for variableName (syntax: var <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
// 		var variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
		
// //		console.log(jscodeshiftAPI(variableDeclaration).toSource());
		
// 		//create a node representing the export of the newly created variable
// 		exportedNode = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
// 	}

	// replace exportedPropertyExportStatementNode with exportedNode (search exportedPropertyExportStatementNode by its 'coordinates')
	var exportStatementCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		loc: { 
					start: { line: startLine, column: startColumn },
					end: { line: endLine, column: endColumn }
		}
	}) .replaceWith(path => {

		if(accessedObject.name === 'module' && accessedProperty.name === 'exports') {

			//exportedProperty is exported through assignment to module.exports - create an export default declaration
	
			// console.log(jscodeshiftAPI(exportedPropertyNode).toSource());
	
			exportedNode = jscodeshiftAPI.exportDefaultDeclaration(path.value.right);
		}
		else if(accessedObject.name === 'exports') {
	
			//exportedProperty is exported through assignment to exports - create an export named declaration
			accessedPropertyName = accessedProperty.name;
	
			//create a variable declaration (variable declarator is named accessedPropertyName, initialization value is represented by exportedPropertyNode)
			//create identifier
			var variableIdentifier = jscodeshiftAPI.identifier(accessedPropertyName);
						
			//create variable declarator for variableName (syntax: <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
			var variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);
			
			//print statement represented by the variable declarator AST node (mainly for debugging)
	//		console.log(jscodeshiftAPI(variableDeclarator).toSource());
			
			//create variable declaration for variableName (syntax: var <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
			var variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
			
	//		console.log(jscodeshiftAPI(variableDeclaration).toSource());
			
			//create a node representing the export of the newly created variable
			exportedNode = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
		}

		//keep user-defined comments in the ES6 export declaration
		comments = path.parentPath.value.comments;
		path.parentPath.value.comments = '';
		exportedNode.comments = comments;
		// console.log(jscodeshiftAPI(exportedNode).toSource());
		return exportedNode;
	});

}