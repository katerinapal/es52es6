/**
 * Author: Nefeli Sylvia Charalambous
 * Date: 27/9/2017
 * 
 * Tranform Code with Jscodeshift
 * Add an export declaration to a function with name ObjectName
 * (defined in the top-level scope of the module represented by astRootCollection).
 *
 */


var exports = module.exports = {};
//var convert = require('convert-source-map');

exports.description = "export_function";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	var exportedElement = transformationInfo.exportedElement;
	
	//the name of the function that needs to become exported
	var functionName = exportedElement.functionName;
	
	//node that needs to be modified to an ES6 named export (AST node representing function that is going to become exported)
	var functionNode = exportedElement.functionNode;
	
	//type of function definition (FunctionDeclaration/FunctionExpression)
	//FunctionDeclaration syntax: function <functionName> ([<argumentIdentifier]) {...}
	//FunctionExpression syntax: <leftOperand> = function [<functionName>] ([<argumentIdentifier]) {...}
	var functionType = functionNode.type;
	
	//node that needs to be removed from the AST (commonjs export)
	var exportNode = exportedElement.exportedFunctionNode;

	var exportNodeLoc = exportNode.loc;
	var exportNodeStartLine = exportNodeLoc.start.line;
	var exportNodeStartColumn = exportNodeLoc.start.column;
	var exportNodeEndLine = exportNodeLoc.end.line;
	var exportNodeEndColumn = exportNodeLoc.end.column;
	
//	console.log(exportedElement);
	
//	console.log(functionName);
//	console.log(functionNode);
//	console.log(exportNode);
	
	var functionCollection;
	var functionIndex;
	var functionDeclaration;
	var functionExpression;

	var functionNodeLoc = functionNode.loc;
	var startLine = functionNodeLoc.start.line;
	var startColumn = functionNodeLoc.start.column;
	var endLine = functionNodeLoc.end.line;
	var endColumn = functionNodeLoc.end.column;
	
	//(i) find AST node representing the definition of the function/variable that needs to be exported
	//and replace it with an export named declaration (export function)
	if(functionType === 'FunctionDeclaration') {
		
		//console.log(functionNode);
		
		//FunctionDeclaration syntax: function <functionName> ([params]) {...}
		//(A) search and transform function declarations one by one
		//(search leverages the 'coordinates' of the function represented by functionNode and not the functionNode itself,
		//as astRootCollection and the AST of the source file containing the function (AST created during the refactoring candidate identification procedure) do not reference the same object -
		//maybe this would be resolved if the refactoring candidate identification and the source code transformation procedures are unified into one process)
		//update: search function declaration by name and 'coordinates'
		functionCollection = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, {
				loc: { 
						start: { line: startLine, column: startColumn },
						end: { line: endLine, column: endColumn }
				}
		}).filter(path => {

			return path.value.id.name === functionName;
		});

		// console.log(functionCollection.length);

		//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
		if(functionCollection.length === 1) {

			//mark function declaration as exported with the help of an export named declaration
			//(replace existing function declaration with an export named declaration of this function)
			functionCollection.replaceWith(path => {

				//keep comments inserted by user in the ES6 export declaration
				const comments = path.value.comments;
				path.value.comments = '';
				const node  = path.node;
				const exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
				exportedNode.comments = comments;
				return exportedNode;

			});
		}
		
	}
	else {
		
		//case: the function that needs to become exported is defined through a function expression
		//syntax: <leftOperand> = function [<functionIdentifier>]([paramIdentifierArray]) {...},
		//where <leftOperand> may be a variable declarator, identifier, exports.<identifier>, module.exports

		//update: search function expression by name and 'coordinates'
		functionCollection = astRootCollection.find(jscodeshiftAPI.FunctionExpression, {
			loc: { 
					start: { line: startLine, column: startColumn },
					end: { line: endLine, column: endColumn }
			}
		}).filter(path => {

			return path.value.id.name === functionName;
		});

		// console.log(functionCollection.length);

		//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
		if(functionCollection.length === 1) {

			//retrieve user comments regarding function definition represented by functionExpression
			//if the specific node does not contain comments, maybe his parent AST node contains comments
			//(retrieve these comments)
			var comments = functionExpression.value.comments;
			var parentNode = functionExpression;
			while(comments === undefined) {
					
				parentNode = parentNode.parentPath;
				comments = parentNode.value.comments;
			}

			var exportedNode;
				
			if(functionName != 'anonymus') {

				//case: function is not an anonymus function (syntax: function([<args]) {...})
				//A new variable named functionName is created. 
				//This variable will be assigned the function that is going to become exported.
				var variableName = functionName;
				
				//create identifier variableName
				var variableIdentifier = jscodeshiftAPI.identifier(variableName);
					
				//create variable declarator for variableName (syntax: <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
				var variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionExpression.value);
					
				//print statement represented by the variable declarator AST node (mainly for debugging)
	//			console.log(jscodeshiftAPI(variableDeclarator).toSource());
					
				//create variable declaration for variableName (syntax: var <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
				var variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
					
	//			console.log(jscodeshiftAPI(variableDeclaration).toSource());
					
				//create a node representing the export of the newly created variable
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
			}
			else {

				//case: function is an anonymus function
				//an export default declaration is created
				//(syntax: export default function([<args>]) {...})
				exportedNode = jscodeshiftAPI.exportDefaultDeclaration(functionExpression.value);
			}
				
			exportedNode.comments = comments;

			return exportedNode;
		}
	}
	
	//(iii) remove AST node representing assignment of function to exports/module.exports (CommonJS export statement)
	//search AST node by its 'coordinates' (start/end line/column)
	astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		loc: { 
					start: { line: exportNodeStartLine, column: exportNodeStartColumn },
					end: { line: exportNodeEndLine, column: exportNodeEndColumn }
		}
	}).remove();
}