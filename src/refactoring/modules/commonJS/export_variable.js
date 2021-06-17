/**
 * Author: Nefeli Sylvia Charalambous
 * Date: 1/10/2017
 * 
 * Tranform code with jscodeshift
 * Export a Variable (defined in the top-level scope of the module represented by astRootCollection).
 * update export codemods with export statement: exports.<alias> = <exportedElement>;
 */

var path = require('path');
var deepClone = require('../../../../node_modules/lodash.clonedeep');

var exports = module.exports = {};

exports.description = "export_variable";

exports.refactoring = function (jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	// console.log(astRootCollection.toSource());
	// console.log("\n\n\n");

	let exportedElement = transformationInfo.exportedElement;

	let filePath = transformationInfo.filePath;

	//variable is exported from entryFile, regardless of its use in other modules
	let isEntryFile = transformationInfo.isEntryFile;
	filePath = path.basename(filePath, '.js').replace(/[^\w\s]/gi, '').replace(/-/g, '');

	// console.log(transformationInfo);
	// console.log(exportedElement);
	
	//variable that needs to be exported
	//(resolved at analysis to prevent name collisions)
	let variableName = exportedElement.variableName;

	//the variable that is actually exported (it is assigned the value of the variable assigned to the export object)
	// let mappedVariableName = filePath + '_' + variableName;
	// let mappedVariableName = variableName;
	let mappedVariableName = exportedElement.elementAlias;

	let resultObject = {

		isVariableInitializedWithAnObject: false,
		exportedProperties: 0
	};

	//search by the start and end of the definition of the variable, instead of its initialization value
	//case (bluebird): what if a variable is declared, but not initialized?
	let isInitializedWithRequireResult = isVariableAssignedTheValueOfRequireInvocation(exportedElement, jscodeshiftAPI, astRootCollection);

	//destructuring NOT triggered in the following cases:
	//(a) the object is included in a namespace that is modified somewhere in the system
	//(b) the object is imported and reexported in other modules (not destructured regardless of its cohesion, since the client modules of its definition module's client modules may use its properties indirectly (transitively))
	//(c) the object is initialized with an imported definition
	//(d) the object is referenced outside member expressions or referenced through bracket notation
	//(e) the object does not have any properties bound to it, regardless of its cohesion
	//(f) the object is imported in nested scopes
	if(exportedElement.includedInModifiedNamespace === false && 
	   exportedElement.isImportedAndReexported === false && 
	   isInitializedWithRequireResult === false &&
	   exportedElement.isObjectReferenced === false && 
	   exportedElement.isAccessedDynamically === false &&
	   exportedElement.isNested === false &&
	   exportedElement.objectProperties.length > 0) {

		resultObject.isVariableInitializedWithAnObject = true;

		//variable that needs to be exported is initialized with an object literal
		//destructure variable to its properties (export properties instead of the variable itself)
		// resultObject.isVariableInitializedWithAnObject = true;
		resultObject.exportedProperties = destructureObject(jscodeshiftAPI, astRootCollection, exportedElement, filePath, isEntryFile);

		modifyVariableExportNode(jscodeshiftAPI, astRootCollection, exportedElement);

		return resultObject;

	}

	//definition not decomposed
	//variable's export statement in nested scopes (e.g. export upon condition)
	// var isNestedInBlockStatement = isExportStatementNestedInBlockStatement(jscodeshiftAPI, astRootCollection, exportNode);

	//introduce a variable definition right before the export statement
	let variableIdentifier = jscodeshiftAPI.identifier(variableName);
	let exportVariableIdentifier = jscodeshiftAPI.identifier(mappedVariableName);
	mapExportedDefinitionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, exportVariableIdentifier);

	//find alias of exported definition
	// if(isInitializedWithRequireResult === true) {

	// 	//variable is initialized with the return value of require()
	// 	//it is imported under an alias depending on its definition module and its name, in order to prevent name collisions
	// 	variableInitializedWithRequireCallResult = true;
	// 	// console.log(initializationNode.arguments[0]);
	// 	let definitionModuleName = (initializationNode.arguments[0].type === 'Literal' ? initializationNode.arguments[0].value : null);
	// 	let definitionModulePath = path.resolve(definitionModuleName);

	// 	//find the name of the imported definition (imports have been processed before exports)
	// 	let es6Imports = astRootCollection.find(jscodeshiftAPI.ImportDeclaration).filter(importDec => {

	// 		return importDec.value.source.type === 'Literal' && importDec.value.source.value === definitionModuleName;
	// 	});

	// 	let exportDefName;
	// 	if(es6Imports.length === 0) {

	// 		exportDefName = variableName;
	// 		exportedElementName = (path.basename(definitionModulePath, '.js') + '_' + variableName).replace(/[^a-zA-Z0-9_ ]/g, '');
	// 		exportedElementName = exportedElementName + 'js';
	// 	}
	// 	else {

	// 		let importDec = es6Imports.at(0).get();
	// 		let importSpecifiers = importDec.value.specifiers;
	// 		if(importSpecifiers.length === 0) {

	// 			exportDefName = variableName;
	// 			exportedElementName = (path.basename(definitionModulePath, '.js') + '_' + variableName).replace(/[^a-zA-Z0-9_ ]/g, '');
	// 			exportedElementName = exportedElementName + 'js';
	// 		}
	// 		else {

	// 			exportDefName = importSpecifiers[0].local.name;
	// 			exportedElementName = exportDefName;
	// 		}
			
	// 	}

	// 	// console.log(definitionModulePath);
	// 	// exportedElementName = path.basename(definitionModulePath, '.js').replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + variableName.replace(/[^a-zA-Z0-9_ ]/g, '');
	// 	// console.log(exportedElementName);
	// 	// exportedElementName = exportedElementName + 'js';
	// 	exportAlias = variableName;
	// }
	// else {

	// 	exportedElementName = mappedVariableName;
	// 	exportAlias = variableName;
	// }

	//create an ES6 named export statement of the form export {<new_variable> as <variable>}
	//and add it right at the end of the AST
	// let exportSpecifier = jscodeshiftAPI.exportSpecifier(exportVariableIdentifier, variableIdentifier);
	let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportVariableIdentifier);
	let exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

	//introduce ES6 export only in the case that it does not exist
	let es6Exports = astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).filter(expStmt => {

		return expStmt.value === exportedNode;
	});

	//ES6 export already exists, do not proceed
	//(ES6 spec does not allow duplicate imports/exports)
	if(es6Exports.length > 0) {

		return resultObject;
	}

	//ES6 export does not exist, add it in the bottom of the AST
	astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
	
	// console.log(astRootCollection.toSource());
	return resultObject;
}

