/**
 * http://usejsdoc.org/
 */

var path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

var commonUtilities = require('../commonUtilities.js');

var SourceFile = require('../../ast/model/sourceFile.js');
var ImportedElement = require('../../ast/model/importedElement.js');
var ImportedNamespace = require('../../ast/model/importedNamespace.js');
var ImportedModule = require('../../ast/model/importedModule.js');
var Variable = require('../../ast/model/variable.js')
var FunctionDeclaration = require('../../ast/model/functionDeclaration.js');
var ObjectLiteral = require('../../ast/model/objectLiteral.js');

var fileUtilities = require('../../../io/fileUtilities.js');
var enums = require('../../ast/util/enums.js');

//used to retrieve the number of the distinct AMD modules that are imported 
//(referenced in a callsite of require() or define()) in the analyzed system
var distinctImportedModules = [];
exports.distinctImportedModules = distinctImportedModules;

//used to retrieve the number of the distinct AMD external (not located in the system under analysis) 
//that are imported (referenced in a callsite of require() or define()) in the analyzed system
var distinctImportedExternalModules = [];
exports.distinctImportedExternalModules = distinctImportedExternalModules;

//used to retrieve the number of the AMD import statements that are located in the analyzed system
//(#call sites of require() or define())
var systemImportStatements = [];
exports.systemImportStatements = systemImportStatements;

/**
 * Is sourceFile an AMD module?
 * @param sourceFile
 * @returns
 */
function isSourceFileAnAMDModule(sourceFile) {
	
	var isAMDModule = false;
	
	//(i) does sourceFile contain import statements with the AMD syntax?
	//update: a js function can be called with parameters that are fewer than the specified arguments
	var importStatements = getImportStatementsOfAMDModule(sourceFile);
	var requireCallArguments;
	
	for(var statementIndex = 0; statementIndex < importStatements.length; statementIndex++) {
		
		var requireCall = importStatements[statementIndex];
		requireCallArguments = requireCall.value.arguments;
		if(requireCallArguments.length > 1 ||
		   (requireCallArguments.length === 1 && requireCallArguments[0].type === 'ArrayExpression')) {
			
			//sourceFile contains AMD import declarations -
			//it is an AMD module
			sourceFile.updateSourceVersion(enums.SourceVersion.ES5);
			sourceFile.updateModuleFramework(enums.ModuleFramework.AMD);
			return true;
		}
	}
	
	//(ii) does sourceFile contain exports statements with the AMD syntax?
	var exportStatements = getExportStatementsOfAMDModule(sourceFile);
	// console.log(sourceFile.fileName + " " + exportStatements.length);

	// console.log(sourceFile.retrieveDefinedFunctionByName('define'));

	//case: CommonJS defines a function named 'define'
	if(exportStatements.length > 0 && sourceFile.retrieveDefinedFunctionByName('define') === null) {
		
		//sourceFile contains AMD export declarations -
		//it is an AMD module
		sourceFile.updateSourceVersion(enums.SourceVersion.ES5);
		sourceFile.updateModuleFramework(enums.ModuleFramework.AMD);
		return true;
	}
	
	return false;
}

/**
 * Retrieves import statements in sourceFile (calls to require()).
 * @param sourceFile
 * @returns
 */
function getImportStatementsOfAMDModule(sourceFile) {
	
	//retrieve callexpressions
	var callExpressions = sourceFile.astRootCollection.find(jscodeshift.CallExpression);
	var importStatements = [];
	
	callExpressions.forEach(function(callExpression) {
		
		//retrieve name of callee function of callExpression
		var calleeName = callExpression.value.callee.name;
		
		if(calleeName === 'require' || calleeName === 'requirejs') {
			
			importStatements.push(callExpression);
		}
	});
	
	return importStatements;
}

/**
 * Retrieves export statements in sourceFile (calls to define()).
 * @param sourceFile
 * @returns
 */
function getExportStatementsOfAMDModule(sourceFile) {
	
	var callExpressions = sourceFile.astRootCollection.find(jscodeshift.CallExpression);
	
	var exportStatements = [];
	
	callExpressions.forEach(function(callExpression) {
		
		var argumentsArray = callExpression.value.arguments;
		// console.log(argumentsArray);
		
		//retrieve name of callee function of callExpression
		var calleeName = callExpression.value.callee.name;
		
//		if(calleeName === 'define' && argumentsArray.length === 3) {
		
		//case: the first two arguments of define() are optional according to the specs
		//(https://github.com/amdjs/amdjs-api/wiki/AMD)
		if(calleeName === 'define' && argumentsArray.length >= 1) {
			
			exportStatements.push(callExpression);
		}
		
//		if(calleeName === 'define') {
//			
//			
//			exportStatements.push(callExpression);
//		}
	});
	
//	console.log(exportStatements.length);
	return exportStatements;
	
//	console.log(callExpressions.length);
//	return callExpressions;
}

/**
 * Returns functions of builtin functions (define()/require()/requirejs())
 * in sourceFile. Excludes invokations with invalid arguments.
 * @param {*} sourceFile 
 */
