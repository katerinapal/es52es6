/**
 * Author: Nefeli Sylvia Charalambous
 * Date: 27/9/2017
 * 
 * Tranform Code with Jscodeshift
 * Add an export declaration to a function with name ObjectName
 * (defined in the top-level scope of the module represented by astRootCollection).
 *
 */

var path = require('path');

var deepClone = require('../../../../node_modules/lodash.clonedeep');

var exports = module.exports = {};
//var convert = require('convert-source-map');

exports.description = "export_function";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	let filePath = transformationInfo.filePath;
	let exportedElement = transformationInfo.exportedElement;
	
	//the name of the function that needs to become exported
	let functionName = exportedElement.functionName;

	//remove dashes and special characters not allowed in ES6
	functionName = functionName.replace(/[^\w\s]/gi, '').replace(/-/g, '');
	filePath = path.basename(filePath, '.js').replace(/[^\w\s]/gi, '').replace(/-/g, '');

	// var exportAlias = exportedElement.exportAlias;
	let exportAlias = exportedElement.elementAlias;
	// exportAlias = (exportAlias != undefined ? exportAlias.replace(/[^\w\s]/gi, '').replace(/-/g, ''): undefined);
	exportAlias = (exportAlias != undefined ? exportAlias.replace(/[^\w\s]/gi, '').replace(/-/g, ''): functionName);
	
	//AST node (location/type) representing function that is going to become exported
	let functionNode = exportedElement.functionNode;
	let isFunctionConstructor = exportedElement.isFunctionConstructor;
	let isObjectReferenced = exportedElement.isObjectReferenced;
	let functionProperties = exportedElement.functionProperties;

	//information relevant to statistics
	//(reporting which functions are destructured during refactoring)
	let resultObject = {

		isFunctionConstructor: isFunctionConstructor,
		isObjectReferenced: isObjectReferenced,
		arePropertiesBoundOnFunction: (functionProperties.length > 0),
		exportedProperties: 0
	};
	
	//type of function definition (FunctionDeclaration/FunctionExpression)
	//FunctionDeclaration syntax: function <functionName> ([<argumentIdentifier]) {...}
	//FunctionExpression syntax: <leftOperand> = function [<functionName>] ([<argumentIdentifier]) {...}
	let functionType = functionNode.type;
	
	//node (location/type) that needs to be removed from the AST (commonjs export)
	//update (TODO): the es6 export statement is determined partially by exportNode
	//(i) if element is exported via module.exports, it may be used directly (export default statement)
	//(ii) if element is exported via exports, it may be used through a reference to the imported module (NamespaceImport) or through an explicit reference (FunctionDefinition)
	let exportNode = exportedElement.exportedFunctionNode;
	let exportedNode;

	// console.log(exportNode);

	//the function's export alias (the name with which it is imported and used in the imported module)
	//update: the exported element's name is the function's initial name
	//(prevent name collisions of exported features)
	// var exportAlias = exportedElement.exportAlias;
	// var exportAliasIdentifier = jscodeshiftAPI.identifier(exportAlias);

	//update: in the case that the object is cohesive, 
	//partially destructure it in the case that properties are bound to it
	//(they belong to the object itself, not to its instances)
	//partial destructuring: dispatch properties bound to constructor function
	//and export function along with its used dispatched properties
	//destructuring NOT triggered in the following cases:
	//(a) the object is included in a namespace that is modified somewhere in the system
	//(b) the object is referenced outside member expressions or referenced through bracket notation
	//(c) the object is imported and reexported in other modules (not destructured regardless of its cohesion, since the client modules of its definition module's client modules may use its properties indirectly (transitively))
	//(d) the object does not have any properties bound to it, regardless of its cohesion
	if(exportedElement.includedInModifiedNamespace === false && 
		exportedElement.isImportedAndReexported === false && 
		isObjectReferenced === false && 
		functionProperties.length > 0) {

		//update: function contains properties (they are bound to the function object)
		//codemod: destructure function object to its OBJECT properties and export them, instead of the function object itself
		// exportNodeLoc = exportNode.loc;
		// exportNodeStartLine = exportNodeLoc.start.line;
		// exportNodeStartColumn = exportNodeLoc.start.column;
		// exportNodeEndLine = exportNodeLoc.end.line;
		// exportNodeEndColumn = exportNodeLoc.end.column;

		resultObject.exportedProperties = destructureFunctionObject(jscodeshiftAPI, astRootCollection, exportedElement, filePath);

		// console.log(astRootCollection.toSource());

		//remove AST node representing assignment of function to exports/module.exports (CommonJS export statement)
		//search AST node by its 'coordinates' (start/end line/column)
		let expressionStatementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportNode);

		// let expressionStatementCollection = astRootCollection.find(jscodeshiftAPI.ExpressionStatement).filter(node => {

		// 	let nodeLoc = node.value.loc;
		// 	if(nodeLoc == null) {

		// 		return false;
		// 	}
		// 	return nodeLoc.start.line === exportNodeStartLine && nodeLoc.start.column === exportNodeStartColumn &&
		// 		   nodeLoc.end.line === exportNodeEndLine && nodeLoc.end.column === exportNodeEndColumn;
		// });

		if(isFunctionConstructor === false && 
			expressionStatementCollection.length === 0) {

			//no exports retrieved - abort
			//update: function is not a constructor
			//export the properties bound on it, not the function itself
			return resultObject;
		}

		//remove the expression statement holding the assignment
		expressionStatementCollection.remove();

		// console.log(astRootCollection.toSource());

		resultObject.isFunctionConstructor = false;
		resultObject.arePropertiesBoundOnFunction = (exportedElement.functionProperties.length > 0);

		if(isFunctionConstructor === false) {

			//update: function is not a constructor
			//do not proceed
			return resultObject;
		}
	}

	if(exportNode === null) {

		//case: function that needs to be exported is not exported via exports/module.exports
		functionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, functionNode);

		// console.log(functionCollection.length);

		if(functionCollection.length === 0) {

			return {};
		}

		//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
		//mark function declaration as exported with the help of an export named declaration
		//(replace existing function declaration with an export named declaration of this function)
		functionCollection.replaceWith(path => {

			if(path.scope.isGlobal === false) {

				//import in inner scope -abort
				return path.value;
			}

			let blockStmts = jscodeshiftAPI(callExpression).closest(jscodeshiftAPI.BlockStatement);
			if(blockStmts.length > 0) {

				return path.value;
			}
		
			// let parentNode = callExpression.parentPath;
			// while(parentNode !== null) {
		
			// 	if(parentNode.value.type === 'BlockStatement') {
		
			// 		//what if import is nested in a block statement? (abort, return the function definition itself, do not export anything)
			// 		return path.value;
			// 	}
		
			// 	parentNode = parentNode.parentPath;
			// }

			//keep comments inserted by user in the ES6 export declaration
			const comments = path.value.comments;
			path.value.comments = '';
			const node  = path.node;

			//assign function to variable and export variable (simulate behaviour of CommonJS)
			// let variableIdentifier = jscodeshiftAPI.identifier(filePath + '_' + functionName);
			let variableIdentifier = jscodeshiftAPI.identifier(functionName);
			// let functionIdentifier = jscodeshiftAPI.identifier(elementAlias);
			let functionIdentifier = jscodeshiftAPI.identifier(exportAlias);

			//create variable declarator (syntax: <exported_<functionName>> = <functionName>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionIdentifier);
						
			//create variable declaration (syntax: let <variableIdentifier> = <callExpression>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variableDeclaration at the top of the AST
			//(function declarations are hoisted and thus may be used before their declaration)
			astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);
			// jscodeshiftAPI(path).insertAfter(variableDeclaration);

			//export function if not exported already under the same export name
			if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, functionName) === false) {

				//create an ES6 named export statement of the form export {<new_variable> as <functionName>}
				//and add it right at the end of the AST
				let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
				exportedNode.comments = comments;

				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
			}

			//return the initial function, do not delete it
			return path.value;

		});	

		return resultObject;
	}

	// if(exportNode === null) {

	// 	//case: function that needs to be exported is not exported via exports/module.exports
	// 	functionCollection = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, {
	// 		loc: { 
	// 				start: { line: startLine, column: startColumn },
	// 				end: { line: endLine, column: endColumn }
	// 		}
	// 	});

	// 	// console.log(functionCollection.length);

	// 	//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
	// 	if(functionCollection.length === 1) {

	// 		//mark function declaration as exported with the help of an export named declaration
	// 		//(replace existing function declaration with an export named declaration of this function)
	// 		functionCollection.replaceWith(path => {

	// 			if(path.scope.isGlobal === false) {

	// 				//import in inner scope -abort
	// 				return path.value;
	// 			}
		
	// 			var parentNode = callExpression.parentPath;
	// 			while(parentNode !== null) {
		
	// 				if(parentNode.value.type === 'BlockStatement') {
		
	// 					//what if import is nested in a block statement? (abort, return the function definition itself, do not export anything)
	// 					return path.value;
	// 				}
		
	// 				parentNode = parentNode.parentPath;
	// 			}

	// 			//keep comments inserted by user in the ES6 export declaration
	// 			const comments = path.value.comments;
	// 			path.value.comments = '';
	// 			const node  = path.node;
	// 			// var exportedNode;
	// 			// exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);

	// 			//assign function to variable and export variable (simulate behaviour of CommonJS)
	// 			// let variableIdentifier = jscodeshiftAPI.identifier(filePath + '_' + functionName);
	// 			let variableIdentifier = jscodeshiftAPI.identifier(functionName);
	// 			// let functionIdentifier = jscodeshiftAPI.identifier(elementAlias);
	// 			let functionIdentifier = jscodeshiftAPI.identifier(exportAlias);

	// 			//create variable declarator (syntax: <exported_<functionName>> = <functionName>)
	// 			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionIdentifier);
						
	// 			//create variable declaration (syntax: let <variableIdentifier> = <callExpression>)
	// 			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

	// 			//insert variableDeclaration at the top of the AST
	// 			//(function declarations are hoisted and thus may be used before their declaration)
	// 			astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);
	// 			// jscodeshiftAPI(path).insertAfter(variableDeclaration);

	// 			//export function if not exported already under the same export name
	// 			if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, functionName) === false) {

	// 				//create an ES6 named export statement of the form export {<new_variable> as <functionName>}
	// 				//and add it right at the end of the AST
	// 				let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
	// 				exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
	// 				exportedNode.comments = comments;

	// 				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
	// 			}

	// 			//return the initial function, do not delete it
	// 			return path.value;

	// 		});
	// 	}

	// 	return resultObject;
	// }

	// exportNodeLoc = exportNode.loc;
	// exportNodeStartLine = exportNodeLoc.start.line;
	// exportNodeStartColumn = exportNodeLoc.start.column;
	// exportNodeEndLine = exportNodeLoc.end.line;
	// exportNodeEndColumn = exportNodeLoc.end.column;

	// console.log(exportNodeLoc);
	
