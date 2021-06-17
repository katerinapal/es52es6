/**
 * util.js. Provides helper functions regarding AST processing.
 */

var path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');
// var tern = require('../../../../node_modules/tern');

var metricUtilities = require('../../metrics/metricUtilities');
var fileUtilities = require('../../../io/fileUtilities.js');
var codeHierarchyUtilities = require('./codeHierarchyUtilities.js');
var mdgUtilities = require('../../mdg/mdgUtilities.js');

var sourceFile = require('../model/sourceFile.js');
var FunctionDeclaration = require('../model/functionDeclaration.js');
var functionProperty = require('../model/functionProperty.js');
var Variable = require('../model/variable.js');
var GlobalObjectProperty = require('../model/globalObjectProperty.js');
var ObjectLiteral = require('../model/objectLiteral.js');
var InputFileHashMap = require('./inputFileHashMap.js');
// var ClassDeclaration = require('../model/classDeclaration.js');

var enums = require('./enums.js');

var inputFileFolder = './sourceFiles/';

/**
 * Loads the ASTs specified in inputFiles in the server of Tern.
 * @param {*} inputFiles 
 */
function loadFilesOnTernServer(inputFiles) {

	codeHierarchyUtilities.loadFilesOnTernServer(inputFiles);
}

/**
 * Removes the ASTs specified in inputFiles from the server of Tern.
 * @param {*} inputFiles 
 */
function removeFilesFromTernServer(inputFiles) {

	codeHierarchyUtilities.removeFilesFromTernServer(inputFiles);
}

/**
 * Returns the name of the defined function through its parent node.
 * @param functionExpression
 * @returns
 */
function retrieveNameOfDeclaredFunction(functionExpression) {
	
	var parentNode = functionExpression.parentPath.value;
	var functionName;

	// console.log(parentNode.type);
	if(parentNode.type === 'VariableDeclarator') {
		
		//anonymus function assigned to a variable (var <variableName> = function(<args>) { ... })
		functionName = parentNode.id.name;
	}
	else if(parentNode.type === 'AssignmentExpression') {
		
		//function assigned to a property (this.<propertyName> = function(<args>) { ... })
		//update: or to an identifier
		var leftOperand = parentNode.left;
		// console.log(leftOperand);
		if(leftOperand.type === 'Identifier') {

			functionName = leftOperand.name;
		}
		else if(leftOperand.type === 'MemberExpression') {

			if(leftOperand.property === undefined) {
			
				functionName = leftOperand;
			}
			else {
				
				functionName = leftOperand.property.name;
			}
		}
		else {

			functionName = 'anonymus';
		}
		
	}
	else if(parentNode.type === 'Property') {
		
		//function assigned to a property of an object literal (<propertyName> : function(<args>) { ... })
		functionName = parentNode.key.name;
	}
	else {
		functionName = 'anonymus';
	}
	
	// console.log(functionName);
	return functionName;
}

/**
 * Returns enclosing scope of function declaration.
 * @param expressionStatement (a function or class expression)
 * @returns
 */
function retrieveEnclosingScope(expressionStatement) {
	
	let parentPath = expressionStatement.parentPath;
	if(parentPath !== undefined) {
		
		let enclosingScope = expressionStatement.parentPath.scope;
		
		//if function expression is global, its parent scope is the global scope (return null)
		let isGlobal = enclosingScope.isGlobal;
		if(isGlobal === true) {
			return null;
		}
		
		//function expression within another function - return enclosing function node
		let scopeNode = enclosingScope.node;
		// console.log(scopeNode);
		return scopeNode;
	}
	return null;
}

/**
 * Search a defined function in the defined functions' array by its AST node.
 * @param definedFunctions
 * @param parentFunctionNode
 * @returns
 */
function retrieveDefinedFunctionByNode(definedFunctions, functionNode) {
	
	for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
		
		var definedFunction = definedFunctions[functionIndex];
		if(definedFunction.functionNode.value === functionNode) {
			
			return definedFunction;
		}
	}
	
	return null;
}

// /**
//  * Returns the variables defined within definedFunction and their values.
//  * @param definedFunction
//  * @returns
//  */
// function retrieveLocalVariablesOfFunction(sourceFile, definedFunction) {
	
// 	var localVariables = [];
// //	console.log(definedFunction);
	
// 	if(definedFunction.functionName !== 'topLevelScope') {
		
// 		//find variable declarations within definitionFunction (not variable declarations within definedFunction's nested functions)
// 		var variableDeclarations = jscodeshift(definedFunction.functionNode).find(jscodeshift.VariableDeclaration).filter(nodePath => {

// 			var node = nodePath;
// 			while(node !== null) {

// 				if(node.value.type === 'FunctionExpression' || node.value.type === 'FunctionDeclaration') {

// 					break;
// 				}
// 				node = node.parentPath;
// 			}

// 			return node.value === definedFunction.functionNode.value;
// 		});
		
// 		variableDeclarations.forEach(function(variableDeclaration) {
			
// //			console.log(variableDeclaration.value);
			
// 			//find the variables declared in the current variable declaration
// 			var declarations = variableDeclaration.value.declarations;
			
// //			console.log(declarations);
			
// 			declarations.forEach(function(declaration) {
				
// 				//for each declaration, find the declared variable
// 				//and its initialization value
// 				var localVariableName = declaration.id.name;
// 				var localVariableInitialValueNode = declaration.init;
				
// //				console.log(localVariableName);
// //				console.log(localVariableInitialValueNode);
				
// 				var definedVariable = new Variable.Variable(localVariableName, localVariableInitialValueNode, variableDeclaration);
// 				localVariables.push(definedVariable);
// 			});
			
// 		});
		
// 		definedFunction.updateLocalVariables(localVariables);
// 	}
// 	else {

// 		//topLevelScope is an artifical function node modelling the module's top-level scope
// 		//topLevelScope's local variables are the module's explicit globals
// 		definedFunction.updateLocalVariables(sourceFile.explicitGlobals);
// 	}
// }

/**
 * Returns the functions defined in sourceFile using function declarations 
 * (function <functionName>(args) {...} ).
 * @param sourceFile
 * @returns
 */
function retrieveFunctionDeclarationsFromSourceFile(sourceFile) {
	
	var functionDeclarations = [];
	var functionDeclarationNodes = sourceFile.astRootCollection.find(jscodeshift.FunctionDeclaration);
	// functionDeclarationNodes.forEach(function(functionDeclaration) {
		
	// 	functionDeclarations.push(functionDeclaration);
	// });
	
	// console.log(sourceFile.fileName + " " + functionDeclarations.length);
	return functionDeclarationNodes;
}

/**
 * Returns the functions defined in sourceFile using function expressions 
 * (anonymous functions or functions assigned to variables/properties).
 * @param sourceFile
 * @returns
 */
function retrieveFunctionExpressionsFromSourceFile(sourceFile) {
	
	var functionExpressions = [];
	var functionExpressionNodes = sourceFile.astRootCollection.find(jscodeshift.FunctionExpression);
	// functionExpressionNodes.forEach(function(functionExpression) {
		
	// 	functionExpressions.push(functionExpression);
	// });
	
	return functionExpressionNodes;
}


/**
 * Returns functions defined within sourceFile, 
 * using either function expressions or function declarations.
 * @param sourceFile
 * @returns
 */