function retrieveBuiltinFunctionInvocations(sourceFile) {

	//retrieve statements containing invocations of define()/require()/requirejs()
	//exclude statements that:
	//(a) do not invoke the aforementioned functions or
	//(b) invoke one of the functions, but with no or with invalid args (module dependence array does not contain literals (statically defined dependencies))
	let requireDefineInvocationStmts = sourceFile.astRootCollection.find(jscodeshift.ExpressionStatement).filter(stmt => {

		if(stmt.value.expression.type !== 'CallExpression') {

			return false;
		}

		let callExp = stmt.value.expression;
		let calleeFunc = callExp.callee;
		if(calleeFunc.type !== 'Identifier') {

			return false;
		}

		let calleeFuncName = calleeFunc.name;
		if(calleeFuncName !== 'requirejs' &&
			calleeFuncName !== 'require' &&
			calleeFuncName !== 'define') {

			return false;
		}
			
		//invoked functions: define()/require()/requirejs()
		let calleeArguments = callExp.arguments;
		if((calleeFuncName === 'define' && calleeArguments.length < 1) ||
			((calleeFuncName === 'require' || calleeFuncName === 'requirejs') &&
			calleeArguments.length < 1)) {

			return false;
		}

		//retrieve the module dependency list (exclude invalid statements)
		//(a) 1st argument of require()/requirejs() (mandatory)
		//(b) 1st/2nd argument of define() (module id in define() is optional) (optional)
		let moduleDependencyList = [];
		if(calleeFuncName === 'requirejs' || calleeFuncName === 'require') {

			if(calleeArguments[0].type !== 'ArrayExpression') {

				return false;
			}

			moduleDependencyList = calleeArguments[0].elements;
		}
		else {

			moduleDependencyList = 
				calleeArguments[0].type === 'ArrayExpression' ? 
					calleeArguments[0].elements : 
					(calleeArguments.length > 1 && calleeArguments[1].type === 'ArrayExpression' ? 
						calleeArguments[1].elements : []);
		}

		//define() invocation - valid when:
		//(a) does not contain any module dependencies
		//(b) module dependencies are statically defined
		if(calleeFunc === 'define' && moduleDependencyList.length === 0) {

			return true;
		}

		// console.log(sourceFile.fileName);
		// console.log(calleeArguments[0]);
		let depAliases = moduleDependencyList.filter(md => {

			return md.type !== 'Literal';
		});

		if(depAliases.length > 0) {

			return false;
		}

		return true;

	});

	return requireDefineInvocationStmts;
}

/**
 * Retrieves the imported modules of an AMD module
 * @returns
 */
function retrieveModulesRequiredInAMDModule(sourceFile, inputFiles) {

	//retrieve statements containing invocations of define()/require()/requirejs()
	//exclude statements that:
	//(a) do not invoke the aforementioned functions or
	//(b) invoke one of the functions, but with no or with invalid args (module dependence array does not contain literals (statically defined dependencies))
	let requireDefineInvocationStmts = retrieveBuiltinFunctionInvocations(sourceFile);
	
	let requiredModules = [];

	// console.log(sourceFile.fileName)
	
	requireDefineInvocationStmts.forEach(stmt => {
		
		let requiredModuleObject = {};

		let callExpression = stmt.value.expression;
		let calleeName = callExpression.callee.name;
		let argumentModules;

		let calleeArguments = callExpression.arguments;

		// console.log(callExpression);
		// console.log(calleeArguments)
		
		if(calleeName === 'require' || calleeName === 'requirejs') {
			
			systemImportStatements.push(stmt);
			
			//penultimate argument to require() corresponds to the array of modules 
			//that the module to be defined depends on (module dependencies)
			argumentModules = calleeArguments[0].elements;
			
			argumentModules.forEach(argumentModule => {
				
				//retrieve file containing the definition of argumentModule
				var definitionFile = findDeclaringFileOfAMDModule(argumentModule.value, sourceFile, inputFiles);

				if(definitionFile === null) {

					return;
				}

				requiredModuleObject = {

					requiredModuleName: argumentModule.value,
					requiredModulePath: definitionFile.fileName,
					callExpression : callExpression
				};

				requiredModules.push(requiredModuleObject);
			});
			
			return;
		}
		
		//arguments of define():
		//(i) name of the module to be defined (optional)
		//(ii) array of modules on which the defined module is depended on (optional)
		//(iii) callback function handling the defined module / object literal (exported from module)
		calleeArguments = callExpression.arguments;

		//define() invocation with 1 argument (no module dependency array)
		if(calleeArguments.length < 2) {

			return;
		}

		argumentModules = calleeArguments[calleeArguments.length-2];

		if(argumentModules.type !== 'ArrayExpression') {

			return;
		}

		systemImportStatements.push(stmt);

		//retrieve module dependency in inputFiles
		argumentModules.elements.forEach(moduleDependency => {

			let definitionFile = findDeclaringFileOfAMDModule(moduleDependency.value, sourceFile, inputFiles);
			// console.log(definitionFile !== null ? definitionFile.fileName : null);

			//moduleDependency does not represent an existing module
			if(definitionFile === null) {

				return;
			}

			systemImportStatements.push(stmt);

			requiredModuleObject = {

				requiredModuleName: moduleDependency.value,
				requiredModulePath: definitionFile.fileName,
				callExpression : callExpression
			};

			requiredModules.push(requiredModuleObject);
		});
	});

	// console.log(requiredModules);

	sourceFile.addModuleDependencies(requiredModules);
	return requiredModules;
}