//	console.log(exportedElement);
	
//	console.log(functionName);
	// console.log(functionNode);
	// console.log(exportNode);

	let exportStmtNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportNode);
	if(exportStmtNodes.length === 0) {

		return;
	}

	let exportStmtNode = exportStmtNodes.at(0).get();
	let isNestedInBlockStatement = isExportStatementNestedInBlockStatement(jscodeshiftAPI, astRootCollection, exportStmtNode);

	// console.log(isNestedInBlockStatement);

	let functionExportedViaModuleExports = isFunctionExportedViaModuleExports(exportStmtNode);

	if(functionExportedViaModuleExports === false && 
		isFunctionAssignedToAPropertyOfExportsOrModuleExports(jscodeshiftAPI, astRootCollection, exportedElement) === true) {

		//function is exported through assignment to a property of module.exports/exports
		//in the export statement, module.exports is replaced with the name of the element that is exported through the ES6 default export statement
		//do not export the function itself
		return {

			isConstructor: isFunctionConstructor,
			arePropertiesBoundToFunction: (functionProperties.length > 0)
		};
	}
	
	//(i) find AST node representing the definition of the function/variable that needs to be exported
	//and replace it with an export named declaration
	//(the export statement is named regardless of the commonjs export statement used to export the function)
	// search function definition blindly, regardless of its type
	let functionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, functionNode);

	if(functionCollection.length === 0) {

		return {

			isConstructor: false,
			arePropertiesBoundToFunction: false
		};
	}

	//keep function's comments
	//1-1 mapping between node and its location
	let functionDefinition = functionCollection.at(0).get();
	let comments = null;
	if(functionDefinition.value.type === 'FunctionDeclaration') {

		comments = functionDefinition.value.comments;
	}
	else {

		let surrStmts = jscodeshiftAPI(functionDefinition).closest(jscodeshiftAPI.Statement);

		if(surrStmts.length > 0) {

			comments = surrStmts.at(0).get().value.comments;
		}
	}

	if(functionType === 'FunctionDeclaration') {
		
		//FunctionDeclaration syntax: function <functionName> ([params]) {...}
		//search and transform function declarations one by one

		//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
		//mark function declaration as exported with the help of an export named declaration

		//assign function to variable and export variable (simulate behaviour of CommonJS)
		let variableIdentifier = jscodeshiftAPI.identifier(functionName);
		let functionIdentifier = jscodeshiftAPI.identifier(exportAlias);

		//create variable declarator (syntax: mod_<functionName> = <functionName>)
		let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionIdentifier);
					
		//create variable declaration (syntax: let <variableIdentifier> = <callExpression>)
		let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

		//insert variableDeclaration at the start of the AST
		//(function declarations are hoisted and thus can be used before their definition)
		astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);

		//export function if not already exported
		if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, functionName) === false) {

			//create an ES6 named export statement of the form export {<new_variable> as <functionName>}
			//and add it right at the end of the AST
			let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
			exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
			exportedNode.comments = comments;
			astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
		}

		//(iii) remove statement containing assignment of function to exports/module.exports (CommonJS export statement)
		//search AST node by its 'coordinates' (start/end line/column)
		let assignmentCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportNode);

		//update: what if assignment is part of another assignment (assignment of exports to module.exports)
		if(assignmentCollection.length === 1) {

			let exportStatement = assignmentCollection.at(0).get();

			// console.log(exportStatement);

			if(exportStatement.value.type === 'ExpressionStatement') {

				assignmentCollection.remove();
			}
			else {

				let surrExpStmts = jscodeshiftAPI(exportStatement).closest(jscodeshiftAPI.ExpressionStatement);
				if(surrExpStmts.length > 0) {

					//remove the expression statement corresponding to the commonjs export statement
					surrExpStmts.remove();
				}
			}

			// let surrExpStmts = jscodeshiftAPI(exportStatement).closest(jscodeshiftAPI.ExpressionStatement);
			// if(surrExpStmts.length > 0) {

			// 	//remove the expression statement corresponding to the commonjs export statement
			// 	surrExpStmts.remove();
			// }

		}

		//case: exported function is referenced outside member expressions
		//and exported function assigned to the export object
		//export its properties as well
		renameExportObjectReferencesToExportedFeatReferences(jscodeshiftAPI, astRootCollection, exportedElement, functionName);

		return resultObject;
	}
	
	//case: the function that needs to become exported is defined through a function expression
	//syntax: <leftOperand> = function [<functionIdentifier>]([paramIdentifierArray]) {...},
	//where <leftOperand> may be a variable declarator, identifier, exports.<identifier>, module.exports, an assignment (update)

	//precondition: the top-level scope functions of each module must be unique (prevent function overwriting)
	//retrieve user comments regarding function definition represented by functionExpression
	//if the specific node does not contain comments, maybe his parent AST node contains comments
	//(retrieve these comments)

	let functionExpression = functionDefinition;

	// console.log(functionExpression);

	//don't search the whole AST again (find the assignment surrounding functionDefinition)
	let surrStmtCollection = jscodeshiftAPI(functionDefinition).closest(jscodeshiftAPI.Statement);
	if(surrStmtCollection.length === 0) {

		return resultObject;
	}

	//1-1 mapping between a node and its location
	// let exportedNode;
	surrStmtCollection.replaceWith(path => {

		if(isNestedInBlockStatement === true) {

			//export statement nested in block statement - do not introduce a variable declaration
			//before export, but replace export object ref with a ref to the exported function
			// path.value.expression.left = jscodeshiftAPI.identifier('exportedObject');

			//construct the ES6 export statement to be introduced
			let variableDeclaratorCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclarator).filter(path => {

				// return path.value.id.name === 'exportedObject';
				return path.value.id.name === functionName;
			});

			//a variable named exportedObject is already introduced in the AST (along with the respective ES6 export statement)
			if(variableDeclaratorCollection.length > 0) {

				return path.value;
			}

			//create identifier variableName
			// var variableIdentifier = jscodeshiftAPI.identifier('exportedObject');
			let variableIdentifier = jscodeshiftAPI.identifier(functionName);

			let exportAliasIdentifier = jscodeshiftAPI.identifier(exportAlias);
			// var exportAliasIdentifier = jscodeshiftAPI.identifier(elementAlias);
					
			//create variable declarator for variableName (syntax: <variableIdentifier>;)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);

			//create variable declaration for variableName (syntax: var <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variable declaration at the end of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);

			// let exportSpecifier = jscodeshiftAPI.exportSpecifier('exportedObject', null);
			let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportAliasIdentifier);
			let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

			//insert ES6 export statement at the end of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);

			//after adding the export statement, 
			//replace export object ref with the exported function ref
			path.value.expression.left = jscodeshiftAPI.identifier(functionName);
			return path.value;
		}
						
		if(functionName !== 'mod_anonymus' && functionExportedViaModuleExports === false) {

			//case: function is not an anonymus function (syntax: function([<args]) {...})
			//update: + function is exported via its assignment to a property of exports
			//A new variable named functionName is created. 
			//This variable will be assigned the function that is going to become exported.

			//update: what if function is exported (and used) with an alias?

			// console.log(path.value.left);

			let aliasName = path.value.expression.left.property.name;
			let variableName = aliasName == undefined ?
								functionName :
								aliasName;
						
			//create identifier variableName
			let variableIdentifier = jscodeshiftAPI.identifier(variableName);
							
			//create variable declarator for variableName 
			//(syntax: <variableIdentifier> = <functionNode>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionExpression.value);
							
			//print statement modelled by the variable declarator AST node 
			//(mainly for debugging)
			//console.log(jscodeshiftAPI(variableDeclarator).toSource());
							
			//create variable declaration for variableName 
			//(syntax: var <variableIdentifier> = <functionNode>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variable declaration right before the expression statement representing the function's definition
			//(prevent bugs due to undefined - the initial definition (assignment) is replaced through the export statement)
			jscodeshiftAPI(path).insertBefore(variableDeclaration);
							
			// console.log(jscodeshiftAPI(variableDeclaration).toSource());
						
			if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, exportAlias) === false) {

				let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, jscodeshiftAPI.identifier(exportAlias));
							
				//create a node representing the export of the newly created variable
				//and insert it at the end of the AST
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
				exportedNode.comments = comments;
				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
			}
			
			return path.value;
		}
		
		if(functionName === 'mod_anonymus') {

			//anonymus function expression
			
			//create identifier variableName
			// var variableIdentifier = jscodeshiftAPI.identifier('exportedObject');
			let variableIdentifier = jscodeshiftAPI.identifier(functionName);
							
			//create variable declarator for variableName 
			//(syntax: <variableIdentifier> = <functionNode>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionExpression.value);
							
			//print statement represented by the variable declarator AST node (mainly for debugging)
			//console.log(jscodeshiftAPI(variableDeclarator).toSource());
							
			//create variable declaration for variableName (syntax: var <variableIdentifier> = <functionNode>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
							
			// console.log(jscodeshiftAPI(variableDeclaration).toSource());

			//insert variable declaration right before the expression statement representing the function's definition
			//(prevent bugs due to undefined - the initial definition (assignment) is replaced through the export statement)
			jscodeshiftAPI(path).insertBefore(variableDeclaration);

			if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, exportAlias) === false) {

				let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, jscodeshiftAPI.identifier(exportAlias));
							
				//create a node representing the export of the newly created variable
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
				exportedNode.comments = comments;
				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
			}
						
			//(function expressions are not hoisted, they only can be used after their declarations)
			// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);
			// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);

		}
		else {

			//non-anonymus function that is assigned to module.exports
			//assign function to variable and export variable (simulate behaviour of CommonJS)
			// let functionIdentifier = jscodeshiftAPI.identifier(functionName);
			let variableIdentifier = jscodeshiftAPI.identifier(functionName);
			// let functionIdentifier = jscodeshiftAPI.identifier(elementAlias);
			let functionIdentifier = jscodeshiftAPI.identifier(exportAlias);

			//create variable declarator (syntax: <exported_<functionName>> = <functionName>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, functionIdentifier);
								
			//create variable declaration (syntax: let <variableIdentifier> = <callExpression>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variable declaration right before the expression statement representing the function's definition
			//(prevent bugs due to undefined - the initial definition (assignment) is replaced through the export statement)
			jscodeshiftAPI(path).insertBefore(variableDeclaration);

			//create an ES6 named export statement of the form export {<new_variable> as <export_alias_identifier>}
			//and add it right at the end of the AST
			if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, functionName) === false) {

				let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
				exportedNode.comments = comments;
				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
			}

			//convert assignment to module.exports/exports into a variable definition for the function
			let functionDefinitionDeclarator = jscodeshiftAPI.variableDeclarator(functionIdentifier, functionExpression.value);
			let functionDefinition = jscodeshiftAPI.variableDeclaration("var", [functionDefinitionDeclarator]);
			return jscodeshiftAPI(path.parentPath).replaceWith(functionDefinition);
			// return functionDefinition;
			// return path.value;

		}

		//at each case (except nested exports, export statements are already added)
		return path.value;

	});

	//what if exportedNode is included in an assingment? (keep only right operand of that assignment)
	astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		right:
			exportedNode
	}).replaceWith(path => {

		// console.log(path);

		return path.value.right;
	});

	//case: exported function is referenced outside member expressions
	//and exported function assigned to the export object
	//export its properties as well
	renameExportObjectReferencesToExportedFeatReferences(jscodeshiftAPI, astRootCollection, exportedElement, functionName);
	
	// console.log(astRootCollection.toSource());

	return resultObject;
}

