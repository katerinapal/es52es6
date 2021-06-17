/**
 * 
 */

var path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');

var enums = require('../../ast/util/enums.js');

var fileUtilities = require('../../../io/fileUtilities.js');

var Variable = require('../../ast/model/variable.js');
var ImportedElement = require('../../ast/model/importedElement.js');

/**
 * Is sourceFile an ES6 module?
 * @param sourceFile
 * @returns true, if sourceFile is an ES6 module, false, otherwise.
 */
function isSourceFileAnES6Module(sourceFile) {
	
	var astRootCollection = sourceFile.astRootCollection;
	
	//(i) does sourceFile contain import declarations?
	var importDeclarations = astRootCollection.find(jscodeshift.ImportDeclaration);
	if(importDeclarations.length > 0) {
		
		//sourceFile contains ES6 import declarations -
		//it is an ES6 module
		sourceFile.updateSourceVersion(enums.SourceVersion.ES6);
		return true;
	}

	//(ii) does sourceFile contain export declarations?
	var exportDeclarations = astRootCollection.find(jscodeshift.ExportNamedDeclaration);
	if(exportDeclarations.length > 0) {
		
		//sourceFile contains ES6 export declarations -
		//it is an ES6 module
		sourceFile.updateSourceVersion(enums.SourceVersion.ES6);
		return true;
	}
	
	return false;
}

/**
 * Calculates the afferent coupling of an ES6 module.
 * @param astRootCollection
 * @param fileList
 * @param sourceFile
 * @returns the afferent coupling of sourceFile (the number of the JS modules dependent on sourceFile).
 */
function calculateAfferentCouplingOfES6Module(inputFiles, sourceFile, directory) {
	
	//find export statements of the module corresponded to astRootCollection
	var exportDeclarations = sourceFile.astRootCollection.find(jscodeshift.ExportNamedDeclaration);
	var dependentModules = [];
	if(exportDeclarations.length > 0) {
		
		//sourceFile contains exported declarations
		//retrieve the modules that import elements from this module
		
		inputFiles.forEach(function(inputFile) {
			
			if(inputFile.fileName === sourceFile.fileName) {
				
				return;
			}
			
			//retrieve import statements of inputFile
			var requiredModules = retrieveModulesRequiredInES6Module(inputFiles, inputFile);
			for(var fileIndex = 0; fileIndex < requiredModules.length; fileIndex++) {
				
				var specifiedModule = requiredModules[fileIndex];
				//var filePath = fileUtilities.retrieveModuleInList(inputFiles, specifiedModule);
				
				//if specifiedModule corresponds to sourceFile
				if(sourceFile.fileName === specifiedModule) {
					
					//add filePath to dependentModules and proceed to the next inputFile
					dependentModules.push(inputFile.fileName);
					
					return;
				}
				
			}
		});
		
		sourceFile.updateDependentModules(dependentModules);
		return dependentModules.length;
	}
	else {
		
		//sourceFile does not contain exported declarations (and, hence, has no dependent modules)
		sourceFile.updateDependentModules([]);
		return 0;
	}
}

/**
 * Retrieves the set of the modules that file is dependent on.
 * @param inputFiles
 * @param file
 * @returns the module dependencies of file (the definition modules of the elements that are imported in file).
 */
function retrieveModulesRequiredInES6Module(inputFiles, file) {
	
	//case: file's required modules are retrieved
	//in order to find another file's dependent modules
	//example: file A requires an element from file B
	//required modules of A can be retrieved in either stages:
	//(1) when efferent coupling of A is assessed
	//(2) when afferent coupling of B is assessed
	//case: afferent coupling of B is assessed before
	//the assessment of efferent coupling of A
	if(file.requiredFiles !== null) {
		
		return file.requiredFiles;
	}
	
	var importDeclarations = file.astRootCollection.find(jscodeshift.ImportDeclaration);
	
	var moduleDependencies = [];
	
	//retrieve # of distinct modules the specific module depends on
	importDeclarations.forEach(function(importDeclaration) {

		//retrieve the module specified in each import statement
		var specifiedModule = importDeclaration.value.source.value;
		
		if(specifiedModule.startsWith('.') === true && specifiedModule.endsWith('.js') === true) {
			
			//relative path - search required module in input files' list (process only js files)
			//case: ES6 file with extension
			var requiredModule = fileUtilities.retrieveModuleInList(inputFiles, path.basename(specifiedModule, '.js'));
			
			//add each module in the result array once
			if(moduleDependencies.indexOf(requiredModule.fileName) == -1) {
				moduleDependencies.push(requiredModule.fileName);
			}
		}

	});
	
	//update module dependencies of ES6 module
	file.addModuleDependencies(moduleDependencies);
	return moduleDependencies;
}

