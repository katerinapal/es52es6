/**
 * export_function.js
 * Codemod for exporting functions to client modules.
 * Applied in library systems.
 */

const path = require('path');

exports.description = 'export_function';

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let filePath = transformationInfo.filePath;
	let exportedElement = transformationInfo.exportedElement;
	
	//the name of the function that needs to become exported
	let functionName = exportedElement.functionName;

	//remove dashes and special characters not allowed in ES6
	functionName = functionName.replace(/[^\w\s]/gi, '').replace(/-/g, '');
	filePath = path.basename(filePath, '.js').replace(/[^\w\s]/gi, '').replace(/-/g, '');

	let exportAlias = exportedElement.elementAlias;
	exportAlias = (exportAlias != undefined ? exportAlias.replace(/[^\w\s]/gi, '').replace(/-/g, ''): functionName);
	
	//AST node (location/type) representing function that is going to become exported
	let functionNode = exportedElement.functionNode;
    let functionType = functionNode.type;
	
	//modify initial (CJS) export statement
	let exportNode = exportedElement.exportedFunctionNode;
	
    let expNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportNode);

    //export statement not found
    if(expNodeCollection.length === 0) {

        return;
    }

    let exportStmtNode = expNodeCollection.at(0).get();
	let isNestedInBlockStatement = isExportStatementNestedInBlockStatement(jscodeshiftAPI, astRootCollection, exportStmtNode);

	// console.log(isNestedInBlockStatement);

	let functionExportedViaModuleExports = isFunctionExportedViaModuleExports(exportStmtNode);

    //function is exported as a module object property
    //(replace the module object reference with a reference to the feature assigned to it)
    if(functionExportedViaModuleExports === false && 
		isFunctionAssignedToAPropertyOfExportsOrModuleExports(jscodeshiftAPI, astRootCollection, exportedElement) === true) {

		//function is exported as a property of module.exports/exports
		//in the export statement, module.exports is replaced with the name of the element that is exported through the ES6 default export statement
		//do not export the function itself
		return;
	}

    //(i) find AST node representing the definition of the function/variable that needs to be exported
	//and replace it with an export named declaration
	//(the export statement is named regardless of the commonjs export statement used to export the function)
	// search function definition blindly, regardless of its type
	let functionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, functionNode);

	if(functionCollection.length === 0) {

		return;
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

	//the ES6 export statement that will be introduced
	let exportedNode;

    //function either 
    //(a) assigned to module object or 
    //(b) a module property, but the module object is not assigned 
    //in either case, it needs to be exported through an explicit export
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

		//insert variableDeclaration at the top of the AST
		//(function declarations are hoisted and thus can be used before their definition)
		// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);

		astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);

		//export function if not already exported
		if(isFunctionAlreadyExported(jscodeshiftAPI, astRootCollection, functionName) === false) {

			//create an ES6 named export statement of the form export {<new_variable> as <functionName>}
			//and add it right at the end of the AST
            if(functionExportedViaModuleExports === false) {

                //function exported as a module object property
                //export through a named export
                //syntax: export {<new_variable> as <functionName>}
                let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
                exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
            }
            else {

                //function is the module object
                //export through a default export
                //syntax: export default <new_variable>
                exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);
            }

			
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

		}

		//finally, replace all other references to the module object
		//with exportedElement
		//needed to prevent patterns for backwards compatibility
		renameModObjRefs(jscodeshiftAPI, astRootCollection, functionName);

		return;
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

		return;
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
            if(functionExportedViaModuleExports === false) {

                //function is exported as a module object property
                //export function with a named export
                //syntax: export {<new_variable> as <functionName>}
                let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportAliasIdentifier);
			    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

                //insert ES6 export statement at the end of the AST
			    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
            }
            else {

                //function is the module object
                //export function with a default export
                //syntax: export default <new_variable>
                let exportStatement = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);

                //insert ES6 export statement at the end of the AST
			    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
            }
			

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

                //function exported as a property (introduce named export)
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

                if(functionExportedViaModuleExports === false) {

                    //function exported as a module object property (add named export)
                    let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, jscodeshiftAPI.identifier(exportAlias));
							
                    //create a node representing the export of the newly created variable
                    exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
                }
                else {

                    //function is the module object (add default export)
                    exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);
                }

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

                if(functionExportedViaModuleExports === false) {

                    //function is exported as a module object property (add named export)
                    let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, functionIdentifier);
				    exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
                }
                else {

                    //function is the module object (add default export)
                    exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);
                }
				
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
		return null;

		// return path.value;

	});

	//what if exportedNode is included in an assingment? (keep only right operand of that assignment)
	astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		right:
			exportedNode
	}).replaceWith(path => {

		// console.log(path);

		return path.value.right;
	});

	//finally, replace all other references to the module object
	//with exportedElement
	//needed to prevent patterns for backwards compatibility
	renameModObjRefs(jscodeshiftAPI, astRootCollection, elementName);

	return;
	
	// console.log(astRootCollection.toSource());
};

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
				astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration).forEach(function(path) {

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
}

/**
 * Helper function. Determines if the function specified in exportNode is exported via exports/module.exports
 * (needed to resolve the type of the ES6 export that will be introduced in the module).
 */
 function isFunctionExportedViaModuleExports(exportNode) {

	//a function can be exported if it is assigned either to a property of exports
	//or to module.exports (in the latter case, the function may be directly used when imported 
	//[without an explicit reference to the imported element])
	let leftOperand = exportNode.value.expression.left;
	let accessedObjectName;
	let accessedPropertyName;

	if(leftOperand.type === 'MemberExpression') {

		accessedObjectName = leftOperand.object.name;
		accessedPropertyName = leftOperand.property.name;

		if(accessedObjectName === 'module' && accessedPropertyName === 'exports') {

			//function specified in exportNode is exported through its assignment to module.exports
			return true;
		}
	}

    if(leftOperand.type === 'Identifier' && leftOperand.name === 'exports') {

        return true;
    }

	//function specified in exportNode is not exported through its assignment to module.exports/exports
	return false;
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
 * Renames all references to the module object with elementName references.
 * Needed for patterns preserving backwards compatibility, 
 * when the exported element is both assigned and bound to the module object.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} elementName the name of the exported element
 */
function renameModObjRefs(jscodeshiftAPI, astRootCollection, elementName) {

	let elemId = jscodeshiftAPI.identifier(elementName);
	let modObjRefs = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

		return mbExp.value.object.type === 'Identifier' &&
				mbExp.value.object.name === 'module' &&
				mbExp.value.property.type === 'Identifier' &&
				mbExp.value.property.name === 'exports';
	});

	if(modObjRefs.length > 0) {

		modObjRefs.replaceWith(elemId);
	}

	modObjRefs = astRootCollection.find(jscodeshiftAPI.Identifier).filter(id => {

		return id.value.name === 'exports';
	});

	if(modObjRefs.length > 0) {

		modObjRefs.replaceWith(elemId);
	}
}