/**
 * Is elementName already exported? Used to prevent bugs due to export duplicates.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} elementName 
 */
function isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, elementName) {

	let namedExports = astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration);

	//module does not contain ES6 exports - elementName not exported
	if(namedExports.length === 0) {

		return false;
	}

	//does module contain 1 export statement that references elementName with the same export name?
	let elementExports = namedExports.filter(namedExport => {

		let exportSpecifiers = namedExport.value.specifiers;
		return exportSpecifiers.some(exportSpec => {

			return exportSpec.exported.type === 'Identifier' &&
					exportSpec.exported.name === elementName;
		});
	});

	//element already exported in the case that it is referenced under the same export name
	//in at least 1 export
	return elementExports.length > 0;
}

/**
 * Helper function. Determines if the function specified in exportNode is exported via exports/module.exports
 * (needed to resolve the type of the ES6 export that will be introduced in the module).
 */
function isFunctionExportedViaModuleExports(exportNode) {

	//a function can be exported if it is assigned either to a property of exports
	//or to module.exports (in the latter case, the function may be directly used when imported 
	//[without an explicit reference to the imported element])

	var leftOperand = exportNode.value.expression.left;
	var accessedObjectName;
	var accessedPropertyName;

	if(leftOperand.type === 'MemberExpression') {

		accessedObjectName = leftOperand.object.name;
		accessedPropertyName = leftOperand.property.name;

		if(accessedObjectName === 'module' && accessedPropertyName === 'exports') {

			//function specified in exportNode is exported through its assignment to module.exports
			return true;
		}
	}

	//function specified in exportNode is not exported through its assignment to module.exports
	return false;
}