/**
 * Retrieves the definition file of an AMD module.
 * @param moduleDependency
 * @param inputFiles
 * @returns
 */
function findDeclaringFileOfAMDModule(moduleDependency, sourceFile, inputFiles) {
	
	// console.log(moduleDependency);

	//update: what if AMD modules are defined without names?
	//(they are referenced through paths to their definition files)
	// var modulePath = path.resolve(path.dirname(sourceFile.fileName) + "\\" + moduleDependency.replace(/\//g, "\\"));
	// var modulePath = moduleDependency.replace(/\//g, "\\");

	var modulePath = moduleDependency;
	if(modulePath.startsWith('.') === true) {

		//moduleDependency is a relative path
		let specifiedModulePath = path.resolve(path.dirname(sourceFile.fileName) + path.sep + modulePath);
		let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
		return importFile;
		// modulePath = modulePath.split('.').join("");
	}

	modulePath = moduleDependency.replace(/\//g, path.sep);

	// console.log(sourceFile.fileName);
	// console.log(modulePath);
	// console.log();
	for(let bucketIndex = 0; bucketIndex < inputFiles.buckets.length; bucketIndex++) {

		let fileList = inputFiles.buckets[bucketIndex];
		if(fileList === undefined) {

			//fileList does not contain any pairs
			//continue to the next file list
			continue;
		}
		for(var fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
		
			//fileList contains a set of [key, value] pairs for each module
			var inputFile = fileList[fileIndex][1];
			// console.log(inputFile.doesFileContainDefinitionOfModule(moduleDependency));
	
			// console.log(sourceFile.fileName);
			// console.log(inputFile.fileName + " " + moduleDependency);
			// console.log(fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile) === false);
			// console.log(inputFile.fileName.toLowerCase().includes(modulePath.toLowerCase()));
			// console.log(inputFile.fileName + " " + inputFile.fileName.toLowerCase().indexOf(modulePath.toLowerCase()));
			// console.log(inputFile.aliasName + " " + moduleDependency + " " + inputFile.fileName.toLowerCase() + " " + modulePath.toLowerCase());
	
			// if((inputFile.aliasName !== null && inputFile.aliasName === moduleDependency) || (sourceFile !== inputFile && (inputFile.doesFileContainDefinitionOfModule(moduleDependency) !== -1 ||
			//    ( fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile) === false && 
			// 	inputFile.fileName.toLowerCase().includes(modulePath.toLowerCase()) === true)))) {
				
			// 	// definitionFile = inputFile;
			// 	// break;
	
			// 	return inputFile;
			// }

			// console.log(inputFile.fileName + ' ' + inputFile.aliasName);
			let absolutePathWithoutExt = path.dirname(inputFile.fileName) + path.sep + path.basename(inputFile.fileName, '.js');
			let modulePathWIthoutExt = path.dirname(inputFile.fileName)  + path.sep + path.basename(modulePath, '.js');
			// console.log(absolutePathWithoutExt + ' ' + modulePathWIthoutExt);
			if((inputFile.aliasName !== null && inputFile.aliasName === moduleDependency) || (sourceFile !== inputFile && (inputFile.doesFileContainDefinitionOfModule(moduleDependency) !== -1 ||
			   ( fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile) === false && 
				absolutePathWithoutExt.toLowerCase().endsWith(modulePathWIthoutExt.toLowerCase()) === true)))) {
				
				// definitionFile = inputFile;
				// break;
	
				return inputFile;
			}
		}
	}
	
	return null;
}

/**
 * Calculates the efferent coupling of an AMD module (#modules an AMD module depends on)
 * @returns
 */
// function calculateEfferentCouplingOfAMDModule(sourceFile, inputFiles) {
	
// 	//retrieve callexpressions to require()
// 	var requiredModules = retrieveModulesRequiredInAMDModule(sourceFile, inputFiles);
	
// //	console.log(requiredModules);
	
// 	sourceFile.addModuleDependencies(requiredModules);
// 	return requiredModules.length;
// }

// /**
//  * Calculates the afferent coupling of an AMD module (#modules that depend on an AMD module)
//  * @param astRootCollection
//  * @returns
//  */
// function calculateAfferentCouplingOfAMDModule(inputFiles, sourceFile) {
	