function retrieveSourceFileDefinedFunctions(sourceFile) {
	
	// console.log(sourceFile.fileName);

	let definedFunctions = [];
	
	//find top-level scope node
	let topLevelScopeNode = retrieveTopLevelScopeNode(sourceFile);
	let astRootCollection = sourceFile.astRootCollection;
	
	let functionExpressions = retrieveFunctionExpressionsFromSourceFile(sourceFile);
	let functionDeclarations = retrieveFunctionDeclarationsFromSourceFile(sourceFile);
	
	//add node representing top-level scope at the start of the function expression array
	// functionExpressions.splice(0,0,topLevelScopeNode);
	// functionExpressions = functionExpressions.concat(functionDeclarations);

	// console.log(sourceFile.fileName + ' ' + (functionExpressions.length + functionDeclarations.length + 1));

	//process the artificial function (function modelling the module scope)
	let declaredFunction = new FunctionDeclaration.FunctionDeclaration(topLevelScopeNode);
	declaredFunction.updateDeclaredFunction(sourceFile);
	definedFunctions.push(declaredFunction);
	
	functionExpressions.forEach(functionExpression => {

		let declaredFunction = new FunctionDeclaration.FunctionDeclaration(functionExpression);

		//update declaredFunction with its name, parameters, properties, local variables (and their usages)
		declaredFunction.updateDeclaredFunction(sourceFile);
		definedFunctions.push(declaredFunction);
	});

	functionDeclarations.forEach(functionDeclaration => {

		let declaredFunction = new FunctionDeclaration.FunctionDeclaration(functionDeclaration);

		//update declaredFunction with its name, parameters, properties, local variables (and their usages)
		declaredFunction.updateDeclaredFunction(sourceFile);
		definedFunctions.push(declaredFunction);
	});

	// console.log(sourceFile.fileName + ' ' + definedFunctions.length);
	
	//after retrieving the functions defined in a module, 
	//find enclosing scope of each function declared within sourceFile
	//also find each function's nested functions
	definedFunctions.forEach(definedFunction => {
		
		if(definedFunction.functionScope === null) {
			
			let parentFunctionNode = retrieveEnclosingScope(definedFunction.functionNode);
			
			// console.log(parentFunctionNode);
			if(parentFunctionNode !== null) {
				
				//update child-parent relation
				let parentFunction = retrieveDefinedFunctionByNode(definedFunctions, parentFunctionNode);
				definedFunction.updateFunctionScope(parentFunction);

				if(parentFunction != null && parentFunction.functionName !== 'topLevelScope') {

					//update parent-child relation (no need to make an AST query for nested functions)
					parentFunction.addFunctionDeclarationToNestedFunctions(definedFunction);
				}
			}
			else {
				
				definedFunction.updateFunctionScope(null);
			}
		}

		// if(definedFunction.functionName !== 'topLevelScope') {

		// 	// retrieveNestedFunctionsInFunction(definedFunctions, definedFunction);

		// 	//retrieve each function's returned value after the function is updated
		// 	definedFunction.retrieveReturnValueOfFunction(sourceFile);
		// }

	});

	let functionDefs = definedFunctions.filter(funcDef => {

		// console.log(funcDef.functionName === 'topLevelScope' ? funcDef.functionNode : null);
		return funcDef.functionName !== 'topLevelScope';
	});

	//the returned value from a function is needed in client-side projects (exported feats in AMD)
	//in CJS exported feats are assigned/bound to the module object
	if(sourceFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

		functionDefs.forEach(definedFunction => {

			//retrieve each function's returned value after the function is updated
			definedFunction.retrieveReturnValueOfFunction(sourceFile);
		});
	}
	// functionDefs.forEach(definedFunction => {

	// 	//retrieve each function's returned value after the function is updated
	// 	definedFunction.retrieveReturnValueOfFunction(sourceFile);
	// });

	// console.log(sourceFile.fileName + ' ' + definedFunctions.length);

	// console.log(sourceFile.fileName + ' ' + definedFunctions.length);
	
	// console.log(sourceFile.fileName + " " + definedFunctions.length);
	sourceFile.updateDefinedFunctions(definedFunctions);
}

/**
 * Returns the class definitions within sourceFile.
 */
function retrieveSourcefileDefinedClasses(sourceFile) {

	var astRootCollection = sourceFile.astRootCollection;

	var definedClasses = [];
	var definedClass;
	var className;

	var classDeclarationCollection;

	//retrieve class expressions (statements that do not correspond to plain class declarations)
	var classExpressionCollection = astRootCollection.find(jscodeshift.ClassExpression);
	classExpressionCollection.forEach(function(classExpression) {

		className = classExpression.value.id.name;
		definedClass = new ClassDeclaration.ClassDeclaration(className, classExpression);

		definedClass.updateEnclosingScope(retrieveEnclosingScope(classExpression));

		definedClasses.push(definedClass);
	});

	//retrieve class declarations (statements that correspond to plain class declarations)
	classDeclarationCollection = astRootCollection.find(jscodeshift.ClassDeclaration);
	classDeclarationCollection.forEach(function(classDeclaration) {

		className = classDeclaration.value.id.name;
		definedClass = new ClassDeclaration.ClassDeclaration(className, classDeclaration);

		definedClass.updateEnclosingScope(retrieveEnclosingScope(classDeclaration));

		definedClasses.push(definedClass);
	});

	sourceFile.updateDefinedClasses(definedClasses);
}

/**
 * Retrieves nested functions in definedFunction (function defined locally within definedFunction).
 */
function retrieveNestedFunctionsInFunction(definedFunctions, definedFunction) {
	
	var nestedFunctions = [];
	var functionNode = definedFunction.functionNode;
	var functionNodeCollection = jscodeshift(functionNode);
	
	//retrieve functions declared within function using function declarations (function <functionName> (args) {...})
	var functionDeclarations = functionNodeCollection.find(jscodeshift.FunctionDeclaration);
	
	// console.log('definedFunction: ' + definedFunction.functionName);
	functionDeclarations.forEach(function(functionDeclaration) {
		
		//find functionDeclaration in the list of definedFunctions (recall that sourceFile's defined function list is not updated yet)
		var declaredFunction = retrieveDefinedFunctionByNode(definedFunctions, functionDeclaration.value);
		if(declaredFunction !== null) {

			nestedFunctions.push(declaredFunction);
		}
	});
	
	//retrieve functions declared within function using function expressions (var <functionName> = function(args) {...})
	var functionExpressions = functionNodeCollection.find(jscodeshift.FunctionExpression);
	functionExpressions.forEach(function(functionExpression) {
		
		//find functionDeclaration in the list of definedFunctions (recall that sourceFile's defined function list is not updated yet)
		var declaredFunction = retrieveDefinedFunctionByNode(definedFunctions, functionExpression.value);
		if(declaredFunction !== null) {

			nestedFunctions.push(declaredFunction);
		}
	});
	
//	console.log(definedFunction.functionName);
//	console.log(nestedFunctions);
	
	//update nested functions array of definedFunction
	definedFunction.updateNestedFunctions(nestedFunctions);
}

/**
 * Creates a function representing the top-level scope of sourceFile.
 * @param sourceFile
 * @returns
 */
function retrieveTopLevelScopeNode(sourceFile) {
	
	//retrieve statements in top-level scope of file
	//exclude function declarations and expressions
	let topLevelScopeStatements = [];
	let programNodeCollection = sourceFile.astRootCollection.find(jscodeshift.Program);
	programNodeCollection.forEach(function(programNode) {
		
		programNode.value.body.forEach(function(topLevelScopeStatement) {
			
			if(topLevelScopeStatement.type !== 'FunctionDeclaration' &&
			   topLevelScopeStatement.type !== 'FunctionExpression') {
				
				topLevelScopeStatements.push(topLevelScopeStatement);
			}
			
		});
		
	});
	
	let topLevelScopeBlockStatement = jscodeshift.blockStatement(topLevelScopeStatements);
	let functionIdentifier = jscodeshift.identifier("topLevelScope");
	
	//convert top-level scope function to an ast
	//it's an artificially generated function (convert the topLevelScope's source to an AST)
	let topLevelScope = jscodeshift.functionDeclaration(functionIdentifier, [], topLevelScopeBlockStatement);
	let functionAST = jscodeshift(jscodeshift(topLevelScope).toSource());
	
	let programNodes = functionAST.find(jscodeshift.Program);
	
	//first program node corresponds to the first statement
	//of the program
	let functionNode = {};
	functionNode.value = programNodes.at(0).get().value.body[0];
	return functionNode;
	
}

/**
 * Retrieves usages of instance variables in definedFunction.
 * @param definedFunction
 * @returns
 */
function retrieveInstanceVariableUsagesInFunction(definedFunction) {
	
	var accessedProperties = [];
	var functionNode = definedFunction.functionNode;
	
//	console.log(jscodeshift(functionNode));
	
	var memberExpressions = jscodeshift(functionNode).find(jscodeshift.MemberExpression);
	
	memberExpressions.forEach(function(memberExpression) {
		
//		console.log(memberExpression.scope);
		
//		var enclosingScope = retrieveEnclosingScope(memberExpression);
//		console.log(memberExpression);
//		
//		console.log("\nenclosingScope:");
//		console.log(enclosingScope);
//		console.log();
		
//		console.log(memberExpression);
//		console.log();
//		console.log(memberExpression.closestScope);
//		console.log("\n");
		
		var memberExpressionValue = memberExpression.value;
		var expressionObject = memberExpressionValue.object;
		
//		console.log(memberExpression);
//		console.log();
		
//		console.log(expressionObject);
		
		//member expression corresponds to a property defined in the same 
		//'class'/function within which definedFunction is defined
		if(expressionObject.type === 'ThisExpression') {
			var accessedProperty = memberExpressionValue.property.name;
			if(accessedProperties.includes(accessedProperty) === false) {
				
				accessedProperties.push(accessedProperty);
			}
			
//			console.log(accessedProperty);
		}
	});
	
	definedFunction.updateUsedInstanceVariables(accessedProperties);
//	console.log(definedFunction.functionName + " " + accessedProperties);
}

/**
 * Returns the properties defined in the body of a 
 * function expression (through binding properties to this).
 * Also returns the properties assigned to the function's
 * prototype.
 * @param functionExpression
 * @returns
 */