/**
 * Helper function. Determines if the function specified in exportNode is exported through its assignment to a property of module.exports
 * (if yes, the module.exports is replaced with the name of the object that is exported through assignment to module.exports, if any)
 * (needed to resolve whether an ES6 export statement will be introduced or a replace will be performed)
 * @param {*} exportNode 
 */
function isFunctionAssignedToAPropertyOfExportsOrModuleExports(jscodeshiftAPI, astRootCollection, exportedElement) {
	
	let exportFuncNode = exportedElement.exportedFunctionNode;
	let exportFuncStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportFuncNode);

	if(exportFuncStmts.length === 0) {

		return false;
	}

	let exportNode = exportFuncStmts.at(0).get().value;
	let leftOperand = exportNode.expression.left;
	let accessedObject;
	let accessedProperty;
	let assignmentCollection;
	let assignment;
	let exportedObjectName;

	let isLeftOperandAModuleExportsMemberExpression = false;

	if(exportedElement.isExportedObjectDefinedThroughAssignmentToExports === false) {

		return false;
	}

	//functions bound to the module's exported object are exported
	//through the replacement of exports/module.exports with the name of the exported object
	//(applied only in the case that an object is explicitly assigned to exports/module.exports)
	while(leftOperand.type === 'MemberExpression') {

		accessedObject = leftOperand.object;
		accessedProperty = leftOperand.property;
		if((accessedObject.type === 'Identifier' && accessedObject.name === 'module' && accessedProperty.type === 'Identifier' && accessedProperty.name === 'exports') ||
		   accessedObject.type === 'Identifier' && accessedObject.name === 'exports') {

			//function is assigned to a property of module.exports or exports
			//syntax: module.exports.<property> = <element> || exports.<property> = <element>
			//find the name of the element that is exported through assignment to module.exports/exports
			//replace module.exports/exports (leftOperand) with the name of the object assigned to module.exports/exports
			assignmentCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression).filter(path => {

				let leftOperand = path.value.left;

				if(leftOperand.type === 'MemberExpression') {

					if(leftOperand.object.type === 'Identifier' && leftOperand.object.name === 'module' &&
					   leftOperand.property.type === 'Identifier' && leftOperand.property.name === 'exports') {

						//return the assignment expressions representing assignments to module.exports (1 assignment/module)
						isLeftOperandAModuleExportsMemberExpression = true;
						return true;
					}
				}
				else if(leftOperand.type === 'Identifier' && leftOperand.name === 'exports') {

					//return the assignment expressions representing assignments to exports
					return true;
				}

				return false;
			});

			if(assignmentCollection.length > 0) {

				//retrieve the name of the element that is assigned to module.exports (or is exported through an ES6 default export,
				//if the module.exports assignment is refactored)
				assignment = assignmentCollection.at(0).get();
				if(assignment.value.right.type === 'Identifier') {

					exportedObjectName = assignment.value.right.name;
				}
				else {

					// exportedObjectName = 'exportedObject';
					exportedObjectName = functionName;
				}
			}
			else {

				//case: function's transform follows the transform of the object assigned to module.exports
				//(assignment to module.exports does not exist, since an ES6 default export is introduced)
				//search for the export default statement (1 per module)
				astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).forEach(function(path) {

					let specifiers = path.value.specifiers;
					if(specifiers.length === 0) {

						return;
					}

					exportedObjectName = specifiers[0].exported.name;
				});
			}

			if(exportedObjectName === undefined) {

				return false;
			}

			// replace module.exports with the name of the exported object
			astRootCollection.find(jscodeshiftAPI.MemberExpression, leftOperand).replaceWith(path => {

				// console.log(exportedObjectName);
				// console.log(isLeftOperandAModuleExportsMemberExpression);
				if(accessedObject.name === 'module' && accessedProperty.name === 'exports') {

					return jscodeshiftAPI.identifier(exportedObjectName);
				}
				
				path.value.object.name = exportedObjectName;
				return path.value;
			});

			return true;
		}

		leftOperand = leftOperand.object;
	}

	return false;
}