/**
 * Calculates the efferent coupling of an ES6 module (#functions inside ES6 module that depend on functions outside ES6 module)
 * @returns the efferent coupling of sourceFile
 * (update: )
 */
function calculateEfferentCouplingOfES6Module(inputFiles, sourceFile, directory) {
	
	//retrieve import statements of module with astRootCollection
	var importDeclarations = sourceFile.astRootCollection.find(jscodeshift.ImportDeclaration);
	
	var moduleDependencies = [];
	
	//retrieve # of distinct modules the specific module depends on
	importDeclarations.forEach(function(importDeclaration) {

		//retrieve the module specified in each import statement
		var specifiedModule = importDeclaration.value.source.value;
		
		if(specifiedModule.startsWith('.') === true) {
			
			//normalize path (replace \\ with \) (process only sources located in the input system's folder)
			specifiedModule = specifiedModule.replace(/\\\\/g, '\\');
			var requiredModule = fileUtilities.retrieveModuleInList(inputFiles, specifiedModule);

			if(requiredModule !== null &&
			   moduleDependencies.indexOf(requiredModule.fileName) === -1) {
				
				//add each module in the result array once
				moduleDependencies.push(requiredModule.fileName);
			}
			
		}
		
	});
	
	//update module dependencies of ES6 module
	sourceFile.addModuleDependencies(moduleDependencies);
	
	return moduleDependencies.length;
}

/**
 * Retrieves the imported variables and functions of an ES6 module.
 * @param sourceFile
 * @returns the imported variable and function sets of sourceFile
 */
function retrieveImportedVariablesAndFunctionsOfES6Module(inputFiles, sourceFile) {
	
	var importedVariables = [];
	var importedFunctions = [];
	var astRootCollection = sourceFile.astRootCollection;
	
	//find import declarations in sourceFile
	var importDeclarations = astRootCollection.find(jscodeshift.ImportDeclaration);
	
	importDeclarations.forEach(function(importDeclaration) {
		
		//retrieve node representing import source
		var importSource = importDeclaration.value.source;
		
		//retrieve nodes representing imported elements
		var importSpecifiers = importDeclaration.value.specifiers;
		
		importSpecifiers.forEach(function(importSpecifier) {
			
			var importedSpecifierName;
			
			//name of imported element
			if (importSpecifier.type === 'ImportDefaultSpecifier') {
				
				//syntax: import [specifiers] from '<moduleName';
				importedSpecifierName = importSpecifier.local.name;
			}
			else {
				
				//syntax: import {[specifiers]} from '<moduleName';
				importedSpecifierName = importSpecifier.imported.name;
			}
			
			//resolve whether the imported element 
			//corresponds to a variable
			
			//resolve whether imported specifier corresponds to an exported global in importSource
			//(i) find importSource in inputFiles' list
			//importSource is resolved with the help of the path package (path package can also resolve paths to folders,
			//except for relative paths to JS modules)
			// var specifiedModulePath = path.resolve(path.dirname(sourceFile.fileName) + "\\" + importSource.value);

			var specifiedModulePath = path.resolve(path.dirname(sourceFile.fileName) + path.sep + importSource.value);
			var importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
			
//			console.log(importSource.value + " " + importFile.fileName + " " + importedSpecifierName);
			
			//(ii) search imported specifier in the list of the exported globals
			if(importFile !== null) {
				
				var importedElement = new ImportedElement.ImportedElement(importedSpecifierName, importSource);
				var isVariable = isImportedElementAGlobalOfImportFile(importFile, importedSpecifierName);
				
				//if importedSpecifierName is a global variable in importFile
				if(isVariable === true) {
					
					importedVariables.push(importedElement);
				}
				else {
					
					//importedSpecifierName is not a global variable
					//it is a function defined in the top-level scope of importFile
					importedFunctions.push(importedElement);
				}
			}
			
		});
		
	});
	
	//update imported variables of sourceFile
	sourceFile.updateImportedVariables(importedVariables);
	
	//update imported functions of sourceFile
	sourceFile.updateImportedFunctions(importedFunctions);
}

/**
 * Is importedSpecifierName a global defined in importFile?
 * @param importFile
 * @param importedSpecifierName
 * @returns true, if importedSpecifierName comprises a global defined in importFile, false otherwise.
 */