function retrieveConstructorPropertiesOfFunction(declaredFunction) {
	
	var functionProperties = [];
	var functionExpression = declaredFunction.functionNode;
	var functionStatements = functionExpression.value.body.body;

	// console.log(declaredFunction.functionName);
	
	//(a) retrieve properties bound to this within function
	//syntax: this.<propertyIdentifier> = <initializationValue>
	//for each statement of function
	functionStatements.forEach(function(functionStatement) {
		
		// console.log(functionStatement);
		
		if(functionStatement.type === 'ExpressionStatement') {
			
			// console.log(functionStatement);
			
			var expression = functionStatement.expression;
			var definedProperty;
			
			//if the expression of a statement is an assignment
			if(expression.type === 'AssignmentExpression') {
				
				//properties are assigned statically
				var assignmentExpression = expression;
				var leftOperator = assignmentExpression.left;
				var rightOperator = assignmentExpression.right;
				// console.log(leftOperator);
//				console.log(rightOperator.type);
				
				//if its left operand is a member expression (a binding to this)
				//add its property to the functionProperties array
//				if(leftOperator.type === 'MemberExpression') {
				if(leftOperator.type === 'MemberExpression' && leftOperator.object.type === 'ThisExpression') {
					
					// console.log(leftOperator);
					
					definedProperty = new functionProperty.FunctionProperty(functionStatement.expression);
					definedProperty.propertyName = leftOperator.property.name;

					//do not consider properties with invalid names
					if(definedProperty.propertyName == null ||
						isNaN(definedProperty.propertyName) === false) {

						return;
					}

					definedProperty.updatePropertyType(rightOperator.type);
					// definedProperty.updatePropertyDefinitionNode(functionStatement);
					if(rightOperator.type === 'FunctionExpression') {
						definedProperty.updatePropertyValue(rightOperator);
					}
					else {
						definedProperty.updatePropertyValue(rightOperator.value);
					}
					
//					console.log(rightOperator.value);
					
					functionProperties.push(definedProperty);
//					console.log(leftOperator.property.name);
				}
				
			}
			else if(expression.type === 'CallExpression') {

				//properties are generated dynamically (through Object.defineProperty())
				let calleeFunction = expression.callee;
				// console.log(calleeFunction);
				if(calleeFunction.type === 'MemberExpression' && calleeFunction.object.name === 'Object' && calleeFunction.property.name === 'defineProperty') {

					let calleeParameters = expression.arguments;
					// console.log(calleeParameters[0]);
					// console.log(calleeParameters);
					// console.log(calleeParameters[2]);
					if(calleeParameters[0].type === 'ThisExpression') {

						definedProperty = new functionProperty.FunctionProperty(functionStatement.expression);
						definedProperty.propertyName = calleeParameters[1].value;

						//do not consider properties with invalid names
						if(definedProperty.propertyName == null ||
							isNaN(definedProperty.propertyName) === false) {

							return;
						}

						definedProperty.updatePropertyType(calleeParameters[2].type);
						// definedProperty.updatePropertyDefinitionNode(functionStatement);
						definedProperty.updatePropertyValue(calleeParameters[2]);

						// console.log(definedProperty);

						functionProperties.push(definedProperty);
					}
				}
			}
			else if(expression.type === 'MemberExpression' && expression.object.type === 'ThisExpression') {

				definedProperty = new functionProperty.FunctionProperty(functionStatement.expression);
				definedProperty.propertyName = expression.property.name;

				//do not consider properties with invalid names
				if(definedProperty.propertyName == null ||
					isNaN(definedProperty.propertyName) === false) {

					return;
				}

				definedProperty.updatePropertyType(null);
				// definedProperty.updatePropertyDefinitionNode(functionStatement);
				definedProperty.updatePropertyValue(null);
					
				functionProperties.push(definedProperty);
			}

		}
	});

	//(b) retrieve properties assigned to the function's prototype
	//syntax: <functionNameIdentifier>.prototype.[<propertyIdentifier>] = <initializationValue>

	
	// console.log(functionProperties);
	return functionProperties;
}

/**
 * Retrieves the implied globals of sourceFile.
 */
function retrieveImpliedGlobalsOfSourceFile(inputFile, inputFiles) {

	//implied globals are the variables that are used without being defined locally within the scope 
	//formed by the function definition or one of the function definition's outer scopes
	codeHierarchyUtilities.retrieveImpliedGlobalsOfSourceFile(inputFile, inputFiles);
}

/**
 * Creates the AST of a module and stores it in the corresponding sourceFile object.
 * @param sourceCode
 * @returns
 */
function createASTOfModule(file) {
	
	// console.log(file);
	var sourceCode = fileUtilities.retrieveSourceCodeFromFile(file);
//	return jscodeshift(sourceCode);
	
	//choosing flow parser, as babylon needs plugins to run experimental source code
	return jscodeshift(sourceCode, {parser: require('flow-parser')});
	// return jscodeshift(sourceCode, {parser: require('flow-parser'), dry: true, useTabs: true});
	
	// return jscodeshift(sourceCode, {parser: require('acorn')});
}

/**
 * Retrieves modules defined in each file in fileList 
 * (initialization of list with sourceFile objects).
 * @param fileList
 * @returns
 */
function retrieveModuleDefinedInFiles(fileList, excludedDirectoryArray, testFileDirectoryArray, libraryFileArray, projectEntryFileAbsolutePath) {
	
	var inputFiles = new InputFileHashMap.InputFileHashMap();
	inputFiles.generateHashMap(fileList.length);

	fileList.forEach(function(inputFile) {

		let testDirectories = [];
		let libraryDirectories = [];
		if(excludedDirectoryArray.length !== 0) {

			let excludedDirectories = excludedDirectoryArray.filter(excludedDirectory => {

				return inputFile.includes(excludedDirectory);
			});
	
			if(excludedDirectories.length !== 0) {
	
				//file located in an excluded directory - proceed to the next file
				return;
			}
		}
		
		if(testFileDirectoryArray.length !== 0) {

			testDirectories = testFileDirectoryArray.filter(testDirectory => {

				return inputFile.includes(path.normalize(testDirectory)) === true;
			});
		}

		if(libraryFileArray.length !== 0) {

			libraryDirectories = libraryFileArray.filter(libraryFile => {

				return inputFile.includes(path.normalize(libraryFile)) === true;
			});
		}

		var astRootCollection = createASTOfModule(inputFile);
		
		var requiredModules = [];
		var file = new sourceFile.SourceFile(inputFile);
		file.updateAstRootCollection(astRootCollection);
		if(testDirectories.length !== 0) {

			//file located in a directory specified as test directory
			file.updateModuleType(enums.ModuleType.testFile);
		}
		else if(libraryDirectories.length !== 0) {

			//file is an external library (applies to client-side code)
			file.updateModuleType(enums.ModuleType.library);

			//the library's next element is its exported object's name
			//(useful for introducing ES6 default imports)
			let libraryIndex = libraryFileArray.indexOf(libraryDirectories[0]);
			if(libraryIndex >= 0) {

				file.updateLibraryObjectName(libraryFileArray[libraryIndex+1]);
			}
		}
		else {

			file.updateModuleType(enums.ModuleType.componentFile);
		}

		//determines whether file comprises the analyzed system's entry file
		file.updateIsEntryFile(projectEntryFileAbsolutePath);

		//in the case of AMD module, retrieve its id
		retrieveModuleId(file);
		
		//add file to hashmap
		inputFiles.introduceInputFileToMap(file.fileName, file);
	});
	
	return inputFiles;
}

/**
 * Retrieves the module's id (in the case of an AMD module, its id is defined in define())
 * @param {*} sourceFile 
 */
function retrieveModuleId(sourceFile) {

	//retrieve call expressions (calls to define for AMD definitions)
	var callExpressions = sourceFile.astRootCollection.find(jscodeshift.CallExpression);

	if(callExpressions.length === 0) {

		return;
	}

	callExpressions.forEach(function(callExpression) {
		
		//retrieve name of callee function of callExpression
		var calleeName = callExpression.value.callee.name;
		
		if(calleeName === 'define') {
			
			//arguments of define():
			//(i) name of the module to be defined
			//(ii) array of modules on which the defined module is depended on
			//(iii) callback function handling the defined module
			var functionCallArguments = callExpression.value.arguments;
			// console.log(functionCallArguments[0]);
			var definedModule = functionCallArguments[0].value;

			if(definedModule === undefined) {

				//update: defined module's name is not specified as an argument in define()
				//the module is named with the name of the JS file (AMD specs)
				definedModule = path.basename(sourceFile.fileName, ".js");
				if(functionCallArguments[0].type === 'ObjectExpression') {

					//case: object literal amd module (this object literal will be exported)
					// file.updateObjectLiteral(functionCallArguments[0]);
					let objectLiteral = new ObjectLiteral.ObjectLiteral(functionCallArguments[0]);
					codeHierarchyUtilities.retrievePropertiesOfObjectLiteral(objectLiteral, functionCallArguments[0]);
					sourceFile.updateObjectLiteral(objectLiteral);
				}
			}

			// console.log(inputFile + " " + definedModule);
			
			//this file contains the definition of definedModule
			sourceFile.addModuleDefinition(definedModule);
			
		}
	});
}