/**
 * Helper function. Determines if the export statement is nested inside a block statement.
 * @param {*} exportStmtNode the AST node specifying the export statement for a function 
 */
function isExportStatementNestedInBlockStatement(jscodeshiftAPI, astRootCollection, exportStmtNode) {

	let surrBlockStmts = jscodeshiftAPI(exportStmtNode).closest(jscodeshiftAPI.BlockStatement);
	if(surrBlockStmts.length > 0) {

		return true;
	}

	return false;

	// // let exportNodeLoc = exportNode.loc;
	// // var exportNodeStartLine = exportNodeLoc.start.line;
	// // var exportNodeStartColumn = exportNodeLoc.start.column;
	// // var exportNodeEndLine = exportNodeLoc.end.line;
	// // var exportNodeEndColumn = exportNodeLoc.end.column;

	// //what if the export statement is contained in a block statement?
	// //(transform only export statements in the top-level scope of module
	// //ES6 imports/exports are only allowed in the module's top-level scope)
	// let exportStatementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportStmtNode);

	// if(exportStatementCollection.length === 0) {

	// 	return;
	// }

	// for(let statementIndex = 0; statementIndex < exportStatementCollection.length; statementIndex++) {

	// 	let exportStatement = exportStatementCollection.at(statementIndex).get();
	// 	let surrBlockStmts = jscodeshiftAPI(exportStatement).closest(jscodeshiftAPI.BlockStatement);
	// 	if(surrBlockStmts.length > 0) {

	// 		return true;
	// 	}

	// }

	// return false;

	// var exportStatementCollection = astRootCollection.find(jscodeshiftAPI[exportNode.type], {
	// 	loc: { 
	// 				start: { line: exportNodeStartLine, column: exportNodeStartColumn },
	// 				end: { line: exportNodeEndLine, column: exportNodeEndColumn }
	// 	}
	// });

	// for(let statementIndex = 0; statementIndex < exportStatementCollection.length; statementIndex++) {

	// 	let exportStatement = exportStatementCollection.at(statementIndex).get();
	// 	let parentNode = exportStatement.parentPath;

	// 	while(parentNode !== null) {

	// 		if(parentNode.value.type === 'BlockStatement') {

	// 			//export statement nested inside block statement
	// 			return true;
	// 		}
	// 		parentNode = parentNode.parentPath;
	// 	}

	// 	return false;
	// }
}