/**
 * Maps exportedElement to the variable being exported.
 * Introduces a variable definition right before its export statement.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function mapExportedDefinitionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, exportedVarIdentifier) {

	let variableName = exportedElement.variableName;
	let variableExpNode = exportedElement.exportedVariableNode;

	//the variable's (modified) name
	let initialVariableIdentifier = jscodeshiftAPI.identifier(variableName);
	
	if(variableExpNode === null) {

		return;
	}

	//retrieve Statement (VariableDeclaration, AssignmentExpression etc...)
	//containing the definition's export statement
	//variable: a value assigned to the export object (no references to properties bound to the export object exist)
	let defExpStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableExpNode);

	// let defExpStmts = astRootCollection.find(jscodeshiftAPI[variableExpNode.type]).filter(expNode => {

	// 	if(expNode.value.loc == null) {

	// 		return false;
	// 	}

	// 	let expNodeLoc = expNode.value.loc;
	// 	return expNodeLoc.start.line === varExpNodeLoc.start.line && expNodeLoc.start.column === varExpNodeLoc.start.column &&
	// 			expNodeLoc.end.line === varExpNodeLoc.end.line && expNodeLoc.end.column === varExpNodeLoc.end.column;
	// });

	//the variable's export statement may be modified
	//assign the initial variable's value to variable
	if(defExpStmts.length === 0) {

		// let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
		// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
		return;
	}

	//assign the value of the exported variable in a new variable (the mapped variable)
	//and export the introduced variable instead (CommonJS exports the value of the variable, 
	//not the variable itself: achieve 'disconnection' from the variable)
	//the newly introduced variable will have a name relevant to the property's name and the module's path

	//create variable declaration
	//the newly introduced variable's initialization value will be the value of the variable that is exported in the CommonJS module
	// let variableIdentifier = exportedVarIdentifier;
	let variableIdentifier = initialVariableIdentifier;
	
	//create variable declarator (syntax: <variableIdentifier> = <expDefinitionIdentifier>)
	let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
						
	//create variable declaration (syntax: var <variableIdentifier> = <expDefinitionIdentifier>)
	let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

	//(a) insert variableDeclaration right before the definition's export statement
	//(b) update each reference to the export object or property bound to export object
	//to a reference of the introduced variable
	//(c) map exported variable to the new variable
	defExpStmts.forEach(defExpStmt => {

		//(a)
		let defExpStmtAST = jscodeshiftAPI(defExpStmt);
		defExpStmtAST.insertBefore(variableDeclaration);

		//(b)
		let expObjRefs = defExpStmtAST.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

			return  mbExp.parentPath.value.type !== 'MemberExpression' &&
					mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'module' &&
					mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === 'exports';
		});

		if(expObjRefs.length > 0) {

			expObjRefs.forEach(expObjRef => {

				//export object reference located in an assignment located in an expression statement
				//syntax: module.exports = <value>
				if(expObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
	
					jscodeshiftAPI(expObjRef).replaceWith(variableIdentifier);
					return;
				}
	
				//export object located in an assignment
				//syntax: (1) <value> = module.exports = [assignment], (b) <value> = [assignment] = module.exports
				if(expObjRef.parentPath.value.type === 'AssignmentExpression') {
	
					//(1)
					if(expObjRef.parentPath.value.left === expObjRef.value) {
	
						jscodeshiftAPI(expObjRef.parentPath).replaceWith(expObjRef.parentPath.value.right);
						return;
						// return expObjRef.parentPath.value.right;
					}

					jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
					return;
				}

				//export object located in a variable definition
				if(expObjRef.parentPath.value.type === 'VariableDeclarator') {

					jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
				}
			});
		}

		expObjRefs = defExpStmtAST.find(jscodeshiftAPI.Identifier).filter(id => {

			return  id.parentPath.value.type !== 'MemberExpression' &&
					id.value.name === 'exports';
		});

		if(expObjRefs.length > 0) {

			expObjRefs.forEach(expObjRef => {

				//export object reference located in an assignment located in an expression statement
				//syntax: module.exports = <value>
				if(expObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
	
					return jscodeshiftAPI(expObjRef).replaceWith(variableIdentifier);
				}
	
				//export object located in an assignment
				//syntax: (a) module.exports = [assignment], (b) <value> = module.exports
				if(expObjRef.parentPath.value.type === 'AssignmentExpression') {
	
					//(1)
					if(expObjRef.parentPath.value.left === expObjRef.value) {
	
						jscodeshiftAPI(expObjRef.parentPath).replaceWith(expObjRef.parentPath.value.right);
						return;
					}

					jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
					return;
				}

				//export object located in a variable definition
				if(expObjRef.parentPath.value.type === 'VariableDeclarator') {

					jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
				}
			});
		}
	});

	//after the export statement's modification, 
	//check if the statement has a reference of the introduced variable
	//if not, assign the initial variable's value to the new variable (prevent bugs due to undefined)
	defExpStmts.forEach(defExpStmt => {

		let newVarRefs = jscodeshiftAPI(defExpStmt).find(jscodeshiftAPI.Identifier).filter(id => {

			return id.value.name === variableIdentifier.name;
		});

		if(newVarRefs.length === 0) {

			// let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
			let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', initialVariableIdentifier, exportedVarIdentifier);
			astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
		}
	});

	//(c) assign the value of the initial variable to the mapped variable
	//(convert the assignment into an expression statement and add the expression statement at the end of the AST)
	// if(exportedElement.isImportedAndReexported === false) {

	// 	let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
	// 	astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
	// }
	
}

/**
 * Modifies the exported definition's export statement
 * (it does not remove it, since it may be located within its definition).
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function modifyVariableExportNode(jscodeshiftAPI, astRootCollection, exportedElement) {

	//search by the start and end of the definition of the variable, instead of its initialization value
	//case (bluebird): what if a variable is declared, but not initialized?
	let variableName = exportedElement.variableName;
	let variableNode = exportedElement.variableDeclarationNode;
	let variableExportNode = exportedElement.exportedVariableNode;

	//remove exportNode from AST (commonJS export statement)
	//update: do not remove exportNode - in the case that variable definition is located within export statement,
	//the definition is gone as well
	//simply replace export object reference with an empty object
	let varDefLoc = variableNode.loc;
	let varExpLoc = variableExportNode.loc;

	// console.log(varDefLoc.start.line === varExpLoc.start.line && varDefLoc.start.column === varExpLoc.start.column &&
	// 	varDefLoc.end.line === varExpLoc.end.line && varDefLoc.end.column === varExpLoc.end.column);
		
	if(varDefLoc.start.line === varExpLoc.start.line && varDefLoc.start.column === varExpLoc.start.column &&
		varDefLoc.end.line === varExpLoc.end.line && varDefLoc.end.column === varExpLoc.end.column) {

		let exportNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableExportNode);

		// let exportNodeCollection = astRootCollection.find(jscodeshiftAPI[variableExportNode.type]).filter(path => {

		// 	if(path.value.loc === null) {

		// 		return false;
		// 	}

		// 	let pathLoc = path.value.loc;
		// 	return pathLoc.start.line === varExpLoc.start.line && pathLoc.start.column === varExpLoc.start.column &&
		// 			pathLoc.end.line === varExpLoc.end.line && pathLoc.end.column === varExpLoc.end.column;
		// });

		if(exportNodeCollection.length === 0) {

			return;
		}

		let objectExpression = jscodeshiftAPI.objectExpression([]);

		// let exportObjectIdentifier = jscodeshiftAPI.identifier('exportObject');
		let exportObjectIdentifier = jscodeshiftAPI.identifier(variableName);

		//do not introduced parenthesized expression (problems with babel)
		//created a hardcoded variable modelling the exported object
		//create variable declarator (syntax: <propertyName> = <initial_property_value>)
		let variableDeclarator = jscodeshiftAPI.variableDeclarator(exportObjectIdentifier, objectExpression);
								
		//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
		let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

		// let expVarNodeAST = jscodeshiftAPI(exportedElement.exportedVariableNode);
		let expVarNodeAST = jscodeshiftAPI(exportNodeCollection.at(0).get());
		let exportObjectRefs = expVarNodeAST.find(jscodeshiftAPI.MemberExpression).filter(mb => {

			return mb.parentPath.value.type !== 'MemberExpression' &&
					mb.value.object.type === 'Identifier' && mb.value.object.name === 'module' &&
					mb.value.property.type === 'Identifier' && mb.value.property.name === 'exports';
		});

		// console.log(exportObjectRefs.length);

		if(exportObjectRefs.length > 0) {

			exportObjectRefs.replaceWith(exportObjectIdentifier);
		}

		exportObjectRefs = expVarNodeAST.find(jscodeshiftAPI.Identifier).filter(objRef => {

			return objRef.parentPath.value.type !== 'MemberExpression' &&
					objRef.value.name === 'exports';
		});

		// console.log(exportObjectRefs.length);

		if(exportObjectRefs.length > 0) {

			exportObjectRefs.replaceWith(exportObjectIdentifier);
		}

		// console.log(jscodeshiftAPI(exportObjectIdentifier).toSource());
		// console.log(astRootCollection.toSource());

		//insert variableDeclaration at the top of the AST
		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);

		return;
	}

	//export statement not located within exportedElement's definition (remove it)
	//update: remove it in the case that the export object is not used, but its properties is used
	astRootCollection.find(jscodeshiftAPI[variableExportNode.type], exportedElement.exportedVariableNode).remove();
}

/**
 * Helper function. Determines if the variable specified in exportNode is exported through its assignment to a property of module.exports
 * (if yes, module.exports is replaced with the name of the object that is exported through assignment to module.exports)
 * (needed to resolve whether an ES6 export statement will be introduced or a replace will be performed)
 * @param {*} exportNode 
 */