/**
 * Retrieves explicit globals
 * (globals defined in top-level scope of sourceFile)
 * @param sourceFile
 * @returns
 */
function retrieveExplicitGlobalsOfSourceFile(sourceFile) {
	
	let astRootCollection = sourceFile.astRootCollection;
	
	//array containing objects representing explicit globals 
	//of sourceFile and their initialization value nodes
	//(variables defined in top-level scope of sourceFile)
	let explicitGlobals = [];

	// console.log(sourceFile.fileName);
	
	//search for variables defined in the module scope of sourceFile
	//exclude variables defined inside statements (e.g. for loops)
	let variableDeclarationCollection = astRootCollection.find(jscodeshift.VariableDeclaration).filter(variableDeclaration => {

		if(variableDeclaration.scope.isGlobal === false) {

			return false;
		}

		let surroundingStmts = jscodeshift(variableDeclaration).closest(jscodeshift.Statement);

		//variable is an explicit global (defined in the module's scope - not wrapped in a function scope)
		//but is wrapped in a block statement (it is not included in the program's statement array - it is not going to be exported)
		if(surroundingStmts.length > 0) {

			return false;
		}

		return true;

		// // let surroundingStmts = astRootCollection.find(jscodeshift.Statement).filter(stmt => {

		// // 	let nestedStmts = jscodeshift(stmt).find(jscodeshift.VariableDeclaration).filter(varDecl => {

		// // 		return varDecl.value === variableDeclaration.value;
		// // 	});

		// // 	if(nestedStmts.length > 0) {

		// // 		// nestedStmts.forEach(nestedStmt => {

		// // 		// 	console.log(nestedStmt.value);
		// // 		// })
		// // 		return true;
		// // 	}

		// // 	return false;
		// // });

		// //variable is an explicit global (defined in the module's scope - not wrapped in a function scope)
		// //but is wrapped in a block statement (it is not included in the program's statement array - it is not going to be exported)
		// if(surroundingStmts.length > 0) {

		// 	return false;
		// }

		// return true;
	});

	variableDeclarationCollection.forEach(variableDeclaration => {

		//find variable declared and its initialization value node
		let declarations = variableDeclaration.value.declarations;
		declarations.forEach(declaration => {

			//initialize variable (each variable is mapped to a declaration within variableDeclaration)
			let globalVariable = new Variable.Variable();
			globalVariable.updateVariable(sourceFile, variableDeclaration, declaration);
			explicitGlobals.push(globalVariable);
		});
		
	});

	// console.log(sourceFile.fileName);
	// console.log(explicitGlobals);
	
	//update explicit globals of sourceFile
	sourceFile.updateExplicitGlobals(explicitGlobals);
}

/**
 * Is identifier located inside a member expression?
 * (is an imported feature's property accessed/defined?)
 * @returns true (along with the surrounding member expression) if identifier is located
 * in a member expression, false otherwise.
 * @param {*} usageIdentifier 
 */
function isIdentifierInsideAMemberExpression(usageIdentifier) {

	// let parentNode = usageIdentifier.parentPath;

	// //an imported element is modified if it is directly assigned a value (the modification node is the identifier itself)
	// //if a property is bound to it (the modification node is a member expression)
	// //is usageIdentifier located within a member expression?
	// let isUsageWithinAMemberExpression = false;
	// while(parentNode.value.type !== 'Program' && isUsageWithinAMemberExpression === false) {

	// 	if(parentNode.value.type === 'MemberExpression') {

	// 		isUsageWithinAMemberExpression = true;
	// 		break;
	// 	}
		
	// 	parentNode = parentNode.parentPath;
	// }

	let surrMbExps = jscodeshift(usageIdentifier).closest(jscodeshift.MemberExpression);

	if(surrMbExps.length > 0) {

		return {

			isUsageWithinAMemberExpression: true,
			surrMbExp: surrMbExps.at(0).get()
		};
	}

	return {

		isUsageWithinAMemberExpression: false,
		surrMbExp: null
	};

	
}

/**
 * Determines whether an identifier representing a usage of a module variable corresponds
 * to a modification or not.
 * @returns true if identifier is located in a modification expression 
 * (along with the modification expression), false otherwise.
 */
function isIdentifierRepresentingAnElementModification(usageIdentifier) {

	// console.log(`${usageIdentifier.value.name} (line ${usageIdentifier.value.loc.start.line})`);
	let {isUsageWithinAMemberExpression, surrMbExp} = isIdentifierInsideAMemberExpression(usageIdentifier);
	// let modificationNode;
	// console.log(isUsageWithinAMemberExpression);
	if(isUsageWithinAMemberExpression === true) {

		//usage located within a member expression
		//where usageIdentifier is the object
		return {

			isEsModified: false,
			modExp: null
		};

		// if(idParentNode.value.computed === true || idParentNode.value.object === usageIdentifier.value) {

		// 	return false;
		// }
	}
	// else {

	// 	modificationNode = usageIdentifier.value;
	// }

	// let surrExp = null;
	let surrExps = jscodeshift(usageIdentifier).closest(jscodeshift.UpdateExpression);

	//usageIdentifier located in a update expression
	//(do not exit otherwise, need to check about assignments)
	if(surrExps.length > 0 &&
		surrExps.at(0).get().value.argument === usageIdentifier.value) {

		// surrExp = surrExps.at(0).get();

		// console.log('updated');

		return {

			isEsModified: true,
			modExp: surrExps.at(0).get()
		};
	}

	surrExps = jscodeshift(usageIdentifier).closest(jscodeshift.AssignmentExpression);

	//usageIdentifier located in an assignment
	if(surrExps.length > 0) {

		let surrExp = surrExps.at(0).get();

		//filter out results
		//usageIdentifier is the assignment's assigner (exclude)
		if(surrExp.value.right === usageIdentifier.value) {

			return {

				isEsModified: false,
				modExp: null
			};
		}

		//usageIdentifier located in the right operand of surrExp
		//(more generic sol for excluding results)
		let rightOpIds = jscodeshift(surrExp.value.right).find(jscodeshift.Identifier).filter(id => {

			return id.value === usageIdentifier.value;
		});

		if(rightOpIds.length > 0) {

			return {

				isEsModified: false,
				modExp: null
			};
		}

		//usageIdentifier is the left operand of surrExp
		if(surrExp.value.left === usageIdentifier.value) {

			return {

				isEsModified: true,
				modExp: surrExps.at(0).get()
			};
		}
		
		//usageIdentifier located in the left operand of surrExp
		//(more generic sol for retrieving possible modifications inside assignees)
		let leftOpIds = jscodeshift(surrExp.value.left).find(jscodeshift.Identifier).filter(id => {

			return id.value === usageIdentifier.value;
		});

		if(leftOpIds.length > 0) {

			return {

				isEsModified: true,
				modExp: surrExp
			};
		}

		return {

			isEsModified: false,
			modExp: null
		};
	}

	// if(surrExp === null) {

	// 	// surrExps = jscodeshift(usageIdentifier).closest(jscodeshift.AssignmentExpression);
	// }

	// let parentNode = usageIdentifier.parentPath;
	// while(parentNode.value.type !== 'Program') {

	// 	if(parentNode.value.type === 'UpdateExpression' ||
	// 	   (parentNode.value.type === 'AssignmentExpression' && parentNode.value.left === modificationNode)) {

	// 		//usage of imported element included in an update expression
	// 		//(e.g. a++)
	// 		return true;
	// 	}

	// 	parentNode = parentNode.parentPath;
	// }

	// if(parentNodeType === 'UpdateExpression') {
		
	// 	//usageIdentifier is contained in an update expression
	// 	//usageIdentifier represents a modification of a module variable
	// 	return true;
	// }

	// //an imported element is modified if it is directly assigned a value (the modification node is the identifier itself)
	// //if a property is bound to it (the modification node is a member expression)
	// let modificationNode = usageIdentifier;
	// while(parentNode.value.type !== 'MemberExpression' && parentNode.value.type !== 'UpdateExpression') {

	// 	modificationNode = parentNode;
	// 	parentNode = parentNode.parentPath;
	// }

	// if(parentNode.value.type === 'UpdateExpression')

	// parentNode = usageIdentifier.parentPath;
	

	// while(parentNode.value.type !== 'Program') {

	// 	console.log(parentNode.value);
	// 	if(parentNode.value.type === 'AssignmentExpression' && parentNode.value.left === usageIdentifier.parentPath.value) {

	// 		//usageIdentifier is contained in an assignment expression
			
	// 		//is right operand a call expression (call site of require())?
	// 		// rightOperand = parentNode.value.right;
	
	// 		// console.log(rightOperand);
	
	// 		// if(rightOperand.type === 'CallExpression' && 
	// 		//    rightOperand.callee.type === 'Identifier' && rightOperand.callee.name === 'require') {
	
	// 		// 	//usageIdentifier is assigned the result of a call site of require()
	// 		// 	return false;
	// 		// }
	
	// 		return true;
	// 	}

	// 	parentNode = parentNode.parentPath;
	// }

	return false;
}