/**
 * Destructures function object specified in exportedElement to its properties 
 * (and exports the properties instead of the function object itself)
 */
function destructureFunctionObject(jscodeshiftAPI, astRootCollection, exportedElement, filePath) {

	//function names are changed during analysis
	let functionName = exportedElement.functionName;

	//the exported element's alias (its actual name)
	let elementAlias = exportedElement.elementAlias;

	//node type/location
	let functionNode = exportedElement.functionNode;

	//node type/location
	let exportStatementNode = exportedElement.exportedFunctionNode;

	//function contains function properties (bound to the function object)
	//function is likely to play the role of a namespace
	let functionProperties = exportedElement.functionProperties;

	//function definition type (FunctionDeclaration/FunctionExpression)
	let functionDefinitionType = functionNode.type;

	//explicit usages of exportedElement (function invokations)
	//object destructuring does not impact the function's visibility extension,
	//in the case that the function is invoked in other modules
	let exportedElementUsages = exportedElement.elementUsages;

	//export specifiers for properties (for the named export that will be introduced in the AST)
	let exportSpecifiers = [];

	let exportedProperties = 0;

	//(1) convert each function object property to a variable initialized with its value
	functionProperties.forEach(functionProperty => {

		//the property's mapped variable name and alias are resolved during analysis
		//(prevent name collisions)
		//each property is mapped to a variable and exported with its initial name as an alias
		let propertyName = functionProperty.propertyName;
		let propertyAlias = functionProperty.propertyAlias;

		//node/type
		let propertyDefinitionStatement = functionProperty.propertyDefinitionNode;

		// let propertyReferences = functionProperty.propertyReferences ? functionProperty.propertyReferences : [];
		// let propertyInitializationValue = functionProperty.propertyType;

		//replace the statement's parent (ExpressionStatement) with a variable definition
		//with the same value
		// let exportAliasIdentifier = propertyAlias;
		let exportAliasIdentifier = jscodeshiftAPI.identifier(propertyAlias);

		// let exportAliasIdentifier = jscodeshiftAPI.identifier(propertyName);
		// let variableName = filePath + '_' + propertyName;
		let variableName = propertyName;
		let variableIdentifier = jscodeshiftAPI.identifier(variableName);

		//what if property is initialized inside a method/function? insert the respective variable after the import statements (at the module's scope)
		let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
		// let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableName, rightOperand);

		// console.log(jscodeshiftAPI(variableDeclarator).toSource());
						
		//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
		let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

		let es6ImportStatements = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);
		if(es6ImportStatements.length > 0) {

			//ES6 import statements exist - add variable definition after the last ES6 import
			jscodeshiftAPI(es6ImportStatements.at(-1).get()).insertAfter(variableDeclaration);
		}
		else {

			//ES6 import statements do not exist - add it at the top of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);
		}

		//replace propertyDefinitionStatement with an assignment
		let statementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyDefinitionStatement);

		// let statementCollection = astRootCollection.find(jscodeshiftAPI[propertyDefinitionStatement.type]).filter(node => {

		// 	if(node.value.loc == null) {

		// 		return false;
		// 	}
		// 	return node.value.loc.start.line === propertyDefinitionStatement.loc.start.line && node.value.loc.start.column === propertyDefinitionStatement.loc.start.column &&
		// 	node.value.loc.end.line === propertyDefinitionStatement.loc.end.line && node.value.loc.end.column === propertyDefinitionStatement.loc.end.column;
		// });

		// console.log(statementCollection.length)
		if(statementCollection.length === 0) {

			//no statements found - abort
			return;
		}

		// console.log(statementCollection.length);

		let propertyStatement = statementCollection.at(0).get();
		let rightOperand = propertyStatement.value.right;
		while(rightOperand.type === 'AssignmentExpression') {

			rightOperand = rightOperand.right;
		}

		// console.log(jscodeshiftAPI(variableIdentifier).toSource());

		//create assignment (syntax: <propertyName> = <initial_property_value>)
		//assign a deep clone of rightOperand in the new variable
		//(in case that renamings with respect to properties converted into variables are performed,
		//the renamings need to be performed in the introduced code, the initial is left intact)
		//create variable declarator (syntax: <propertyName> = <initial_property_value>)
		// let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
								
		// //create variable declaration (syntax: var <propertyName> = <initial_property_value>)
		// let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
		
		//insert variableDeclaration at the top of the AST
		// astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);

		let expressionStatement = statementCollection.at(0).get();

		//replace property references inside definition with variable references
		//names have been changed to prevent name collisions (search refs by the property's export alias (its actual name))
		let propertyRefs = jscodeshiftAPI(expressionStatement).find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

			// return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === functionName &&
			// 		mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyName;

			return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === elementAlias &&
					mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyAlias;
		});

		//property defined through a member expression of the module object (function)
		if(propertyRefs.length > 0) {

			propertyRefs.replaceWith(variableIdentifier);
		}
		else {

			//property not defined through the function
			//property defined through the module object
			let variableAssignment = jscodeshiftAPI.assignmentExpression('=', variableIdentifier, deepClone(rightOperand));
			let variableAssignmentExpressionStatement = jscodeshiftAPI.expressionStatement(variableAssignment);

			let expressionStatement = statementCollection.at(0).get();

			jscodeshiftAPI(expressionStatement).replaceWith(variableAssignmentExpressionStatement);
		}

		

		// if(propertyRefs.length === 0) {

		// 	return;
		// }

		// propertyRefs.replaceWith(variableIdentifier);

		

		if(functionProperty.isExported === true) {

			//(3) create export specifier for each property (in the case that the property is actually used in other modules)
			// let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);

			// console.log(jscodeshiftAPI(exportSpecifier).toSource());

			//export variable with the property's name (as-is), 
			//import it under a different alias
			let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportAliasIdentifier);
			exportSpecifiers.push(exportSpecifier);
			exportedProperties++;
		}

		// console.log(astRootCollection.toSource());
	});

	//(2) after each property is mapped to a variable with the same initialization value in the AST (through its introduction)
	//replace each property's reference (within the introduced variable definitions) with a reference of the new variable
	functionProperties.forEach(functionProperty => {

		let propertyName = functionProperty.propertyName;
		let propertyAlias = functionProperty.propertyAlias;
		// let propertyDefinitionStatement = functionProperty.propertyDefinitionNode;
		let propertyReferences = functionProperty.functionPropertyUsages ? functionProperty.functionPropertyUsages : [];
		// let propertyInitializationValue = functionProperty.propertyType;

		// let variableName = filePath + '_' + propertyName;
		let variableName = propertyName;
		let variableIdentifier = jscodeshiftAPI.identifier(variableName);

		//(2) replace each property reference with a reference to the variable
		//do not replace property references within the initialization values of the initial function object's properties
		// console.log(propertyName)
		// console.log(propertyReferences.length)
		propertyReferences.forEach(propertyReference => {

			let propertyReferenceCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyReference)

			// let propertyReferenceCollection = astRootCollection.find(jscodeshiftAPI[propertyReference.type]).filter(node => {

			// 	let isPropertyReferenceLocatedWithinObjectPropertyInitialValue = false;
			// 	let parentNode = node.parentPath;

			// 	if(node.value.type !== 'MemberExpression' || node.value.property.type !== 'Identifier' || node.value.property.name !== propertyName) {

			// 		return false;
			// 	}

			// 	let isPropertyReference = (node.value.loc.start.line === propertyReference.loc.start.line && node.value.loc.start.column === propertyReference.loc.start.column &&
			// 			node.value.loc.end.line === propertyReference.loc.end.line && node.value.loc.end.column === propertyReference.loc.end.column);

			// 	// console.log(node.value.loc);
			// 	// console.log(isPropertyReference);
			// 	// if(isPropertyReference === false) {

			// 	// 	return false;
			// 	// }

			// 	//retrieved specific property reference
			// 	//is it located within another property's initialization value?
			// 	// while(parentNode.value.type !== 'Program') {

			// 	// 	if(parentNode.value.type === 'AssignmentExpression' && parentNode.value.left.type === 'MemberExpression' &&
			// 	// 		parentNode.value.left.object.type === 'Identifier' && parentNode.value.left.object.name === functionName) {

			// 	// 		isPropertyReferenceLocatedWithinObjectPropertyInitialValue = true;
			// 	// 		break;
			// 	// 	}

			// 	// 	parentNode = parentNode.parentPath;
			// 	// }

			// 	// console.log(isPropertyReferenceLocatedWithinObjectPropertyInitialValue);
			// 	// console.log(node.value.loc);
			// 	// console.log(parentNode.value.type);

			// 	// return isPropertyReferenceLocatedWithinObjectPropertyInitialValue === false;

			// 	//the initial property definitions are replaced with the new variable definitions
			// 	//(prevent problems during renamings)
			// 	//no need to resolve whether reference is located within the initial property's definition
			// 	return isPropertyReference;
			// });

			if(propertyReferenceCollection.length === 0) {

				//no property usages found - abort
				return;
			}

			propertyReferenceCollection.replaceWith(node => {

				return variableIdentifier;
			});
		});

	});

	//(3) export non-cohesive function object as-is, in the case that
	//its referenced outside member expressions
	//or it's used, apart from its statically known properties
	if(exportedElement.isFunctionConstructor === false ||
		exportedElement.usedBesidesProperties === true) {

		//non-cohesive function used outside member expression
		//export it along with its properties (if exist)
		// let functionIdentifier = jscodeshiftAPI.identifier(functionName);

		let functionIdentifier = jscodeshiftAPI.identifier(elementAlias);
		let elementAliasIdentifier = jscodeshiftAPI.identifier(elementAlias);
		// let exportSpecifier = jscodeshiftAPI.exportSpecifier(functionIdentifier, functionIdentifier);

		let exportSpecifier = jscodeshiftAPI.exportSpecifier(functionIdentifier, elementAliasIdentifier);

		exportSpecifiers.push(exportSpecifier);
	}

	console.log(exportSpecifiers.length);
	if(exportSpecifiers.length > 0) {

		//(2) export function object properties, instead of the object itself
		//(syntax: export {<property1>, <property2>, ...})
		let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);

		// console.log(jscodeshiftAPI(exportStatement).toSource());

		//insert ES6 export at the end of the AST
		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);

		// console.log(astRootCollection.find(jscodeshiftAPI.Program).get('body').value[1]);
	}
	
	return exportedProperties;
}