// 	//defined module exported via define()
// //	console.log(sourceFile.definedModules);
	
	
// 	//afferent coupling: #modules that depend on the module defined in sourceFile
// 	//check if any inputFile requires a module that is defined within sourceFile
// 	var requiredModules = [];
// 	inputFiles.forEach(function(inputFile) {
		
// 		var importedModules = retrieveModulesRequiredInAMDModule(inputFile, inputFiles);
// //		console.log(inputFile.fileName + " " + importedModules);
// 		importedModules.forEach(function(importedModule) {
// 			if(sourceFile.fileName.includes(importedModule.requiredModulePath) === true && requiredModules.indexOf(inputFile.fileName) === -1) {
// 				requiredModules.push(inputFile.fileName);
// 			}
// 		});

// 	})
	
// //	console.log(sourceFile.fileName);
// //	console.log(requiredModules);
	
// 	sourceFile.updateDependentModules(requiredModules);
// 	return requiredModules.length;
// }

/**
 * Returns the callbacks defined within invocations of builtin AMD functions
 * (define()/requirejs()/require()).
 * @param {*} sourceFile 
 */
function retrieveCallBacksOfBuiltinFunctionInvocations(sourceFile) {

	let builtinFunctionInvocationStmts = sourceFile.astRootCollection.find(jscodeshift.ExpressionStatement).filter(stmt => {

		if(stmt.value.expression.type !== 'CallExpression') {

			return false;
		}

		let callee = stmt.value.expression.callee;
		if(callee.type !== 'Identifier') {

			return false;
		}

		return callee.name === 'define' || 
				callee.name === 'requirejs' || 
				callee.name === 'require';
	});

	return builtinFunctionInvocationStmts;
}

/**
 * Retrieves the exported definitions (variables/functions/exportedProperties) of an AMD module.
 * @param sourceFile: the AMD module.
 * @returns
 */
function retrieveExportedVariablesAndFunctionsOfAMDModule(sourceFile) {
	
	// console.log(sourceFile.fileName);

	//(a) no formal mechanism exporting globals/top-level functions (external to define()/require())
	//all globals and top-level functions are marked as exported

	//mark all top-level scope variables as global (and thus accessible to other modules)
	sourceFile.explicitGlobals.forEach(explicitGlobal => {
		
		explicitGlobal.updateIsExported(true);
	});

	let exportedProperties = [];
	let builtinFunctionInvocationStmts = retrieveCallBacksOfBuiltinFunctionInvocations(sourceFile);

	// console.log(builtinFunctionInvocationStmts.length);

	//retrieve define() invocations with at least 1 argument
	let defineInvocationStmts = builtinFunctionInvocationStmts.filter(stmt => {

		let defineInvocation = stmt.value.expression;

		if(defineInvocation.callee.name !== 'define') {

			return false;
		}

		let defineInvocationArgs = defineInvocation.arguments;
		if(defineInvocationArgs.length === 0) {

			return false;
		}

		return true;
	});

	// console.log(defineInvocationStmts.length);

	//mark all top-level scope functions 
	//(outside builtin function invocations) as global
	let moduleFunctions = sourceFile.definedFunctions.filter(definedFunction => {

		if(definedFunction.functionScope !== null ||
			definedFunction.functionName === 'topLevelScope') {

			return false;
		}

		//retrieve the define()/require()/requirejs() invocations 
		//containing definedFunction as a callback
		let stmtsContainingModuleFuncCallbacks = builtinFunctionInvocationStmts.filter(stmt => {

			let callbackFuncDef = stmt.value.expression.arguments[stmt.value.expression.arguments.length-1];
			if(definedFunction.functionNode.value === callbackFuncDef) {

				return true;
			}
		});

		//definedFunction a callback (located in invocation of define()/require()/requirejs())
		if(stmtsContainingModuleFuncCallbacks.length > 0) {

			return false;
		}

		//definedFunction not a callback
		return true;
	});

	// console.log(moduleFunctions.length);
	moduleFunctions.forEach(moduleFunc => {

		moduleFunc.updateIsExported(true);
	});

	//(b) mark the returned element (variable/function/object literal/value) 
	//of callback of define()/require() as exported

	defineInvocationStmts.forEach(defineInvocationStmt => {

		let defineInvocation = defineInvocationStmt.value.expression;

		//the last argument of define() instantiates the object that is visible beyond sourceFile
		//(a) callback function (FunctionExpression)
		//(b) object literal (exported module object)
		let instantiationObj = defineInvocation.arguments[defineInvocation.arguments.length-1];
	
		// console.log(instantiationObj);

		//(a)
		//mark the definition (variable/function/object literal) returned from instantiationObj as exported
		if(instantiationObj.type === 'FunctionExpression') {

			let callbackFunction = sourceFile.retrieveDefinedFunctionByNode(instantiationObj);
			// console.log(callbackFunction.functionNode.value.loc)
			if(callbackFunction === null) {

				return;
			}

			//mark the definition returned from callbackFunction as exported
			let returnedElementDef = callbackFunction.returnedElementDeclaration;
			// console.log(returnedElementDef);
			if(returnedElementDef === null) {

				return;
			}

			// console.log(returnedElementDef.objectExpressionASTNode.loc);
			returnedElementDef.updateIsExported(true);
			return;
		}

		//(b)
		if(instantiationObj.type === 'ObjectExpression') {

			let objectLiteral = new ObjectLiteral.ObjectLiteral(instantiationObj);
			objectLiteral.retrievePropertiesOfObjectLiteral();
			objectLiteral.updateIsExported(true);
			objectLiteral.updateIsCohesive(false);

			exportedProperties.push(objectLiteral);
		}
	});

	sourceFile.updateExportedProperties(exportedProperties);

	// console.log(sourceFile.fileName);
	// console.log(sourceFile.exportedProperties);
	// console.log(sourceFile.explicitGlobals.filter(expGlob => {

	// 	return expGlob.isExported === true;
	// }).length)
}