/**
 * Is usageIdentifier inside a property definition?
 * (<-> is an imported feature's enriched in modules except its definition module?)
 * @returns true (along with the surrounding definition expression) 
 * if usageIdentifier is located in a property definition, false otherwise.
 * @param {*} usageIdentifier 
 */
function isIdentifierLocatedInAPropertyDefinition(usageIdentifier) {

	let {isUsageWithinAMemberExpression, surrMbExp} = isIdentifierInsideAMemberExpression(usageIdentifier);
	
	// console.log(isUsageWithinAMemberExpression);
	if(isUsageWithinAMemberExpression === false) {

		// return false;

		return {

			locatedInPropDef: false,
			surrDefExp: null
		};
	}

	let surrAssignmnentExps = jscodeshift(surrMbExp).closest(jscodeshift.AssignmentExpression);

	if(surrAssignmnentExps.length === 0) {

		return {

			locatedInPropDef: false,
			surrDefExp: null
		};
	}

	let surrAssignmnentExp = surrAssignmnentExps.at(0).get();

	//usageIdentifier located in a member expression which is the left operand
	//of an assignment
	if(surrAssignmnentExp.value.left === surrMbExp.value) {

		return {

			locatedInPropDef: true,
			surrDefExp: surrAssignmnentExp
		};
	}

	return {

		locatedInPropDef: false,
		surrDefExp: null
	};

	// console.log(idParentNode.value.type);

	// let parentNode = idParentNode;

	// while(parentNode.value.type === 'MemberExpression') {

	// 	idParentNode = parentNode;
	// 	parentNode = parentNode.parentPath;
	// }

	// //parentNode: member expression's parentPath
	// //idParentNode: member expression

	// //usageIdentifier inside a member expression (idParentNode)
	// //is member expression inside an assignment where it is the left operand?
	// if(parentNode.value.type === 'AssignmentExpression' &&
	// 	parentNode.value.left === idParentNode.value) {

	// 	return true;
	// }

	// return false;
}

/**
* Retrieves global object properties.
* @param sourceFile
* @returns
*/
function retrieveGlobalObjectPropertiesOfModule(sourceFile) {

	if(fileUtilities.doesFileContainCodeFromExternalLibrary(sourceFile) === true) {

		//do not resolve global object properties in external libraries
		sourceFile.updateGlobalObjectProperties([]);
		return;
	}
	
	// console.log(sourceFile.fileName);
	// console.log(sourceFile.moduleFramework.includes(enums.ModuleFramework.AMD));
	if(sourceFile.sourceVersion === enums.SourceVersion.ES6 ||
	   (sourceFile.sourceVersion === enums.SourceVersion.ES5 && 
		(sourceFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true ||
		 sourceFile.moduleFramework.includes(enums.ModuleFramework.plain)) === true)) {
		
		//client-side js: window is the global object
		retrievePropertiesOfGlobalObject(sourceFile, 'window');
	}
	else {
		
		//server-side: global is the global object
		retrievePropertiesOfGlobalObject(sourceFile, 'global');
	}
	
}

/**
* Retrieves global properties in js code within sourceFile.
The global object (specified by the module's execution environment) is specified by globalObject.
* @param sourceFile
* @returns
*/
function retrievePropertiesOfGlobalObject(sourceFile, globalObject) {
	
	var globalProperties = [];
	var astRootCollection = sourceFile.astRootCollection;
	var globalObjectProperty;
	var definedFunctions = sourceFile.definedFunctions;
	var definedFunction;
	var definedFunctionLoc;
	var definedFunctionLocStart;
	var definedFunctionLocEnd;
	var parentNodeLoc;
	var parentNodeLocStart;
	var parentNodeLocEnd;
	var parentNode;
	var doesFileDefineGlobalObjectPropertiesThroughBracketNotation = false;

	//find member expressions that assign properties to the global object
	var memberExpressions = astRootCollection.find(jscodeshift.MemberExpression).filter(mbExp => {

		return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === globalObject;
	});

	for(let expressionIndex = 0; expressionIndex < memberExpressions.length; expressionIndex++) {

		let memberExpression = memberExpressions.at(expressionIndex).get();
		let memberExpressionValue = memberExpression.value;
		let memberExpressionObject = memberExpressionValue.object.name;
		let memberExpressionProperty = memberExpressionValue.property.name;

		let globalObjectPropertyEnd = memberExpression.value.property.range[memberExpression.value.property.range.length-1];
		
		//the object that gets a new property is window
		//(a global property is introduced when it is assigned a value,
		//namely when the member expression comprises the left operand of an assignment,
		//otherwise it is defined in another module)
		if(memberExpression.parentPath.value.type !== 'MemberExpression') {

			if(memberExpression.value.computed === true) {

				//member expression is computed 
				//the property of the global object is not a literal, but a variable (the global object is indexed with bracket notation)
				console.warn(sourceFile.fileName + " contains a global object property which is \n" +
							 "defined through bracket notation (these properties are not transformed into module variables): " + 
							 (memberExpression.value.property.type === 'Identifier' ? memberExpression.value.property.name : memberExpression.value.property.value) + " \ndefinition line: " + memberExpression.value.loc.start.line + 
							 "\ndefinition column: " + memberExpression.value.loc.start.column);
			}
			
			//exclude cases when properties are bundled in global object properties
			globalObjectProperty = new GlobalObjectProperty.GlobalObjectProperty(memberExpressionProperty, memberExpression.parentPath);

			//check if global property is defined in file (ternjs?)
			// retrieveDefinitionModuleOfGlobalProperty(sourceFile, globalObjectProperty, inputFiles, memberExpression);

			if(memberExpression.parentPath.value.type === 'AssignmentExpression') {

				if(memberExpression.parentPath.value.left === memberExpression.value) {

					//globalObjectProperty is introduced in an assignment expression
					//where the property is assigned a value
					globalObjectProperty.updateIsGlobalPropertyAssignedAValue(true);
				}
				else {

					globalObjectProperty.updateIsGlobalPropertyAssignedAValue(false);
				}
			}
			else {

				globalObjectProperty.updateIsGlobalPropertyAssignedAValue(false);
			}

			globalObjectProperty.updateDefinitionFunction(definedFunction);
			globalProperties.push(globalObjectProperty);
		}
	}
	
	// console.log(sourceFile.fileName);
	// console.log(globalProperties);
	sourceFile.updateGlobalObjectProperties(globalProperties);
}

// /**
//  * Retrieves definition module of propertyName
//  * @param {*} propertyName 
//  * @param {*} inputFiles 
//  */
// function retrieveDefinitionModuleOfGlobalProperty(sourceFile, globalObjectProperty, inputFiles, memberExpression) {

// 	// console.log(globalObjectProperty.propertyDefinitionNode);
// 	// console.log(sourceFile.fileName + " " + globalObjectProperty.propertyName + " " + globalObjectPropertyRange);
// 	var globalObjectPropertyRange = globalObjectProperty.propertyDefinitionNode.value.left.range;
// 	var globalObjectPropertyEnd = globalObjectPropertyRange !== undefined ? globalObjectPropertyRange[globalObjectPropertyRange.length-1] : globalObjectProperty.propertyDefinitionNode.value.left.end;
// 	// console.log(sourceFile.fileName + " " + globalObjectProperty.propertyName + " " + globalObjectPropertyEnd);
// 	// console.log(globalObjectProperty.propertyDefinitionNode.value);
// 	// console.log(memberExpression.value);
// 	var ternServer = new tern.Server({});


// 	// let result = inputFiles.map(inputFile => inputFile.fileName);
// 	// console.log(result);

// 	var fileObjects = [];
// 	inputFiles.forEach(function(inputFile) {

// 		var fileObject = {

// 			type: "full",
// 			name: inputFile.fileName,
// 			text: inputFile.astRootCollection.toSource()
// 		};

// 		fileObjects.push(fileObject);
// 	});
	
// 	// console.log(fileObjects);
// 	let requestDetails = {
// 		query: {

// 			type: "definition",
// 			file: sourceFile.fileName,
// 			end: globalObjectPropertyEnd
// 		},
// 		files: fileObjects,
// 		timeout: 1000
// 	};
	
// 	ternServer.request(requestDetails, function(error, success) {

// 		// console.log(error);
// 		console.log(success);
// 	});
// }

/**
 * Specifies the aliases of the AMD modules specified by the user (if any)
 * @param {*} inputFiles 
 */
