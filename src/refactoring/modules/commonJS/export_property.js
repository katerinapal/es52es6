/**
 * Export Property codemod. Used in cases when an object literal is exported through its assignment to exports/module.exports
 */

var exports = module.exports = {};


exports.description = "export_property";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

	// console.log(transformationInfo);

	var exportedElement = transformationInfo.exportedElement;

	//retrieve name, node and export statement node of exported property
	var exportedPropertyName = exportedElement.propertyName;
	var exportedPropertyNode = exportedElement.propertyNode;
	var exportedPropertyExportStatementNode = exportedElement.exportStatementNode;
	var isPropertyExportedThroughModuleExports = exportedElement.isPropertyExportedThroughModuleExports;
	var callExpArguments;
	var callExpArg;

	//case 1: exportedProperty is exported through assignment to module.exports, export default declaration
	//case 2: exportedProperty is exported through assignment to exports, export named declaration (use the name of the property of exports)

	// console.log(exportedPropertyExportStatementNode);

	// console.log(exportedPropertyName);

	if((exportedPropertyNode.type === 'MemberExpression' && (exportedPropertyNode.object.name === 'window' || exportedPropertyNode.object.name === 'global'))) {

		//exported property assigned the result of require() - exclude properties that are assigned other properties
		//exclude exported properties that are assigned properties of window/global
		return;
	}
	else if((exportedPropertyExportStatementNode.type === 'AssignmentExpression' && exportedPropertyExportStatementNode.right.type !== 'AssignmentExpression' && exportedPropertyNode.type === 'CallExpression' && exportedPropertyNode.callee.name === 'require')) {

		callExpArguments = exportedPropertyNode.arguments;
		for(var argIndex = 0; argIndex < callExpArguments.length; argIndex++) {

			callExpArg = callExpArguments[argIndex];
			if(callExpArg.value.startsWith('.') === true) {

				//properties initialized with a call site of require() handled in insert_import codemod
				return;
			}
		}
	}

	var leftOperand = exportedPropertyExportStatementNode.left;
	var rightOperand;

	var accessedObject;
	var accessedProperty;
	var accessedPropertyName;

	var propertyExportStatementLoc = exportedPropertyExportStatementNode.loc;
	var propertyExportStatementStart = propertyExportStatementLoc.start;
	var startLine = propertyExportStatementStart.line;
	var startColumn = propertyExportStatementStart.column;
	var propertyExportStatementEnd = propertyExportStatementLoc.end;
	var endLine = propertyExportStatementEnd.line;
	var endColumn = propertyExportStatementEnd.column;

	var exportedNode;
	var comments = null;
	var assignmentLeftOperand;
	var accessedObject;
	var accessedProperty;
	var exportSpecifier;
	var assignmentObject;
	var assignmentProperty;
	var exportedObjectName;
	var isExportedElementACallExpression = false;

	var variableIdentifier;
	var variableDeclarator;
	var variableDeclaration;

	var exportDefaultDeclarations;
	var exportedDeclaration;
	var exportedObjectName;
	var exportNamedDeclaration;
	var variableName;
	var isExportStatementIncludedInAVariableDeclaration = false;

	var exportedIdentifier;
	var exportSpecifier;

	var assignmentLeftOperand;
	var assignmentRightOperand;
	var assignmentLeftOperandObject;
	var assignmentLeftOperandProperty;
	var isNotNullProperty = false;
	var variableDuplicate = false;
	var introducedVariableName;
	var isNestedStatement = false;

	//replacing retrieved AST node with exportedPropertyNode resulted from analysis bug (case: lodash, uglify.options.js) =>
	//transform retrieved AST node, instead of replacing with exportedPropertyNode

	// replace exportedPropertyExportStatementNode with exportedNode (search exportedPropertyExportStatementNode by its 'coordinates')
	var exportStatementCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
		loc: { 
					start: { line: startLine, column: startColumn },
					end: { line: endLine, column: endColumn }
		}
	}) .replaceWith(path => {

		// console.log(jscodeshiftAPI(path).toSource());

		if(isPropertyExportedThroughModuleExports === true) {

			//exportedProperty is exported through assignment to module.exports - create an export default declaration
	
			// console.log(jscodeshiftAPI(exportedPropertyNode).toSource());

			assignmentLeftOperand = path.value.left;
			assignmentRightOpenand = path.value.right;

			if(assignmentLeftOperand.type !== 'MemberExpression') {

				//exported element is not a function/variable definition
				//assign element to a variable and export variable instead
				variableIdentifier = jscodeshiftAPI.identifier('exportedObject');

				while(assignmentRightOpenand.type === 'AssignmentExpression') {

					//path represents an assignment - the rightmost operand should be exported
					assignmentRightOpenand = assignmentRightOpenand.right;
				}
								
				//create variable declarator (syntax: <variableIdentifier> = <callExpression>)
				variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, assignmentRightOpenand);
					
				//create variable declaration (syntax: var <variableIdentifier> = <callExpression>)
				variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

				isExportedElementACallExpression = true;
				exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);

				return variableDeclaration;
			}

			if(assignmentLeftOperand.object.type !== 'MemberExpression') {

				//syntax: module.exports = <element>
				if(path.value.right.type === 'CallExpression') {

					isExportedElementACallExpression = true;

					//exported element is not a function/variable definition
					//assign element to a variable and export variable instead
					variableIdentifier = jscodeshiftAPI.identifier('exportedObject');
								
					//create variable declarator (syntax: <variableIdentifier> = <callExpression>)
					variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);
					
					//create variable declaration (syntax: var <variableIdentifier> = <callExpression>)
					variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

					exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);

					return variableDeclaration;

				}
				else {

					rightOperand = path.value;
					while(rightOperand.type === 'AssignmentExpression') {

						//path represents an assignment - the rightmost operand should be exported
						rightOperand = rightOperand.right;
					}

					exportedNode = jscodeshiftAPI.exportDefaultDeclaration(rightOperand);
				}
			}
			else {

				//syntax: module.exports.<identifier> = <element>
				//replace module.exports with the element exported through module.exports
				astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration).forEach(function(path) {

					exportedObjectName = path.value.declaration.name;
				});

				//replace module.exports with the name of the exported object
				assignmentLeftOperand.object = jscodeshiftAPI.identifier(exportedObjectName);
				// astRootCollection.find(jscodeshiftAPI.MemberExpression, assignmentLeftOperand.object).replaceWith(path => {

				// 	// exportedObjectName = importedElement.aliasName === null ? importedElement.elementName : importedElement.aliasName;
				// 	return jscodeshiftAPI.identifier(exportedObjectName);
				// });

				return path.value;
			}

			
	
			// exportedNode = jscodeshiftAPI.exportDefaultDeclaration(path.value.right);
		}
		else {

			exportDefaultDeclarations = astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration);

			if(exportDefaultDeclarations.length > 0) {

				//an object is exported through an ES6 default export
				exportedDeclaration = exportDefaultDeclarations.at(0).get().value.declaration;
				if(exportedDeclaration.type === 'FunctionDeclaration') {

					exportedObjectName = exportedDeclaration.id.name;
				}
				else if(exportedDeclaration.type === 'Identifier') {

					exportedObjectName = exportedDeclaration.name;
				}

				if(exportedObjectName !== undefined) {

					path.value.left.object.name = exportedObjectName;
					return path.value;
				}
			}
	
			//exportedProperty is exported through assignment to exports - create an export named declaration
			accessedObject = leftOperand.object;
			accessedProperty = leftOperand.property;
			accessedPropertyName = accessedProperty.name;

			if(exportedPropertyName === null) {

				return path.value;
			}

			//case (jshint, messages.js): does variable with the same name exists?
			var variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
				{
					type: "VariableDeclarator",
					id: { name: exportedPropertyName }
			}]});

			if(exportedPropertyExportStatementNode.type !== 'AssignmentExpression') {

				//create a variable declaration (variable declarator is named accessedPropertyName, initialization value is represented by exportedPropertyNode)
				//create identifier
				// variableIdentifier = jscodeshiftAPI.identifier(accessedPropertyName);

				variableIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);
								
				//create variable declarator for variableName (syntax: <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
				variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);
					
					//print statement represented by the variable declarator AST node (mainly for debugging)
			//		console.log(jscodeshiftAPI(variableDeclarator).toSource());
					
				//create variable declaration for variableName (syntax: var <variableIdentifier> = function [<functionName>]([<argumentIdentifier]) {...})
				variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
					
				//create a node representing the export of the newly created variable
				exportedNode = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
			}
			else {

				// console.log(path.value.right.type);
				// console.log(path.parentPath.value.type);

				if(path.value.right.type === 'AssignmentExpression') {

					//exported property is assigned the result of an assignment expression
					if(path.value.right.right.type === 'CallExpression' && path.value.right.right.callee.name === 'require') {

						//exported property is assigned with another exported property that, in turn,
						//is assigned with the result of a require() call

						//create an exported named declaration for exported property
						variableIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);
						if(path.value.right.left.type === 'MemberExpression' && path.value.right.left.object.name === 'exports') {

							//assigned value is an exports property
							//transform assigned value into a reference to the property
							path.value.right.left = jscodeshiftAPI.identifier(path.value.right.left.property.name);
						}

						variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);
						
						//create a variable declaration for exported property (the variable is assigned
						//the value that was assigned to the exported property)
						variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

						return jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
					}

					if(variableDeclarations.length > 0) {

						introducedVariableName = exportedPropertyName + '_exportedObject';

						//another variable with the same name with exported property exists
						//create a ES6 nmaed export of the form: export {<exportedPropertyName>_exportedObject as <exportedPropertyName>}
						variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

						exportedIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);

						exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportedIdentifier);

						exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration([exportSpecifier]);

						//exported property is not assigned the result of an assignment
						//create export named declaration
						variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

						variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);

						//create a variable declaration for exported property (the variable is assigned
						//the value that was assigned to the exported property)
						variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

						variableDuplicate = true;
						// console.log(path.parentPath);
						if(path.parentPath.value.type !== 'ExpressionStatement') {

							//assignment nested in assignment - return identifier
							isNestedStatement = true;
							return variableIdentifier;
						}

						return variableDeclaration;
					}

					//exported property is not assigned the result of an assignment
					//create export named declaration
					variableIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);

					variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);

					//create a variable declaration for exported property (the variable is assigned
					//the value that was assigned to the exported property)
					variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

					return jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
				}
				else {

					if(variableDeclarations.length > 0) {

						introducedVariableName = exportedPropertyName + '_exportedObject';

						//another variable with the same name with exported property exists
						//create a ES6 nmaed export of the form: export {<exportedPropertyName>_exportedObject as <exportedPropertyName>}
						variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

						exportedIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);

						exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportedIdentifier);

						exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

						//exported property is not assigned the result of an assignment
						//create export named declaration
						variableIdentifier = jscodeshiftAPI.identifier(introducedVariableName);

						variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);

						//create a variable declaration for exported property (the variable is assigned
						//the value that was assigned to the exported property)
						variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

						variableDuplicate = true;
						// console.log(path.parentPath);
						if(path.parentPath.value.type !== 'ExpressionStatement') {

							//assignment nested in assignment - return identifier
							isNestedStatement = true;
							return variableIdentifier;
						}

						return variableDeclaration;
					}

					//exported property is not assigned the result of an assignment
					//create export named declaration
					variableIdentifier = jscodeshiftAPI.identifier(exportedPropertyName);

					variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, path.value.right);

					//create a variable declaration for exported property (the variable is assigned
					//the value that was assigned to the exported property)
					variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

					exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);

					if(path.parentPath.value.type === 'ExpressionStatement') {

						//export statement is not included in another statement
						return exportNamedDeclaration;
					}
					else if(path.parentPath.value.type === 'VariableDeclarator') {

						isExportStatementIncludedInAVariableDeclaration = true;
						variableName = path.parentPath.value.id.name;
					}
					
					return path.value;
				}
			}
			
		}

		//keep user-defined comments in the ES6 export declaration
		comments = path.parentPath.value.comments;
		path.parentPath.value.comments = '';
		exportedNode.comments = comments;
		// console.log(jscodeshiftAPI(exportedNode).toSource());
		return exportedNode;
	});

	if(isExportStatementIncludedInAVariableDeclaration === true) {
		
		//export statement inside variable declaration
		//export variable
		var variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
		{
			type: "VariableDeclarator",
			id: { name: variableName }
		}]}).replaceWith(exportNamedDeclaration);
	}

	if(isExportedElementACallExpression === true) {

		// console.log(astRootCollection.toSource());
		// console.log(exportedNode);

		//exported element is a call expression - insert ES6 default export after the newly inserted variable definition
		//(the transform replaced export statement with the variable definition)

		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);
	}

	if(isNestedStatement === true) {

		// astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);
		astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);
	}

	if(variableDuplicate === true) {

		//variable with the same name with property exist (introduced variable definition, not export statement)
		//add export statement after the introduced variable definition
		astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportNamedDeclaration);
		updateUsagesOfExportedProperty(jscodeshiftAPI, astRootCollection, exportedPropertyName, introducedVariableName);
	}

	//case: exported property is used in module
	//replace module with the name of the exported variable
	if(isPropertyExportedThroughModuleExports === false) {

		updateUsagesOfExportedProperty(jscodeshiftAPI, astRootCollection, exportedPropertyName, exportedPropertyName);
	}
	
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
 * Helper function. Updates uses of the property exported via exports with the name of the exported variable
 * (the variable introduced in the module)
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} propertyName 
 * @param {*} exportNode 
 */
function updateUsagesOfExportedProperty(jscodeshiftAPI, astRootCollection, propertyName, introducedVariableName) {

	astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(path => {

		return path.value.object.name === 'exports' && path.value.property.name === propertyName;
	}).replaceWith(path => {

		return jscodeshiftAPI.identifier(introducedVariableName);
	})
}