/**
 * Retrieves the imported elements of an AMD module.
 * @param sourceFile: the AMD module.
 * @returns
 */
function retrieveImportedElementsOfAMDModule(inputFiles, sourceFile) {
	
	//no formal mechanism for importing global variables and functions
	//(AMD uses define() and require() to export and to import modules - def-use algorithm)

	// console.log(sourceFile.fileName + ' ' + sourceFile.moduleType);
	//do not retrieve imported elements of an external library
	if(sourceFile.moduleType === enums.ModuleType.library) {

		return;
	}
	
	//retrieve the elements imported in sourceFile
	retrieveImportedVariableAndFunctionsSetsOfAMDModule(inputFiles, sourceFile);

	// console.log(sourceFile.fileName + ' ' + sourceFile.moduleType);

	//retrieve the usages of the variables imported in sourceFile
	retrieveUsedGlobalIdentifiersInSourceFile(inputFiles, sourceFile);

	//right after retrieving imported elements and their usages,
	//are these elements iterated in the modules they're imported?
	sourceFile.updateObjectReferencedImportedDefinitions();
}

function retrieveUsedGlobalIdentifiersInSourceFile(inputFiles, sourceFile) {

	// console.log(sourceFile.fileName + ' ' + sourceFile.moduleType + ' ' + sourceFile.usedImpliedGlobals.length);

	let importedDefinitions = sourceFile.importedElements;

	//elements (variables/functions/objects/modules) imported in sourceFile
	//exclude modules (they're imported for their side effects)
	if(sourceFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

		//in AMD modules, imported modules model imported libraries
		importedDefinitions = sourceFile.importedElements.filter(importedEl => {

			return importedEl instanceof ImportedModule.ImportedModule === false;
		});
	}
	

	//do not exclude imported definitions with no definitions (imports)
	//(some modules of the project might be defined in the definition module's top-level scope)
	let importedDefsWithDefNodes = importedDefinitions.filter(importedDef => {

		// console.log(importedDef.elementDeclarationNode)
		return importedDef.elementDeclarationNode !== null ||
				(importedDef instanceof ImportedElement.ImportedElement &&
				importedDef.moduleDefinition !== null);
	});

	// console.log(sourceFile.fileName + ' ' + sourceFile.moduleType);
	// console.log(importedDefsWithDefNodes)

	//update each definition with its references
	importedDefsWithDefNodes.forEach(importedDef => {

		// console.log(importedDef)

		retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedDef);

		// console.log(importedDef)

		//in the case of an imported namespace,
		//retrieve the references of each property
		if(importedDef instanceof ImportedModule.ImportedModule === false) {

			importedDef.updateAccessedProperties();
		}
		

		// if(importedDef instanceof ImportedNamespace.ImportedNamespace === true) {

		// 	importedDef.updateAccessedProperties();
		// }
	});

}

/**
 * Retrieves the imported definitions of inputFile along with
 * their references (does not consider references of top-level definitions).
 * @param {*} inputFiles 
 * @param {*} inputFile 
 */