function updateSourceFileAliases(inputFiles) {

	let inputFile;
	let astRootCollection;
	let callExpressionCollection;
	let callExpression;
	let calleeArguments;

	//inputFiles is a hashmap (an array of file arrays)
	for(let fileListIndex = 0; fileListIndex < inputFiles.buckets.length; fileListIndex++) {

		let fileList = inputFiles.buckets[fileListIndex];
		
		if(fileList === undefined) {

			//file list is empty - continue to the next file list
			continue;
		}
		for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

			//fileList contains a set of [key, value] pairs
			//key: the file's absolute path
			//value: the file's object that will contain additional information with respect to its code
			inputFile = fileList[fileIndex][1];
			// console.log(inputFile.fileName);
			astRootCollection = inputFile.astRootCollection;
			callExpressionCollection = astRootCollection.find(jscodeshift.CallExpression).filter(path => {

				//user may specify aliases of sourceFiles through a call site of require.config()
				//in a file (search the file with the specific callsite)
				return path.value.callee.type === 'MemberExpression' && 
				   (path.value.callee.object.name === 'require' || path.value.callee.object.name === 'requirejs') &&
				   path.value.callee.property.name === 'config';
			});

			// console.log(callExpressionCollection.length)

			if(callExpressionCollection.length > 0) {

				break;
			}
		}
		
		if(callExpressionCollection != null && callExpressionCollection.length > 0) {

			break;
		}
	};

	if(callExpressionCollection.length === 0) {

		//no file contains the specific callsite
		return;
	}

	//there is a file with the specific callsite
	//analyze callsite (parameters)
	callExpression = callExpressionCollection.at(0).get();
	// console.log(callExpression);
	calleeArguments = callExpression.value.arguments;
	for(let argIndex = 0; argIndex < calleeArguments.length; argIndex++) {

		let callArg = calleeArguments[argIndex];
		if(callArg.type === 'ObjectExpression') {

			//argIndex-th argument of call expression is an object expression
			//retrieve its properties (files mapped to names)
			let objectProperties = callArg.properties;
			for(let propertyIndex = 0; propertyIndex < objectProperties.length; propertyIndex++) {

				let objectProperty = objectProperties[propertyIndex];
				if(objectProperty.key.name === 'paths') {

					//user specifies aliases of source files in the property 'paths'
					let pathObjectExpression = objectProperty.value;
					if(pathObjectExpression.type === 'ObjectExpression') {

						let pathObjectProperties = pathObjectExpression.properties;
						for(let objPropertyIndex = 0; objPropertyIndex < pathObjectProperties.length; objPropertyIndex++) {

							let objProperty = pathObjectProperties[objPropertyIndex];
							let objPropertyKey;
							if(objProperty.key.type === 'Identifier') {

								//key is an identifier (syntax: <identifier> : <value>)
								objPropertyKey = objProperty.key.name;
							}
							else {

								//key is a literal (syntax: <string> : <value>)
								objPropertyKey = objProperty.key.value;
							}
							let objValue = objProperty.value.value;

							if(path.resolve(objValue) !== path.normalize(objValue).replace( RegExp(path.sep+'$'), '' )) {

								//objValue is a relative path
								objValue = './' + objValue;
							}

							//retrieve source file specified by objValue
							//update specific source file with alias specified in objPropertyKey
							let objectFilePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + objValue);
							if(objectFilePath.endsWith('.js') !== true) {

								objectFilePath += '.js';
							}
							// console.log(inputFile.fileName);
							// console.log(objectFilePath);
							let objectFile = inputFiles.retrieveInputFileInMap(objectFilePath);
							// console.log(objPropertyKey)
							// console.log(objectFile === null);
							if(objectFile !== null) {

								//retrieve function returns a pair (key, value)
								objectFile.updateAliasName(objPropertyKey);
								// break;
							}

						}
					}
				}
			}
		}
	}
}

/**
 * In the case that the CommonJS module specified in inputFile exports an object literal
 * through assigning it to exports/module.exports, 
 * the function retrieves the exported object's properties usages
 * (in order to determine whether the object must be destructured during the module's transformation)
 */
function retrieveReferencesOfPropertiesOfExportedObjectLiteral(inputFile) {

	codeHierarchyUtilities.retrieveReferencesOfPropertiesOfExportedObjectLiteral(inputFile);
}

function processGlobalsAndFunctionsDefs(sourceFile, projectTypeIndex, inputFiles) {

	// console.log(inputFile);
	sourceFile.updateSourceVersion(enums.SourceVersion.ES5);

	//retrieve the name of the projectType-th property and, then, retrieve its value
	sourceFile.updateModuleFramework(enums.ModuleFramework[Object.keys(enums.ModuleFramework)[projectTypeIndex]]);
	
	//does not work in cases of files with mixed code (i.e. commonjs with plain js)
	// fileUtilities.retrieveVersionOfCode(sourceFile);
	
	//retrieve functions defined within sourceFile
	try {

		// console.log('s: ' + sourceFile.fileName)

		if(sourceFile.moduleType === enums.ModuleType.library) {

			//external library (applies to client-side code)
			return;
		}

		//retrieve code hierarchy only for project components
		retrieveSourceFileDefinedFunctions(sourceFile);

		// console.log('s: ' + sourceFile.fileName)

		//find explicit globals of a module (variables
		//declared in top-level scope of file)
		//notice: find module variables after module functions
		//(needed in order to connect variables initialized with function expressions
		//with the corresponding defined functions, in order to determine whether they
		//are initialized with cohesive objects)
		retrieveExplicitGlobalsOfSourceFile(sourceFile);

		// console.log('s: ' + sourceFile.fileName)

		// // console.log(sourceFile.astRootCollection.toSource());
		//find the global object properties of a module (global object properties that are explicitly used in module)
		retrieveGlobalObjectPropertiesOfModule(sourceFile);
		//based on the version of the code, search
		//for exported globals within inputFile
		if (sourceFile.moduleType !== enums.ModuleType.library) {
			//file is an external library (do not analyze code - proceed with the next file)
			metricUtilities.retrieveExportedElementsOfModule(sourceFile, inputFiles);

			// //after exported elements are retrieved (and the corresponding module definitions are updated
			// //with their export statements), update properties of exported elements
			// //case: exports/module.exports assigned to definition, then
			// //properties bound to exports/module.exports are the definition's properties
			// sourceFile.updatePropertiesOfExportedElements();

			//since destructuring is only applied in object assigned the export object
			//(not in the exported object properties), we do not
			//retrieve references of the property's inner properties
			// retrieveReferencesOfPropertiesOfExportedObjectLiteral(sourceFile);
			
			// console.log(inputFile.exportedProperties);
			// // console.log(inputFile.fileName + " " + inputFile.exportedProperties.length);
			// inputFile.exportedProperties.forEach(function(exportedProperty) {
			// 	//exportedProperties hold for objects that are assigned to exports/module.exports in CommonJS
			// 	console.log(exportedProperty.objectProperties);
			// });
		}
		// console.log('i: ' + sourceFile.fileName);
	}
	catch (err) {
		//error during finding function hierarchy from file
		//do not analyse input file (remove from list)
		// inputFiles = inputFiles.filter(function(item) {
		// 	return item !== inputFile;
		// });
		console.log(sourceFile.fileName);
		console.log(err);
		inputFiles.removeInputFileFromMap(sourceFile.fileName);
	}
	// console.log(sourceFile.fileName + " " + sourceFile.definedFunctions.length + " " + sourceFile.explicitGlobals.length + " ");
	// console.log(sourceFile.definedFunctions.filter(df => {

	// 	return df.isExported === true;
	// }));
	// console.log(sourceFile.fileName)
	// // console.log(sourceFile.explicitGlobals);
	// console.log(sourceFile.globalObjectProperties);
	// sourceFile.globalObjectProperties.forEach(function(globalObjectProperty) {
	// 	console.log(globalObjectProperty.propertyName);
	// 	console.log(globalObjectProperty.propertyDefinitionNode.value.loc);
	// });

}

function processImpliedGlobals(sourceFile, inputFiles) {

	//based on the version of the code, search
	//for exported globals within inputFile
	if (sourceFile.moduleType !== enums.ModuleType.library) {
		//retrieve implied globals of module (variables used without being defined)
		//cannot be moved up
		//(in case of plain js modules,
		//we need to access the global variables of other modules)
		retrieveImpliedGlobalsOfSourceFile(sourceFile, inputFiles);
		console.log('Implieds in ' + sourceFile.fileName + '(' + sourceFile.impliedGlobals.length + '): ');
		
		let impliedsMsg = '';
		sourceFile.impliedGlobals.forEach(impliedGlobal => {
			impliedsMsg += impliedGlobal.variableName + '\n';
		});

		console.log(impliedsMsg);

		if(sourceFile.impliedGlobals.length === 0) {

			return;
		}

		console.log('For further information, consult ' + './resultFiles/' + sourceFile.fileName.replace(/\\/g, '_').replace(/:/g, '') + '_implieds.json');
	}
}

function analyzeProject(directory, excludedFiles, ignoreTests, testDirectories, projectEntryFileAbsolutePath, framework) {
    var files = [];
	var fileList = fileUtilities.retrieveSourceFilesInDirectory(directory, files, excludedFiles);
	// console.log(fileList);
    var inputFiles = retrieveModuleDefinedInFiles(fileList, excludedFiles, testDirectories, projectEntryFileAbsolutePath);

	var projectTypeIndex = Object.values(enums.ModuleFramework).indexOf(framework);

    if (framework === enums.ModuleFramework.AMD) {
        updateSourceFileAliases(inputFiles);
    }

    inputFiles.buckets.forEach(
		entryArray => entryArray.forEach(
			entry => processGlobalsAndFunctionsDefs(entry[1], projectTypeIndex, inputFiles, excludedFiles, testDirectories))
    );
    
    inputFiles.buckets.forEach(
		entryArray => entryArray.forEach(
			entry => processImpliedGlobals(entry[1], inputFiles))
	);


	//mdgUtilities.createMDG(inputFiles);

    return inputFiles;
}