function isVariableExportedViaModuleExportsOrExports(jscodeshiftAPI, astRootCollection, exportNode) {
	
	var leftOperand = exportNode.left;
	var rightOperand = exportNode.right;
	var accessedObject;
	var accessedProperty;

	var assignmentCollection;
	var assignment;
	var exportedObjectName;
	var accessedObject;
	var accessedProperty;

	var isLeftOperandAModuleExportsMemberExpression = false;
	var memberExpressions;
	var memberExpression;

	if(leftOperand.type === 'MemberExpression') {

		//assignments to module.exports are not transformed in this case
		//(this case transforms assignments to module.exports properties)

		// replace module.exports with the name of the exported object
		memberExpressions = astRootCollection.find(jscodeshiftAPI.MemberExpression, leftOperand);

		if(memberExpressions.length > 0) {

			memberExpression = memberExpressions.at(0).get();
			if(memberExpression.value.object.name === 'module' && memberExpression.value.property.name === 'exports' &&
			   memberExpression.parentPath.value.type !== 'MemberExpression') {

				return false;
			}
		}
	}

	while(leftOperand.type === 'MemberExpression') {

		accessedObject = leftOperand.object;
		accessedProperty = leftOperand.property;
		// console.log(accessedObject);
		// console.log(accessedProperty);
		if((accessedObject.name === 'module' && accessedProperty.name === 'exports') ||
		   accessedObject.name === 'exports') {

			//function is assigned to a property of module.exports or exports
			//syntax: module.exports.<property> = <element>
			//exports.<property> = <element>
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

			//retrieve the name of the element that is assigned to module.exports (or is exported through an ES6 default export,
			//if the module.exports assignment is refactored)
			if(assignmentCollection.length > 0) {

				assignment = assignmentCollection.at(0).get();
				if(assignment.value.right.type === 'Identifier') {

					exportedObjectName = assignment.value.right.name;
				}
				else {

					exportedObjectName = 'exportedObject';
				}
			}
			else {

				//case: function's transform follows the transform of the object assigned to module.exports
				//(assignment to module.exports does not exist, since an ES6 named export is introduced)
				astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).forEach(function(path) {

					// console.log(path.value);

					let specifiers = path.value.specifiers;
					let localSpecifier = specifiers[0].local;

					exportedObjectName = localSpecifier.name;

					// console.log(localSpecifier);

					// let declaration = path.value.declaration;
					// if(declaration.type === 'FunctionDeclaration') {

					// 	exportedObjectName = declaration.id.name;
					// 	isLeftOperandAModuleExportsMemberExpression = true;
					// 	return;
					// }

					// exportedObjectName = path.value.declaration.name;
				});
			}

			// console.log(exportedObjectName);
			if(exportedObjectName === undefined || exportedObjectName === rightOperand.name) {

				//exportedObjectName equal to the name of right operand
				//do not create statements of type: <variableName> = <variableName>
				return false;
			}

			// replace module.exports with the name of the exported object
			astRootCollection.find(jscodeshiftAPI.MemberExpression, leftOperand).replaceWith(path => {

				// console.log(exportedObjectName);
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
 * @param {*} exportNode 
 */
function isExportStatementNestedInBlockStatement(jscodeshiftAPI, astRootCollection, exportNode) {

	var exportNodeLoc = exportNode.loc;
	var exportNodeStartLine = exportNodeLoc.start.line;
	var exportNodeStartColumn = exportNodeLoc.start.column;
	var exportNodeEndLine = exportNodeLoc.end.line;
	var exportNodeEndColumn = exportNodeLoc.end.column;

	//what if the export statement is contained in a block statement?
	//(transform only export statements in the top-level scope of module
	//ES6 imports/exports are only allowed in the module's top-level scope)
	var exportStatementCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		loc: { 
					start: { line: exportNodeStartLine, column: exportNodeStartColumn },
					end: { line: exportNodeEndLine, column: exportNodeEndColumn }
		}
	});

	for(let statementIndex = 0; statementIndex < exportStatementCollection.length; statementIndex++) {

		let exportStatement = exportStatementCollection.at(statementIndex).get();
		let parentNode = exportStatement.parentPath;

		while(parentNode !== null) {

			if(parentNode.value.type === 'BlockStatement') {

				//export statement nested inside block statement
				return true;
			}
			parentNode = parentNode.parentPath;
		}

		return false;
	}
}

/**
 * Determines if exportedElement is assigned the result of require() (i.e. it is an element imported in the module).
 * If yes, it exports the aliased definition under its actual name.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function isVariableAssignedTheValueOfRequireInvocation(exportedElement, jscodeshiftAPI, astRootCollection) {

	// let initializationNode = exportedElement.initializationValueNode;

	let initNode = exportedElement.initializationValueNode;
	let initStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, initNode);

	if(initStmts.length === 0) {

		return false;
	}

	let initializationNode = initStmts.at(0).get().value;
	if(initializationNode.type !== 'CallExpression' ||
	   initializationNode.callee.type !== 'Identifier' ||
	   initializationNode.callee.name !== 'require') {

		return false;
	}

	return true;
}

/**
 * Destructures object specified in exportedElement to its properties 
 * (and exports the properties instead of the function object itself).
 * Also, modifies the export statement to reference the export object,
 * in case that the object is used apart from its properties.
 */
function destructureObject(jscodeshiftAPI, astRootCollection, exportedElement, filePath, isEntryFile) {

	let variableName = exportedElement.variableName;
	let exportAlias = exportedElement.elementAlias;

	let variableNode = exportedElement.variableDeclarationNode;
	let initNode = exportedElement.initializationValueNode;
	// let variableExportNode = exportedElement.exportedVariableNode;
	// var loc = variableNode.loc;
	// var startLine = loc.start.line;
	// var startColumn = loc.start.column;
	// var endLine = loc.end.line;
	// var endColumn = loc.end.column;

	let initNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, initNode);

	let objectProperties = exportedElement.objectProperties;

	//export specifiers for properties (they are exported, instead of the object literal itself)
	let exportSpecifiers = [];
	let exportSpecifier = null;

	let resultObject = {};
	resultObject.isObjectDestructured = true;
	resultObject.exportedProperties = 0;

	let objectPropertiesDefinedWithinObject = false;

	//variable exported from entryFile, regardless of its use in other modules
	//(only in the case it is not initialized with an object expression)
	if(exportedElement.isFunctionConstructor === true ||
		exportedElement.usedBesidesProperties === true ||
		(isEntryFile === true &&
		  exportedElement.isInitializedWithObjectExpression === false)) {
	
		//names have changed due to name collisions (resolved at analysis)
		//exported object is cohesive, but has also bound properties
		//export object, along with its used properties
		//also: object used, apart from its statically known properties

		//create a variable definition for the new exported variable
		//introduce a variable definition right before the export statement
		let variableIdentifier = jscodeshiftAPI.identifier(variableName);

		//create variable declarator (syntax: <variableIdentifier> = <expDefinitionIdentifier>)
		let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
						
		//create variable declaration (syntax: var <variableIdentifier> = <expDefinitionIdentifier>)
		let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);

		let exportVariableIdentifier = jscodeshiftAPI.identifier(exportAlias);
		let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', variableIdentifier, exportVariableIdentifier);
		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));

		// let exportObjectIdentifier = jscodeshiftAPI.identifier(variableName);
		// let exportAliasIdentifier = jscodeshiftAPI.identifier(exportAlias);
		exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportVariableIdentifier);
		exportSpecifiers.push(exportSpecifier);
	}

	//for each object property, create a variable declaration (convert property to variable)
	//also, change property uses to the new variable's uses
	objectProperties.forEach(objectProperty => {

		//the property's mapped variable name and export alias name are resolved during analysis
		//(prevent name collisions)
		//properties exported with their initial names
		let propertyName = objectProperty.propertyName;
		let propertyAlias = objectProperty.propertyAlias;
		let propertyDefinitionNode = objectProperty.propertyDefinitionNode;
		// let objectPropertyUsages = objectProperty.objectPropertyUsages ? objectProperty.objectPropertyUsages : [];

		// let introducedVariableName = filePath + '_' + propertyName;
		let introducedVariableName = propertyName;

		//construct variable declaration with respect to objectProperty
		let variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

		//export the variable objectProperty is mapped to with its actual name
		//prevent bugs due to name aliasing (i.e. in the case the variable is imported along with its properties
		//and assigned to an alias), while do not introduce further analysis tasks
		let exportAliasIdentifier = jscodeshiftAPI.identifier(propertyAlias);

		//the newly introduced variable will be exported with the initial property's alias
		//(keep name consistency with the modules importing the variable's definition module)
		if(objectProperty.isExported === true || isEntryFile === true) {

			exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportAliasIdentifier);
			// exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
			exportSpecifiers.push(exportSpecifier);

			resultObject.exportedProperties++;
		}

		//(1) convert property to variable
		//(insert variable declaration at the end of the AST)

		//need to resolve the new variable's initialization value (whether it is defined outside or within the variable object)
		let statementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyDefinitionNode);

		// let statementCollection = astRootCollection.find(jscodeshiftAPI[propertyDefinitionNode.type]).filter(path => {

		// 	let pathLoc = path.value.loc;
		// 	if(pathLoc === null) {

		// 		return;
		// 	}

		// 	return pathLoc.start.line === propertyDefinitionNode.loc.start.line && pathLoc.start.column === propertyDefinitionNode.loc.start.column &&
		// 		   pathLoc.end.line === propertyDefinitionNode.loc.end.line && pathLoc.end.column === propertyDefinitionNode.loc.end.column;
		// });

		// console.log(astRootCollection.toSource())
		// console.log(propertyName)
		// console.log(statementCollection.length)

		let propertyInitializationValueNode = null;

		//no statements found - abort
		//case: property assigned the result of require()
		//imports are processed first - property definition is changed
		if(statementCollection.length === 0) {

			let assignmentExpressions = astRootCollection.find(jscodeshiftAPI.AssignmentExpression).filter(path => {

				let leftOperand = path.value.left;
				// if(leftOperand.type === 'MemberExpression' && leftOperand.object.type === 'Identifier' && leftOperand.object.name === variableName &&
				//    leftOperand.property.type === 'Identifier' && leftOperand.property.name === propertyName) {

				// 	return true;
				// }

				//names have changed due to preventing name collisions (search occurences by the property's actual name (export alias))
				if(leftOperand.type === 'MemberExpression' && leftOperand.object.type === 'Identifier' && leftOperand.object.name === variableName &&
				   leftOperand.property.type === 'Identifier' && leftOperand.property.name === propertyAlias) {

					return true;
				}
			});

			// console.log(assignmentExpressions.length);

			if(assignmentExpressions.length === 0) {

				//property might be inside the object literal
				if(initNodeCollection.length === 0) {

					return null;
				}

				let initNode = initNodeCollection.at(0).get();

				//search property in the object
				let objProp = initNode.value.properties.find(prop => {

					return prop.key.type === 'Identifier' &&
							prop.key.name === propertyAlias;
				});

				if(objProp == null) {

					return null;
				}

				propertyInitializationValueNode = objProp.value;

				//create variable declarator (syntax: <propertyName> = <initial_property_value>)
				let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, deepClone(propertyInitializationValueNode));
									
				//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
				let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

				//insert variableDeclaration at the end of the AST
				astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);
			
				return;
			}

			let assignmentExpression = assignmentExpressions.at(0).get();
			propertyInitializationValueNode = assignmentExpression.value.right;

			//create variable declarator (syntax: <propertyName> = <initial_property_value>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, deepClone(propertyInitializationValueNode));
								
			//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variableDeclaration at the end of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);

			//replace property reference inside definition
			//with a reference to the variable
			assignmentExpressions.replaceWith(assignmentExpression => {

				assignmentExpression.value.left = variableIdentifier;

				return assignmentExpression.value;
			});


			return;

			// return null;
		}

		if(propertyDefinitionNode.type === 'AssignmentExpression') {

			//create variable declarator (syntax: <propertyName> = <initial_property_value>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
								
			//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
			
			//insert variableDeclaration at the top of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);

			//(a) property defined using object binding (outside object)
			//replace property reference inside definition with a reference to the introduced variable
			let stmt = statementCollection.at(0).get();
			let propertyRefs = jscodeshiftAPI(stmt).find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

				// return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === variableName &&
				// 		mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyName;

				//names have changed (name collisions): search by name alias (initial name)
				return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === exportAlias &&
						mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyAlias;
			});

			// console.log(propertyRefs.length);
			if(propertyRefs.length === 0) {

				return;
			}

			propertyRefs.replaceWith(variableIdentifier);

			// propertyInitializationValueNode = statementCollection.at(0).get().value.right;

			// while(propertyInitializationValueNode.type === 'AssignmentExpression') {

			// 	propertyInitializationValueNode = propertyInitializationValueNode.right;
			// }
	
			// //create variable declarator (syntax: <propertyName> = <initial_property_value>)
			// let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, deepClone(rightOperand));
							
			// //create variable declaration (syntax: var <propertyName> = <initial_property_value>)
			// let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			// //after the assignment's parent (expression statement), insert the new variable declaration
			// jscodeshiftAPI(statementCollection.at(0).get().parentPath).insertAfter(node => {variableDeclaration});

			//replace uses of property with uses of the introduced variable
			// objectPropertyUsages.forEach(function(objectPropertyUsage) {

			// 	astRootCollection.find(objectPropertyUsage.type).filter(path => {

			// 		let pathLoc = path.value.loc;
			// 		return pathLoc.start.line === objectPropertyUsage.loc.start.line && pathLoc.start.column === objectPropertyUsage.loc.start.column &&
			// 			   pathLoc.end.line === objectPropertyUsage.loc.end.line && pathLoc.end.column === objectPropertyUsage.loc.end.column;

			// 	}).replaceWith(path => {

			// 		return variableIdentifier;
			// 	});
			// });

		}
		else if(propertyDefinitionNode.type === 'Property' ||
				propertyDefinitionNode.type === 'Identifier') {

			objectPropertiesDefinedWithinObject = true;
			propertyInitializationValueNode = propertyDefinitionNode.type === 'Property' ? 
												statementCollection.at(0).get().value.value:
												statementCollection.at(0).get().value;

			//create variable declarator (syntax: <propertyName> = <initial_property_value>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, deepClone(propertyInitializationValueNode));
								
			//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variableDeclaration right after its surrounding statememt
			let surrStmts = jscodeshiftAPI(statementCollection.at(0).get()).closest(jscodeshiftAPI.Statement);

			if(surrStmts.length === 0) {

				return;
			}

			jscodeshiftAPI(surrStmts.at(-1).get()).insertAfter(variableDeclaration);

			// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);
		}
		else if(propertyDefinitionNode.type === 'ObjectExpression') {

			objectPropertiesDefinedWithinObject = true;
			propertyInitializationValueNode = statementCollection.at(0).get().value;

			//create variable declarator (syntax: <propertyName> = <initial_property_value>)
			let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, deepClone(propertyInitializationValueNode));
								
			//create variable declaration (syntax: var <propertyName> = <initial_property_value>)
			let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

			//insert variableDeclaration right after its surrounding statememt
			let surrStmts = jscodeshiftAPI(statementCollection.at(0).get()).closest(jscodeshiftAPI.Statement);

			if(surrStmts.length === 0) {

				return;
			}

			jscodeshiftAPI(surrStmts.at(-1).get()).insertAfter(variableDeclaration);
		}

		// console.log(jscodeshiftAPI(variableDeclaration).toSource());
	});

	// console.log(astRootCollection.toSource());

	//remove object definition (prevent bugs during reference renamings)
	//only in the case that it is initialized with an object
	let variableDeclarationCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableNode);

	// var variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {
	// 	loc: { 
	// 			start: { line: startLine, column: startColumn },
	// 			end: { line: endLine, column: endColumn }
	// 	}
	// });

	if(variableDeclarationCollection.length > 0) {

		// let variableDef = variableDeclarationCollection.at(0).get();
		if(exportedElement.isFunctionConstructor === false) {

			// console.log(exportedElement.variableName);
			// console.log(exportedElement.exportedVariableNode === exportedElement.variableDeclarationNode);
	
			// let varDefLoc = variableNode.loc;
			// let varExpLoc = variableExportNode.loc;
	
			// console.log(startLine === varExpLoc.start.line && startColumn === varExpLoc.start.column &&
			// 			endLine === varExpLoc.end.line && endColumn === varExpLoc.end.column);
			
			if(isEntryFile === false &&(exportedElement.isInitializedWithObjectExpression === true && exportedElement.usedBesidesProperties === false) ||
					exportedElement.initializationValueNode.type === 'FunctionExpression') {

				variableDeclarationCollection.remove();
			}
	
		}
	}

	// console.log(astRootCollection.toSource());

	//after each property is mapped to a variable,
	//replace each property's usages with the respective variable usages 
	//(only those within the initialization values of the introduced variables)
	objectProperties.forEach(objectProperty => {

		let propertyName = objectProperty.propertyName;
		let propertyAlias = objectProperty.propertyAlias;
		let propertyDefinitionNode = objectProperty.propertyDefinitionNode;
		let objectPropertyUsages = objectProperty.objectPropertyUsages ? objectProperty.objectPropertyUsages : [];

		//need to resolve the initial property's definition (in order to remove it)
		//prevent bugs due to multiple property definition within 1 statement
		let statementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyDefinitionNode);

		// let statementCollection = astRootCollection.find(jscodeshiftAPI[propertyDefinitionNode.type]).filter(path => {

		// 	let pathLoc = path.value.loc;
		// 	if(pathLoc === null) {

		// 		return;
		// 	}

		// 	return pathLoc.start.line === propertyDefinitionNode.loc.start.line && pathLoc.start.column === propertyDefinitionNode.loc.start.column &&
		// 		   pathLoc.end.line === propertyDefinitionNode.loc.end.line && pathLoc.end.column === propertyDefinitionNode.loc.end.column;
		// });

		if(statementCollection.length > 0) {

			//update: what if the property's definition is located within a variable definition?
			//the outer definition must be initialized with the property's initialization value
			let propertyDefinition = statementCollection.at(0).get();

			// console.log(propertyDefinition.parentPath.value.type);
			if(propertyDefinition.parentPath.value.type === 'AssignmentExpression') {

				statementCollection.replaceWith(propertyDefinition.value.right);
			}

			// if(propertyDefinition.parentPath.value.type === 'ExpressionStatement') {

			// 	//the property's definition not inside another statement
			// 	statementCollection.remove();
			// }
			// else if(propertyDefinition.parentPath.value.type === 'AssignmentExpression') {

			// 	statementCollection.replaceWith(propertyDefinition.value.right);
			// }

			// statementCollection.remove();
		}

		// let introducedVariableName = filePath + '_' + propertyName;
		let introducedVariableName = propertyName;

		//construct variable declaration with respect to objectProperty
		let variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

		objectPropertyUsages.forEach(objectPropertyUsage => {

			//replace uses of property with uses of the introduced variable
			let propertyUses = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, objectPropertyUsage);

			if(propertyUses.length > 0) {

				propertyUses.replaceWith(path => { 

					return variableIdentifier; 
				});
			}

			// astRootCollection.find(objectPropertyUsage.type).filter(path => {

			// 	let pathLoc = path.value.loc;
			// 	let isPropertyUsage = (pathLoc.start.line === objectPropertyUsage.loc.start.line && pathLoc.start.column === objectPropertyUsage.loc.start.column &&
			// 						   pathLoc.end.line === objectPropertyUsage.loc.end.line && pathLoc.end.column === objectPropertyUsage.loc.end.column);

			// 	return isPropertyUsage;

			// 	// if(isPropertyUsage === false) {

			// 	// 	return false;
			// 	// }

			// 	// let parentNode = path.parentPath;
            //     // let isPropertyReferenceLocatedWithinObjectPropertyInitialValue = false;

            //     // while(parentNode.value.type !== 'Program') {

            //     //     if(parentNode.value.type === 'Property' || 
            //     //        (parentNode.value.type === 'AssignmentExpression' && parentNode.value.left.type === 'MemberExpression' &&
            //     //         parentNode.value.left.object.type === 'Identifier' && parentNode.value.left.object.name === variableName)) {
    
            //     //         isPropertyReferenceLocatedWithinObjectPropertyInitialValue = true;
            //     //         break;
            //     //     }
    
            //     //     parentNode = parentNode.parentPath;
			// 	// }
				
			// 	// return isPropertyReferenceLocatedWithinObjectPropertyInitialValue === false;
				
			// 	// return pathLoc.start.line === objectPropertyUsage.loc.start.line && pathLoc.start.column === objectPropertyUsage.loc.start.column &&
			// 	// 	   pathLoc.end.line === objectPropertyUsage.loc.end.line && pathLoc.end.column === objectPropertyUsage.loc.end.column;

			// 	}).replaceWith(path => {

			// 		return variableIdentifier;
			// });
			
		});
	});

	if(exportSpecifiers.length > 0) {

		//export through an ES6 named export the properties of the object specified in exportedElement
		//instead of the object itself (destructure object) (only if they are accessed in other modules)
		let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);

		//insert ES6 export at the end of the AST
		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
	}
	
	return resultObject;
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