function isImportedElementAGlobalOfImportFile(importFile, importedSpecifierName) {
	
	var explicitGlobals = importFile.explicitGlobals;
	
	for(var globalIndex = 0; globalIndex < explicitGlobals.length; globalIndex++) {
		
		var explicitGlobal = explicitGlobals[globalIndex];
		
		//importedSpecifierName represents explicitGlobal
		if(explicitGlobal.isExported === true &&
		   explicitGlobal.variableName === importedSpecifierName) {
			
			return true;
		}
	}

	return false;
}


/**
 * Returns the exported variables and functions of an ES6 module.
 * @param sourceFile
 * @returns
 */
function retrieveExportedVariablesAndFunctionsOfES6Module(sourceFile) {
	
	//retrieve export statements of sourceFile
	var astRootCollection = sourceFile.astRootCollection;
	var exportDeclarations = astRootCollection.find(jscodeshift.ExportNamedDeclaration);
	
	var exportedVariables = [];
	var exportedFunctions = [];
	
	exportDeclarations.forEach(function(exportDeclaration) {
		
		var declaration = exportDeclaration.value.declaration;
		
//		console.log(sourceFile.fileName);
//		console.log(exportDeclaration);
//		console.log(exportDeclaration.value.loc);
//		console.log(declaration);
//		
//		console.log(exportDeclaration.value.specifiers);
//		console.log(exportDeclaration.value.exportKind);
		
		if(declaration !== null) {
			
			//element (variable/function) is exported during its declaration
			var exportedElementType = declaration.type;
			if(exportedElementType === 'VariableDeclaration') {
				
				//exportDeclaration represents a global variable
				//syntax: export var <variableName> [= <value>];
				var declarations = declaration.declarations;
				
				declarations.forEach(function(declaredElement) {
					
					//find name of exported element
					var exportedElementName = declaredElement.id.name;
					
					//add variable name to exportedVariables array
					exportedVariables.push(exportedElementName);
				});
				
			}
			else if(exportedElementType === 'FunctionDeclaration') {
				
				//exportDeclaration represents a top-level scope function
				//syntax: export function <functionName>(<args>) {...}
				var exportedElementName = declaration.id.name;
				
				//add function name to exportedFunctions array
				exportedFunctions.push(exportedElementName);
			}
			
		}
		else {
			
			//element (variable/function) is exported after its declaration
			//case: export { <variableName> as <aliasName}
			var exportedSpecifiers = exportDeclaration.value.specifiers;
			var exportedSpecifiersKind = exportDeclaration.value.exportKind;
			
			if(exportedSpecifiersKind === 'value') {
				
				//exportedSpecifiers represent variables - add them to exportedVariables array
				exportedSpecifiers.forEach(function(exportedSpecifier) {
					
					exportedVariables.push(exportedSpecifier);
				});
				
			}	
		}
		
		
	});
	
	//update exported variables of sourceFile
	//search each exportedVariable in explicit globals list and update the corresponding explicit global
	var explicitGlobals = sourceFile.explicitGlobals;
	exportedVariables.forEach(function(exportedVariable) {
		
		for(var variableIndex = 0; variableIndex < explicitGlobals.length; variableIndex++) {
			
			var explicitGlobal = explicitGlobals[variableIndex];
			
			//explicitGlobal corresponds to exportedVariable
			//update explicitGlobal and proceed to the next exportedVariable
			if(explicitGlobal.variableName === exportedVariable) {
				
				explicitGlobal.updateIsExported(true);
				return;
			}
		}
		
	});
	
	//update exported functions of sourceFile
	//search each exportedFunctionName in the defined function list and update the corresponding function
	var definedFunctions = sourceFile.definedFunctions;
	exportedFunctions.forEach(function(exportedFunctionName) {
		
		for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
			var definedFunction = definedFunctions[functionIndex];
			
			//if exportedFunctionName corresponds to definedFunction
			//update definedFunction and proceed to the next exportedFunctionName
			if(definedFunction.functionName === exportedFunctionName) {
				
				definedFunction.updateIsExported(true);
				return;
			}
		}
		
	});
	
}

exports.isSourceFileAnES6Module = isSourceFileAnES6Module;
exports.calculateAfferentCouplingOfES6Module = calculateAfferentCouplingOfES6Module;
exports.calculateEfferentCouplingOfES6Module = calculateEfferentCouplingOfES6Module;
exports.retrieveExportedVariablesAndFunctionsOfES6Module = retrieveExportedVariablesAndFunctionsOfES6Module;
exports.retrieveImportedVariablesAndFunctionsOfES6Module = retrieveImportedVariablesAndFunctionsOfES6Module;