/**
 * Determines whether explicitGlobal represents a module variable
 * initialized with the result of a require() call.
 * Needed in order to retrieve import-export-import 'chains' in CommonJS modules.
 * @param {*} explicitGlobal 
 */
function isExplicitGlobalInitializedWithCallSiteOfRequire(explicitGlobal) {

	let initializationValueNode = explicitGlobal.initializationValueNode;
	if(initializationValueNode !== null &&
		initializationValueNode.type === 'CallExpression' && 
	   initializationValueNode.callee.type === 'Identifier' && initializationValueNode.callee.name === 'require') {

		return true;
	}

	return false;
}

/**
 * Maps an exported feature to a minimal json object.
 * @param {*} exportedElement the element to minimize
 */
function minimizeExportedFeature(exportedElement) {

	//minimize exportedElement through mapping each property storing an ast node
	//with a property with the same name (to prevent inconsistencies during transformation)
	//to the node's location (a custom object keeping only the node's location-
	//the properties of this object are consistent to the actual ast node)
	//also, I think undefined isn't added to the json file...

	//feature properties (regardless of module framework)
	//implieds
	let creationStatement = exportedElement.creationStatement == null ? 
							undefined : 
							minimizeNode(exportedElement.creationStatement);
	
	//global object property
	let propertyDefinitionNode = exportedElement.propertyDefinitionNode == null ?
								 undefined :
								 minimizeNode(exportedElement.propertyDefinitionNode);

	//imported feature modification
	let modificationFunctions = exportedElement.modificationFunctions == null ?
								undefined :
								exportedElement.modificationFunctions.map(modFunc => {

									return minimizeModificationFunction(modFunc);
								});
	
	//feature properties (module framework-specific)
	//some properties are common
	//(common)
	let elementNode = exportedElement.elementNode == null ?
						undefined :
						minimizeNode(exportedElement.elementNode);

	//object property not a model object, but a custom object
	//(common)
	let objectProperties = exportedElement.objectProperties == null ?
							undefined:
							exportedElement.objectProperties.map(objectProp => {

								return minimizeProperty(objectProp);
							});

	//(common)
	let functionProperties = exportedElement.functionProperties == null ?
							undefined:
							exportedElement.functionProperties.map(funcProp => {

								return minimizeProperty(funcProp);
							});

	//(common)
	let prototypeProperties = exportedElement.prototypeProperties == null ?
							undefined:
							exportedElement.prototypeProperties.map(protProp => {

								return minimizeProperty(protProp);
							});
	
	//AMD
	let returnStatementNode = exportedElement.returnStatementNode == null ?
								undefined :
								minimizeNode(exportedElement.returnStatementNode);						
	
	let surrExpressionNode = exportedElement.surrExpressionNode == null ?
							 undefined :
							 minimizeNode(exportedElement.surrExpressionNode);
	
	//CJS/non-modular ES5
	let functionNode = exportedElement.functionNode == null ?
						undefined :
						minimizeNode(exportedElement.functionNode);
	
	let exportedFunctionNode = exportedElement.exportedFunctionNode == null ?
								undefined :
								minimizeNode(exportedElement.exportedFunctionNode);
	
	let initializationValueNode = exportedElement.initializationValueNode == null ?
									undefined :
									minimizeNode(exportedElement.initializationValueNode);
	
	let variableDeclarationNode = exportedElement.variableDeclarationNode == null ?
									undefined :
									minimizeNode(exportedElement.variableDeclarationNode);
	
	let exportedVariableNode = exportedElement.exportedVariableNode == null ?
								undefined :
								minimizeNode(exportedElement.exportedVariableNode);
									
	/**
	 * disconnect returned object from actual exportedElement, since
	 * it is used in import deps which are processed before insertion to json file
	 * (after generating object, update it 
	 * with all other properties of exportedElement!)
	 * (disconnection from the actual feature (but not from exportedElement!) 
	 * is also applied during the creation of import dep objects)
	 * don't change name of properties (prevent name inconsistencies)
	 */
	let resultObj = {

		creationStatement: creationStatement,
		propertyDefinitionNode: propertyDefinitionNode,
		modificationFunctions: modificationFunctions,
		elementNode: elementNode,
		returnStatementNode: returnStatementNode,
		objectProperties: objectProperties,
		functionProperties: functionProperties,
		prototypeProperties: prototypeProperties,
		surrExpressionNode: surrExpressionNode,
		functionNode: functionNode,
		exportedFunctionNode: exportedFunctionNode,
		initializationValueNode: initializationValueNode,
		variableDeclarationNode: variableDeclarationNode,
		exportedVariableNode: exportedVariableNode
	};

	//update resultObj with all other properties of exportedElement
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of exportedElement that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(exportedElement).filter(propName => {

		if((exportedElement[propName] == null ||
			typeof exportedElement[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = exportedElement[expElPropName];
	});

	return resultObj;
}

/**
 * Maps a (static/object instance shared) property to a minimal json object.
 * @param {*} propObj the property to minimize
 */
function minimizeProperty(propObj) {

	//object property not a model object, but a custom object
	//consult ObjectProperty.mapObjectPropertyToRefJSONObj() or
	//FunctionProperty.mapFunctionPropertyToRefJSONObj()
	//(these provide objects of similar data types-
	//maybe I should unify these data types some time, 
	//since they specify object instance shared or object properties)
	let propertyName = propObj.propertyName;
	let propertyAlias = propObj.propertyAlias;
	// console.log(propertyName);
	// console.log(propObj.propertyDefinitionNode);
	let propertyDefinitionNode = minimizeNode(propObj.propertyDefinitionNode);
	let propertyValue = propObj.propertyValue == null ?
						undefined :
						minimizeNode(propObj.propertyValue);

	let isExported = propObj.isExported;
	let functionPropertyUsages = propObj.functionPropertyUsages == null ?
								 undefined :
								 propObj.functionPropertyUsages.map(funcPropUse => {

									return minimizeNode(funcPropUse);
								 });

	let objectPropertyUsages = propObj.objectPropertyUsages == null ?
								undefined :
								propObj.objectPropertyUsages.map(objPropUse => {

									return minimizeNode(objPropUse);
								});

	return {

		propertyName: propertyName,
		propertyAlias: propertyAlias,
		propertyDefinitionNode: propertyDefinitionNode,
		propertyValue: propertyValue,
		isExported: isExported,
		functionPropertyUsages: functionPropertyUsages,
		objectPropertyUsages: objectPropertyUsages,
	};
}

/**
 * Maps a module dependency to a minimal json object.
 * Needed for import deps.
 * @param {*} moduleDependency the dependency to minimize
 */
function minimizeModuleDependency(moduleDependency) {

	//moduleDependency: MDGEdge
	//ImportedElement | ImportedNamespace | ImportedModule
	let accessedElement = moduleDependency.accessedElement == null ?
							undefined :
							minimizeImportedFeature(moduleDependency.accessedElement);

	let usageSet = moduleDependency.usageSet == null ?
					undefined :
					moduleDependency.usageSet.map(usage => {

						return minimizeNode(usage);
					});

	let resultObj = {

		accessedElement: accessedElement,
		usageSet: usageSet
	};

	//update resultObj with all other properties of moduleDependency
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of moduleDependency that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(moduleDependency).filter(propName => {

		if((moduleDependency[propName] == null ||
			typeof moduleDependency[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = moduleDependency[expElPropName];
	});

	return resultObj;
}

/**
 * Maps an imported feature to a minimal json object.
 * Needed for import deps where imported feature is used without modification.
 * @param {*} importedElement the element to minimize
 * @returns {*} a custom minimized object
 */
function minimizeImportedFeature(importedElement) {

	//minimize importedElement through mapping each property storing an ast node
	//with a property with the same name (to prevent inconsistencies during transformation)
	//to the node's location (a custom object keeping only the node's location-
	//the properties of this object are consistent to the actual ast node)
	//also, I think undefined isn't added to the json file...
	let importedElementNodes = importedElement.importedElementNodes.map(impElNode => {

		return minimizeNode(impElNode);
	});

	let modificationFunctions = importedElement.modificationFunctions.map(modFunc => {

		return minimizeModificationFunction(modFunc);
	});

	let functionProperties = importedElement.functionProperties == null ?
							 undefined : 
							 importedElement.functionProperties.map(funcProp => {
								 
								return minimizeProperty(funcProp);
							 });

	let objectProperties = importedElement.objectProperties == null ?
							undefined :
							importedElement.objectProperties.map(objProp => {

								return minimizeProperty(objProp);
							});

	let prototypeProperties = importedElement.prototypeProperties == null ?
								undefined :
								importedElement.prototypeProperties.map(protProp => {

									return minimizeProperty(protProp);
								});

	let accessedProperties = importedElement.accessedProperties == null ?
								undefined :
								importedElement.accessedProperties.map(accessedProp => {

									return minimizeProperty(accessedProp);
								});

	let usageSet = importedElement.usageSet.map(usage => {

		return minimizeNode(usage);
	});

	/**
	 * disconnect returned object from actual exportedElement, since
	 * it is used in import deps which are processed before insertion to json file
	 * (after generating object, update it 
	 * with all other properties of exportedElement!)
	 * (disconnection from the actual feature (but not from exportedElement!) 
	 * is also applied during the creation of import dep objects)
	 * don't change name of properties (prevent name inconsistencies)
	 */
	let resultObj = {

		importedElementNodes: importedElementNodes,
		modificationFunctions: modificationFunctions,
		functionProperties: functionProperties,
		objectProperties: objectProperties,
		prototypeProperties: prototypeProperties,
		accessedProperties: accessedProperties,
		usageSet: usageSet
	};

	//update resultObj with all other properties of importedElement
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of importedElement that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(importedElement).filter(propName => {

		if((importedElement[propName] == null ||
			typeof importedElement[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = importedElement[expElPropName];
	});

	return resultObj;
}

/**
 * Maps an encapsulated feature to a minimal json object.
 * @param {*} encFeatObj a custom object specifying the element to minimize
 */
function minimizeEncapsulatedFeature(encFeatObj) {

	//minimize encFeatObj through mapping each property storing an ast node
	//with a property with the same name (to prevent inconsistencies during transformation)
	//to the node's location (a custom object keeping only the node's location-
	//the properties of this object are consistent to the actual ast node)
	//also, I think undefined isn't added to the json file...
	let elementNode = minimizeNode(encFeatObj.elementNode);
	let exportNode = minimizeNode(encFeatObj.exportNode);
	let elementReferences = encFeatObj.elementReferences == null ?
							undefined :
							encFeatObj.elementReferences.map(elemRef => {

								return minimizeNode(elemRef);
							});

	//consult SourceFile.addEncapsulationAndRedundancyDepsInModuleDependencyList()
	//for the type of encFeatObj
	let resultObj = {

		elementNode: elementNode,
		exportNode: exportNode,
		elementReferences: elementReferences
	};

	//update resultObj with all other properties of encFeatObj
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of encFeatObj that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(encFeatObj).filter(propName => {

		if((encFeatObj[propName] == null ||
			typeof encFeatObj[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = encFeatObj[expElPropName];
	});

	return resultObj;
}

/**
 * Maps an encapsulated feature to a minimal json object.
 * @param {*} encFeatObj a custom object specifying the import to minimize
 */
function minimizeEncapsulatedFeatureImport(encFeatImpObj) {

	//minimize encFeatImpObj through mapping each property storing an ast node
	//with a property with the same name (to prevent inconsistencies during transformation)
	//to the node's location (a custom object keeping only the node's location-
	//the properties of this object are consistent to the actual ast node)
	//also, I think undefined isn't added to the json file...
	let importNode = minimizeNode(encFeatImpObj.importNode);

	//consult SourceFile.addEncapsulationAndRedundancyDepsInModuleDependencyList()
	//for the type of encFeatImpObj
	let resultObj = {

		importNode: importNode
	};

	//update resultObj with all other properties of encFeatObj
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of encFeatObj that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(encFeatImpObj).filter(propName => {

		if((encFeatImpObj[propName] == null ||
			typeof encFeatImpObj[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = encFeatImpObj[expElPropName];
	});

	return resultObj;
}

/**
 * Maps a modification function object to a minimal json object.
 * @param {*} modFuncObj a custom object specifying the import to minimize
 */
function minimizeModificationFunction(modFuncObj) {

	//[{modificationFunctionName: <String>, modificationFunctionBodyStatements: [<ASTNode.value>]}]
	//consult mdgUtilities.retrieveModuleDependenciesOfModule()
	//NOTICE: do not minimize modification statement nodes (they must be inserted in another function
	//as-is)
	let modificationFunctionBodyStatements = modFuncObj.modificationFunctionBodyStatements == null ?
												undefined :
												modFuncObj.modificationFunctionBodyStatements;

	let resultObj = {

		modificationFunctionBodyStatements: modificationFunctionBodyStatements
	};

	//update resultObj with all other properties of modFuncObj
	//consider the properties I defined, not built-in properties
	//(check: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Enumerability_and_ownership_of_properties)
	//edge cases w.r.t. overwritting native properties do not exist

	//find the properties of modFuncObj that 
	//(a) do not have an undefined/null/function value
	//(b) are not yet defined in resultObj (avoid overwrites in already defined properties)
	let expElPropNames = Object.getOwnPropertyNames(modFuncObj).filter(propName => {

		if((modFuncObj[propName] == null ||
			typeof modFuncObj[propName] === 'function') ||
			Object.getOwnPropertyNames(resultObj).find(resPropName => {

			return resPropName === propName;

		}) != undefined) {

			return false;
		}

		return true;
	});

	//copy all these properties to resultObj
	expElPropNames.forEach(expElPropName => {

		resultObj[expElPropName] = modFuncObj[expElPropName];
	});

	return resultObj;
}

/**
 * Minimizes an AST node, by returning an object with its location,
 * keeping the properties of the respective object in the node unchanged
 * (prevent inconsistencies).
 * Useful for generating minimal json files and preventing memory overflows.
 * @param {*} astNode the AST node to be minimized
 */
function minimizeNode(astNode) {

	//in case of an invalid node, return undefined 
	//(don't fill json file with invalid values)
	if(astNode == null) {

		return undefined;
	}

	//1-1 mapping between ast nodes and locations
	//NOTICE: some ast nodes (e.g. literals) have a property named 'value'
	//(not identical to the ast node's internal value property)
	let astNodeLoc = (astNode.value != null && astNode.value.type != null) ? 
						astNode.value.loc : 
						astNode.loc;

	//useful for querying the AST for nodes of unknown type
	let nodeType = (astNode.value != null && astNode.value.type != null) ? 
					astNode.value.type : 
					astNode.type;

	// console.log(astNode);
	
	return {

		type: nodeType,
		loc: astNodeLoc == null ? undefined : {

			start: {

				line: astNodeLoc.start.line,
				column: astNodeLoc.start.column
			},

			end: {

				line: astNodeLoc.end.line,
				column: astNodeLoc.end.column
			}
		}

	};
}

//functionality for minimizing AST nodes for json files
exports.minimizeExportedFeature = minimizeExportedFeature;
exports.minimizeModuleDependency = minimizeModuleDependency;
exports.minimizeImportedFeature = minimizeImportedFeature;
exports.minimizeModificationFunction = minimizeModificationFunction;
exports.minimizeProperty = minimizeProperty;
exports.minimizeEncapsulatedFeature = minimizeEncapsulatedFeature;
exports.minimizeEncapsulatedFeatureImport = minimizeEncapsulatedFeatureImport;
exports.minimizeNode = minimizeNode;

exports.loadFilesOnTernServer = loadFilesOnTernServer;
exports.removeFilesFromTernServer = removeFilesFromTernServer;
exports.retrieveEnclosingScope = retrieveEnclosingScope;
// exports.retrieveLocalVariablesOfFunction = retrieveLocalVariablesOfFunction;
exports.retrieveSourceFileDefinedFunctions = retrieveSourceFileDefinedFunctions;
exports.retrieveSourcefileDefinedClasses = retrieveSourcefileDefinedClasses;
exports.retrieveImpliedGlobalsOfSourceFile = retrieveImpliedGlobalsOfSourceFile;
exports.createASTOfModule = createASTOfModule;
exports.retrieveModuleDefinedInFiles = retrieveModuleDefinedInFiles;
exports.retrieveExplicitGlobalsOfSourceFile = retrieveExplicitGlobalsOfSourceFile;
exports.isIdentifierRepresentingAnElementModification = isIdentifierRepresentingAnElementModification;
exports.isIdentifierLocatedInAPropertyDefinition = isIdentifierLocatedInAPropertyDefinition;
exports.retrieveGlobalObjectPropertiesOfModule = retrieveGlobalObjectPropertiesOfModule;
exports.updateSourceFileAliases = updateSourceFileAliases;
exports.retrieveReferencesOfPropertiesOfExportedObjectLiteral = retrieveReferencesOfPropertiesOfExportedObjectLiteral;
exports.isExplicitGlobalInitializedWithCallSiteOfRequire = isExplicitGlobalInitializedWithCallSiteOfRequire;
exports.processGlobalsAndFunctionsDefs = processGlobalsAndFunctionsDefs;
exports.processImpliedGlobals = processImpliedGlobals;
exports.analyzeProject = analyzeProject;