function retrieveImportedVariableAndFunctionsSetsOfAMDModule(inputFiles, inputFile) {
	
	//an AMD module can import objects (modules) in two cases:
	//(i) when it is defined (the first/second argument corresponds to the dependency list) [define takes module name optionally]
	//(ii) when it requires a module (the first argument of require corresponds to the imported module's name)
	let importFile;
	let importCallExpression;
	let moduleDependencyArray;
	let dependencyIndex;
	let callbackExpression;
	let callbackArguments;

	//imported namespaces and modules (keeps import statement order)
	let importedElements = [];
	let importedElement;
	let importedModule;

	let declaredSource;

	//inputFile.requiredFiles contains the paths to the modules that are imported in inputFile
	//with either 2 ways (define()/require()/requirejs())
	let requiredFiles = retrieveModulesRequiredInAMDModule(inputFile, inputFiles);
	inputFile.addModuleDependencies(requiredFiles);

	// console.log('in: ' + inputFile.fileName);
	// console.log(requiredFiles.length)

	let requiredFileObject;
	let callbackArgument;

	//add imported elements introduced through explicit dependencies (define()/require()/requirejs())
	for(let requiredFileIndex = 0; requiredFileIndex < requiredFiles.length; requiredFileIndex++) {

		//get current required file
		requiredFileObject = requiredFiles[requiredFileIndex];

		// console.log(requiredFileObject);

		//retrieve module in inputFiles list by path
		importFile = fileUtilities.retrieveModuleInList(inputFiles, requiredFileObject.requiredModulePath);

		// console.log(importFile !== null ? importFile.fileName : null)

		//imported module not found - proceed to the next dependency
		if(importFile === null) {

			continue;
		}

		//exported definitions of importFile:
		//(a) top-level variable declarations (imported in all modules since not encapsulated in a nested scope)
		//(b) top-level function declarations/expressions (similar to (a))
		//(c) object literals returned from callback functions (if importFile is an AMD module)

		//(a) variables defined in the top-level scope 
		//(external to define()/require()/requirejs())
		let exportedVariables = importFile.explicitGlobals.filter(explicitGlobal => {

			return explicitGlobal.isExported === true;
		});

		//(b) functions defined in the top-level scope 
		//(external to define()/require()/requirejs())
		let exportedFunctions = importFile.definedFunctions.filter(definedFunction => {

			return definedFunction.functionScope === null &&
					definedFunction.isExported === true;
		});

		// console.log(exportedVariables.length + ' ' + exportedFunctions.length);

		//(a) imported regardless of requiredFileObject.requiredModuleName
		//mapping to a module object in the callback (no element declaration node)
		exportedVariables.forEach(exportedGlobal => {

			importedElement = new ImportedElement.ImportedElement(exportedGlobal.variableName, declaredSource);
			importedElement.updateElementDeclarationNode(null);
			importedElement.updateModuleDefinition(exportedGlobal);

			commonUtilities.addImportedElementToSourceFiles(inputFiles, importFile, exportedGlobal);

			importedElements.push(importedElement);
		});

		//(b) imported regardless of requiredFileObject.requiredModuleName
		//mapping to a module object in the callback (no element declaration node)
		exportedFunctions.forEach(exportedFunction => {

			importedElement = new ImportedElement.ImportedElement(exportedFunction.functionName, declaredSource);
			importedElement.updateElementDeclarationNode(null);
			importedElement.updateModuleDefinition(exportedFunction);

			commonUtilities.addImportedElementToSourceFiles(inputFiles, importFile, exportedFunction);

			importedElements.push(importedElement);
		});

		//module is retrieved in inputFiles
		declaredSource = path.relative(path.dirname(inputFile.fileName) + path.sep, importFile.fileName);
	
		if(declaredSource.startsWith('.') === false) {
	
			//inputFile and importFile are in the same directory
			// declaredSource = '.\\' + declaredSource;
			declaredSource = '.' + path.sep + declaredSource;
		}

		//module is passed as an argument in the callback, which in turn is
		//specified as the last argument of the call to define()/require()/requirejs()
		importCallExpression = requiredFileObject.callExpression;
		let calleeFuncName = importCallExpression.callee.name;
		let calleeArguments = importCallExpression.arguments;

		//retrieve the module dependency array (inputFile depends on these modules)
		if(calleeFuncName === 'requirejs' || calleeFuncName === 'require') {

			moduleDependencyArray = calleeArguments[0].elements;
		}
		else {

			// console.log(calleeArguments)
			moduleDependencyArray = 
				calleeArguments[0].type === 'ArrayExpression' ? 
					calleeArguments[0].elements : 
					(calleeArguments.length > 1 && calleeArguments[1].type === 'ArrayExpression' ? 
						calleeArguments[1].elements : []);
		}

		//the callback corresponds to the last argument of the call to define/require
		//require: callback
		//define: callback
		callbackExpression = calleeArguments[calleeArguments.length-1];
	
		if(callbackExpression.type !== 'FunctionExpression') {

			//update: last argument of define()/require()/requirejs() is not a function

			//define() does not import a module
			if(calleeFuncName === 'define') {

				continue;
			}
			
			//require()/requirejs() references a module without 
			//import module just for its side-effects
			importedModule = new ImportedModule.ImportedModule(null, declaredSource);
			importedModule.updateImportedElementNodes(importCallExpression);
			importedModule.updateElementDeclarationNode(callbackExpression);

			// console.log(importedModule);

			inputFile.addImportedDefinition(importedModule);

			importedElements.push(importedModule);
			
			continue;
		}

		//the arguments of the callbacks are the objects exported
		//from the modules in the module dependency array
		callbackArguments = callbackExpression.params;

		//requiredFileObject.requiredModuleName represents a module that inputFile
		//depends on - retrieve the module's index in moduleDependencyArray
		//(there might not be a 1-1 mapping between a module dependency and a parameter in the callback)
		for(dependencyIndex = 0; dependencyIndex < moduleDependencyArray.length; dependencyIndex++) {

			// console.log('r: ' + requiredFileObject.requiredModuleName);
			// console.log(moduleDependencyArray[dependencyIndex])
			if(requiredFileObject.requiredModuleName === moduleDependencyArray[dependencyIndex].value) {

				break;
			}
		}

		// console.log(dependencyIndex + ' ' + moduleDependencyArray.length)
		if(dependencyIndex >= moduleDependencyArray.length) {

			//the imported module may add its properties in the global object (try to import it only for side-effects)
			importedModule = new ImportedModule.ImportedModule(null, declaredSource);
			importedModule.updateImportedElementNodes(importCallExpression);
			importedModule.updateElementDeclarationNode(callbackExpression);

			// console.log(importedModule);

			inputFile.addImportedDefinition(importedModule);

			importedElements.push(importedModule);
			
			continue;
		}

		//the imported module pointed by requiredFileObject
		//is the requiredFileIndex-th argument of callbackArguments 
		//(AMD specs: first dependency is mapped to the first argument etc)
		//retrieve the requiredFileIndex-th parameter of the callback
		//update: what if module contains nested require() calls? (and the first require call is not mapped to a parameter of the callback?)
		callbackArgument = callbackArguments[dependencyIndex];

		// console.log(callbackArgument);

		//callback does not specify the module object in an argument
		if(callbackArgument === undefined) {

			//the imported module may add its properties in the global object (try to import it only for side-effects)
			importedModule = new ImportedModule.ImportedModule(null, declaredSource);
			importedModule.updateImportedElementNodes(importCallExpression);
			importedModule.updateElementDeclarationNode(callbackExpression);

			// console.log(importedModule);

			inputFile.addImportedDefinition(importedModule);

			importedElements.push(importedModule);
			
			continue;
		}

		//(c) definitions (variables/functions/object literals) returned from the
		//callback of define() called in importFile (not defined in the top-level scope)
		let callBackFunctions = importFile.definedFunctions.filter(definedFunction => {

			return definedFunction.returnedElementDeclaration !== null &&
					definedFunction.returnedElementDeclaration.isExported === true;
		});

		// console.log(importFile.exportedProperties);
		// console.log(callBackFunctions.length);

		//elements returned from the callback function 
		//(Variable/FunctionExpression/ObjectLiteral objects)
		let exportedDefinitions = callBackFunctions.map(callbackFunc => callbackFunc.returnedElementDeclaration);
		exportedDefinitions = exportedDefinitions.length === 0 ? importFile.exportedProperties : exportedDefinitions;

		// console.log(exportedVariables.length + ' ' + exportedFunctions.length + ' ' + exportedDefinitions.length);
		// console.log(callbackArguments)
		// console.log(callbackArgument);

		//importedFile created without using AMD (IIFE, e.g. lodash or other libraries)
		if(exportedVariables.length === 0 &&
		   exportedFunctions.length === 0 &&
		   exportedDefinitions.length === 0) {

			//the imported module may add its properties in the global object (try to import it only for side-effects)
			importedModule = new ImportedModule.ImportedModule(callbackArgument.name, declaredSource);
			importedModule.updateImportedElementNodes(importCallExpression);
			importedModule.updateElementDeclarationNode(callbackExpression);

			// console.log(importedModule);

			inputFile.addImportedDefinition(importedModule);

			importedElements.push(importedModule);
			
			continue;
		}

		//requiredFileObject.requiredModuleName mapped to 
		//a module object (argument in the callback)
		//(a)-(b) already imported in inputFile
		//add an imported namespace with respect to each object in exportedDefinitions
		exportedDefinitions.forEach(exportedDef => {

			//exportedDef is the element (Variable/FunctionDeclaration/ObjectLiteral)
			//returned from the callback (it is not exported)
			//mark it as exported, since it's used in other modules
			exportedDef.updateIsExported(true);
			// console.log(exportedDef)

			let elementName = exportedDef instanceof Variable.Variable === true ?
								exportedDef.variableName : 
								(exportedDef instanceof FunctionDeclaration.FunctionDeclaration === true ?
									exportedDef.functionName :
									(path.relative(path.dirname(inputFile.fileName), importFile.fileName)).replace(/[^a-zA-Z0-9_ ]/g, ''));

			if(exportedDef instanceof Variable.Variable === true ||
				exportedDef instanceof FunctionDeclaration.FunctionDeclaration === true) {

					// console.log(callbackArgument);
				importedElement = new ImportedElement.ImportedElement(elementName, declaredSource);
				importedElement.updateAliasName(callbackArgument.name);
				importedElement.updateElementDeclarationNode(callbackExpression);
				importedElement.updateModuleDefinition(exportedDef);

				let dataType = exportedDef instanceof Variable.Variable === true ? 'variable' : 'function';
				importedElement.updateIsExportedObjectOfPrimitiveType(dataType);

				inputFile.addImportedDefinition(importedElement);
				importedElements.push(importedElement);

				// console.log(exportedDef);
				return;
			}
			
			importedElement = new ImportedNamespace.ImportedNamespace(elementName.replace(/[^\w\s]/gi, '').replace(/-/g, ''), declaredSource);
			importedElement.updateAliasName(callbackArgument.name);
			importedElement.updateElementDeclarationNode(callbackExpression);
			importedElement.updateModuleDefinitions({

				'exportedVariables': [],
				'exportedFunctions': [],
				'exportedProperties': [exportedDef]});

			importedElements.push(importedElement);
			inputFile.addImportedDefinition(importedElement);
		});
		
	}

	// console.log(importedElements);

	//update inputFile's importedElements (keep order of module import)
	inputFile.updateImportedElements(importedElements);
}