/**
 * Renames export object references to references of the exported feature
 * (needed for exported features that are not destructured and have properties,
 * for their properties to be exported along with them).
 */
function renameExportObjectReferencesToExportedFeatReferences(jscodeshiftAPI, astRootCollection, exportedElement, functionName) {

	if(exportedElement.isExportedObjectDefinedThroughAssignmentToExports === true) {

		// functionName = functionName === 'anonymus' ? 'exportedObject' : functionName;
		// functionName = filePath + '_' + functionName;
		let functionIdentifier = jscodeshiftAPI.identifier(functionName);

		//replace all other references to the export object with references to the function
		//find references to exports
		let exportObjectRefs = astRootCollection.find(jscodeshiftAPI.Identifier).filter(identifier => {

			return identifier.value.name === 'exports' && 
				   identifier.parentPath.value.type === 'MemberExpression' && 
				   identifier.parentPath.value.object === identifier.value;
		});

		if(exportObjectRefs.length > 0) {

			exportObjectRefs.replaceWith(exportObjectRef => {

				return functionIdentifier;
			})
		}

		//find references to module.exports
		exportObjectRefs = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(memberExpression => {

			return memberExpression.value.object.type === 'Identifier' && memberExpression.value.object.name === 'module' &&
					memberExpression.value.property.type === 'Identifier' && memberExpression.value.property.name === 'exports';
		});

		if(exportObjectRefs.length > 0) {

			exportObjectRefs.replaceWith(exportObjectRef => {

				return functionIdentifier;
			})
		}
	}
}

/**
 * Maps an object specifying a statement to the actual statement.
 * @param stmtObj the object specifying the statement
 */
function searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, stmtObj) {

	//stmtObj an object with the statement's type and location
	//(compliance with jscodeshift: also actual AST nodes can be searched
	//using the same function)
    let stmtType = stmtObj.type;
    let stmtLoc = stmtObj.loc;

    //search the statement in the AST
    return astRootCollection.find(jscodeshiftAPI[stmtType]).filter(resStmt => {

        if(resStmt.value.loc == null) {

            return false;
        }

        let resStmtLoc = resStmt.value.loc;
        return resStmtLoc.start.line === stmtLoc.start.line &&
                resStmtLoc.start.column === stmtLoc.start.column &&
                resStmtLoc.end.line === stmtLoc.end.line &&
                resStmtLoc.end.column === stmtLoc.end.column;
    });
}