/**
 * Retrieves usages of importedElement in sourceFile (def-use algorithm with ternjs)
 * Module system-specific function (imported elements in AMD modules are defined,
 * since they are the parameters of the callback function of requirejs()/require()/define())
 * @param sourceFile
 * @param importedElement
 * @returns 
 */
function retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedElement) {

	let aliasName = importedElement.aliasName;

	//importedElement's contained in declaration statement (the callback function)
	let elementContDeclNode = importedElement.elementDeclarationNode;

	// console.log(sourceFile.fileName);
	// console.log(importedElement.elementDeclarationNode)
	// console.log(importedElement);

	if(elementContDeclNode === null || 
		elementContDeclNode.type !== 'FunctionExpression') {

		return;
	}

	let callbackFuncParams = elementContDeclNode.params;

	//importedElement is one of the callback functions parameter
	//(the parameter named with importedElement's alias)
	let elementDefNodes = callbackFuncParams.filter(callbackParam => {

		return callbackParam.type === 'Identifier' && callbackParam.name === aliasName;
	});

	//importedElement not mapped in a parameter of the callback
	if(elementDefNodes.length === 0) {

		return;
	}

	//prepare Tern request 
	//(def-use chain, since importedElement is defined within module)
	let elementDefNode = elementDefNodes[0];
	let elementDefRange = elementDefNode.range;
	
	ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

	let referenceObjs = [];
	let referenceIdentifiers = [];

	let requestDetails = {
		query: {

			type: "refs",
			file: sourceFile.fileName,
			start: elementDefRange[0],
			end: elementDefRange[1],
			variable: aliasName
		},
		timeout: 1000
	};

	ternServer.request(requestDetails, function(error, success) {

		// console.log(error);
		// console.log(success);
		if(error !== null || Object.keys(success).length === 0) {

			return;
		}
		
		//retrieve range of declaration
		let refs = success.refs;
		refs.forEach(ref => {

			let refStart = ref.start;
			let refEnd = ref.end;

			referenceObjs.push({

				'refStart': refStart,
				'refEnd' : refEnd
			});
		});
	});

	//retrieve references in the AST (jscodeshift)
	referenceObjs.forEach(refObj => {

		let refStart = refObj.refStart;
		let refEnd = refObj.refEnd;

		let refIdentifiers = sourceFile.astRootCollection
									   .find(jscodeshift.Identifier).filter(id => {

										// console.log(refObj);
										// console.log(id.value.range);
			if(id.value.loc == null) {

				return false;
			}
			
			//ASTs of Tern and jscodeshift
			//differ on some identifier's ranges
			//also keep identifiers named aliasName
			return (id.value.range[0] === refStart && id.value.range[1] === refEnd ||
					id.value.name === aliasName);
		});

		if(refIdentifiers.length === 0) {

			return;
		}

		//exclude importedElement references 
		//as a parameter of the callback function
		refIdentifiers = refIdentifiers.filter(refId => {

			return refId.value !== elementDefNode;
		});

		refIdentifiers.forEach(refId => {

			if(referenceIdentifiers.includes(refId) === false) {

				referenceIdentifiers.push(refId);
			}
		});

	});

	//delete file from Tern server
	//(importedElement is defined in the AMD module,
	//thus prevent searching in other files)
	ternServer.delFile(sourceFile.fileName);

	// console.log(importedElement.elementName + ' ' + referenceIdentifiers.length);
	// console.log(referenceIdentifiers.length);
	
	//update usages of importedElement
	importedElement.updateElementUsages(referenceIdentifiers);

	//importedElement accessed dynamically (through bracket notation)
	//used in order to prevent object destructuring
	importedElement.updateIsAccessedDynamically();

}

exports.isSourceFileAnAMDModule = isSourceFileAnAMDModule;
// exports.calculateEfferentCouplingOfAMDModule = calculateEfferentCouplingOfAMDModule;
// exports.calculateAfferentCouplingOfAMDModule = calculateAfferentCouplingOfAMDModule;
exports.retrieveExportedVariablesAndFunctionsOfAMDModule = retrieveExportedVariablesAndFunctionsOfAMDModule;
exports.retrieveImportedElementsOfAMDModule = retrieveImportedElementsOfAMDModule;
exports.retrieveUsagesOfImportedElementInSourceFile = retrieveUsagesOfImportedElementInSourceFile;
exports.retrieveBuiltinFunctionInvocations = retrieveBuiltinFunctionInvocations;