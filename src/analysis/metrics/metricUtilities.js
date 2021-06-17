/**
 * http://usejsdoc.org/
 */

var path = require('path');
const process = require('process');

var es6Utilities = require('./es6Utilities/es6Utilities.js');
var commonJSUtilities = require('./commonJSUtilities/commonJSUtilities.js');
var amdUtilities = require('./amdUtilities/amdUtilities.js');
var plainJSUtilities = require('./plainJSUtilities/plainJSUtilities.js');

//functionalities that apply to multiple module systems
var commonUtilities = require('./commonUtilities.js');

var ImportedElement = require('../ast/model/importedElement');
var Variable = require('../ast/model/variable.js');
var functionDeclaration = require('../ast/model/functionDeclaration.js');
var ImpliedGlobalVariable = require('../ast/model/impliedGlobalVariable.js');

var enums = require('../ast/util/enums.js');
var CommonCoupledModuleSet = require('../ast/util/commonCoupledModuleSet.js');

var fileUtilities = require('../../io/fileUtilities.js');
var codeHierarchyUtilities = require('../ast/util/codeHierarchyUtilities.js');

/**
 * Calculates the ratio of efferentCoupling over the total coupling of the module.
 * @param afferentCoupling
 * @param efferentCoupling
 * @returns the instability of the module.
 */
function calculateInstabilityOfModule(afferentCoupling, efferentCoupling) {
	return efferentCoupling / (afferentCoupling + efferentCoupling);
}

function calculateCouplingMetricsOfModule(inputFiles, sourceFile, directory) {
	
	var efferentCoupling = 0;
	var afferentCoupling = 0;
	
	//efferent coupling: #function definitions inside sourceFile that depend on function definitions outside sourceFile
	efferentCoupling = calculateEfferentCouplingOfModule(sourceFile);

	//afferent coupling: #function definitions outside sourceFile that depend on function definitions inside sourceFile
	afferentCoupling = calculateAfferentCouplingOfModule(sourceFile, inputFiles);
	
	var instability = calculateInstabilityOfModule(afferentCoupling, efferentCoupling);
		
	return "module: " + sourceFile.fileName + 
		   "\ndependent modules: [" + (sourceFile.dependentModules === null ? [] : sourceFile.dependentModules) + "]\nafferent coupling: " + afferentCoupling + 
		   "\nrequiredModules: [" + (sourceFile.requiredFiles === null ? [] : sourceFile.requiredFiles) + "]\nefferent coupling: " + efferentCoupling + 
		   "\ninstability: " + instability;
}

/**
 * Calculates afferent coupling of sourceFile (#function definitions outside sourceFile
 * that depend on (use) function definitions inside sourceFile)
 * @param sourceFile 
 */
function calculateAfferentCouplingOfModule(sourceFile, inputFiles) {

	//iterate over the other JS file's function definitions, in order to retrieve the function
	//definitions that depend on (use) a function defined within sourceFile
	// console.log('s: ' + sourceFile.fileName);

	//the array of the function definitions that depend on (use) at least one function definition within sourceFile
	var functionDefinitions = [];

	var definedFunctions;

	//used elements: the imported elements that are used within a function definition of a JS file
	var usedElements;
	var elementIndex;
	var usedElement;
	var usedElementIsAFunction;
	var importSource;
	var specifiedModulePath;
	var importFile;
	inputFiles.forEach(function(inputFile) {

		if(inputFile.fileName === sourceFile.fileName) {

			//inputFile represents the file represented by sourceFile
			//proceed to the name JS file
			return;
		}

		//retrieve functions defined within inputFile
		definedFunctions = inputFile.definedFunctions;

		definedFunctions.forEach(function(definedFunction) {

			if(definedFunction.functionName === 'topLevelScope') {

				//topLevelScope is a artificially inserted defined function that models the source code
				//in the top-level scope of sourceFile
				//proceed to the next function definition
				return;
			}

			//does definedFunction depend on (use) function definitions (at least one) within sourceFile?
			//retrieve usedElements of definedFunction
			usedElements = definedFunction.usedElements;

			// console.log(definedFunction.functionName + " " + usedElements.length);
			for(elementIndex = 0; elementIndex < usedElements.length; elementIndex++) {

				//get current used element
				usedElement = usedElements[elementIndex];

				// console.log(usedElement);

				//(i) is used element defined within sourceFile?
				// importSource = usedElement.declaredSource.value;
				importSource = usedElement.declaredSource.value === undefined ? usedElement.declaredSource: usedElement.declaredSource.value;

				// console.log(importSource);

				//specifiedModulePath: resolved using the directory of the file containing the function definition that uses usedElement
				//and the path to the module containing the usedElement's definition
				// specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + "\\" + importSource);

				specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importSource);

				// specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importSource.value);

				//retrieve JS file containing the definition of usedElement
				importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);

				// console.log(specifiedModulePath);

				if(importFile !== null && importFile.fileName === sourceFile.fileName) {

					//usedElement is defined within sourceFile
					//(ii) is usedElement a function definition (either function declaration or function expression)?
					usedElementIsAFunction = codeHierarchyUtilities.isUsedElementAFunction(usedElement);

					if(usedElementIsAFunction === true) {

						// console.log(inputFile.fileName + " " + definedFunction.functionName);

						//usedElement is a function definition
						//definedFunction, located in inputFile, depends on (uses) a usedElement, 
						//which is a function defined within sourceFile
						//add definedFunction in functionDefinitions (functionDefinitions contains the function definitions
						//that depend on function definitions (at least 1) within sourceFile)
						functionDefinitions.push(definedFunction);
					}
				}
			}
		});
	});

	return functionDefinitions.length;
}

/**
 * Calculates efferent coupling of sourceFile (#function definitions inside sourceFile 
 * that depend on (use) function definitions outside sourceFile).
 * @param sourceFile 
 */
function calculateEfferentCouplingOfModule(sourceFile) {

	//array of the function definitions within sourceFile that are dependent on function definitions outside sourceFile
	var functionDefinitions = [];
	var usedElements;
	var elementIndex;
	var usedElementIsAFunction;

	// console.log(sourceFile.fileName);

	//retrieve function definitions within sourceFile which use at least one function definition outside sourceFile
	sourceFile.definedFunctions.forEach(function(definedFunction) {

		if(definedFunction.functionName === 'topLevelScope') {

			//topLevelScope is a artificially inserted defined function that models the source code
			//in the top-level scope of sourceFile
			//proceed to the next function definition
			return;
		}

		//usedElements: imported elements that are used inside definedFunction
		usedElements = definedFunction.usedElements;

		// console.log(sourceFile.fileName + " " + usedElements.length);
		for(elementIndex = 0; elementIndex < usedElements.length; elementIndex++) {

			//get current usedElement
			usedElement = usedElements[elementIndex];

			//is usedElement a function definition (either function declaration or function expression)?
			usedElementIsAFunction = codeHierarchyUtilities.isUsedElementAFunction(usedElement);

			//if usedElement is a function definition, insert definedFunction in functionDefinitions
			if(usedElementIsAFunction === true) {

				
				// console.log(definedFunction.functionName + " " + usedElement.elementName);
				// console.log(usedElement.elementUsages[0].value.loc);

				//definedFunction, located inside sourceFile,
				//uses (depends on) a function definition outside sourceFile
				functionDefinitions.push(definedFunction);
				break;
			}
			
		}
	});

	// console.log(functionDefinitions);
	// console.log(sourceFile.fileName + " " + functionDefinitions.length);
	return functionDefinitions.length;
}

// function calculateCouplingMetricsOfModule(inputFiles, sourceFile, directory) {
	
// 	var efferentCoupling = 0;
// 	var afferentCoupling = 0;
	
// 	var sourceVersion = sourceFile.sourceVersion;
// 	var moduleFramework = sourceFile.moduleFramework;
	
// 	var dependentModules = [];
// 	var requiredModules = [];
	
// 	//efferent coupling: #distinct modules a module depends on
// 	//afferent coupling: #distinct modules dependent on a module
// 	if(sourceVersion === enums.SourceVersion.ES6) {
		
// 		efferentCoupling = es6Utilities.calculateEfferentCouplingOfES6Module(inputFiles, sourceFile, directory);
// 		afferentCoupling = es6Utilities.calculateAfferentCouplingOfES6Module(inputFiles, sourceFile, directory);
// 	}
// 	else if(sourceVersion === enums.SourceVersion.ES5) {
		
// 		if(moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
			
// 			efferentCoupling = commonJSUtilities.calculateEfferentCouplingOfCommonJSModule(inputFiles, sourceFile);
// 			afferentCoupling = commonJSUtilities.calculateAfferentCouplingOfCommonJSModule(inputFiles, sourceFile, directory);
			
// 		}
// 		else if(moduleFramework.includes(enums.ModuleFramework.AMD) === true) {
			
// 			efferentCoupling = amdUtilities.calculateEfferentCouplingOfAMDModule(sourceFile, inputFiles);
// 			afferentCoupling = amdUtilities.calculateAfferentCouplingOfAMDModule(inputFiles, sourceFile);
// 		}
// 	}
	
// 	var instability = calculateInstabilityOfModule(afferentCoupling, efferentCoupling);
		
// 	return "module: " + sourceFile.fileName + 
// 		   "\ndependent modules: [" + (sourceFile.dependentModules === null ? [] : sourceFile.dependentModules) + "]\nafferent coupling: " + afferentCoupling + 
// 		   "\nrequiredModules: [" + (sourceFile.requiredFiles === null ? [] : sourceFile.requiredFiles) + "]\nefferent coupling: " + efferentCoupling + 
// 		   "\ninstability: " + instability;
// }

/**
 * Assesses the common coupling occurences in the system inputFiles.
 * @param inputFiles: the list of the input source files.
 * @returns
 */
function assessCommonCouplingOccurencesInSystem(inputFiles) {
	
	return calculateCommonCouplingModuleSets(inputFiles);
}

/**
 * Retrieves common coupling of a module.
 * @param inputFiles the input file hashmap
 * @param sourceFile
 * @returns
 */
function calculateCommonCouplingModuleSets(inputFiles) {
	
	inputFiles.buckets.forEach(fileList => {

		for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

			let sourceFile = fileList[fileIndex][1];
			// console.log(sourceFile.fileName + " " + sourceFile.sourceVersion)
			if(sourceFile.sourceVersion === null) {

				return;
			}
			sourceVersion = sourceFile.sourceVersion;
			moduleFramework = sourceFile.moduleFramework;

			// console.log(sourceFile.fileName + " " + sourceFile.importedFunctions.length + " " + moduleFramework);
			// console.log(sourceFile.importedFunctions);

			// let hrstart = process.hrtime();

			console.info(`Detecting imported features in ${sourceFile.fileName}.`);

			retrieveImportedGlobalsOfModule(inputFiles, sourceFile);

			// let hrend = process.hrtime(hrstart);

			// console.info(`Imported feature detection in ${sourceFile.fileName} ended.`);

			// console.log(sourceFile.fileName);
		}
		
	});

	console.info(`Imported feature detection ended.`);

	//after the imported definitions of each module
	//are retrieved (along their references),
	//retrieve references of imported definitions with no import statements
	//(top-level definitions)
	//applies to AMD/non-modular ES5 modules
	commonUtilities.retrieveTopLevelDefinitionReferences(inputFiles);

	console.log(`Top-level definition reference detection ended.`);

	//retrieve references of imported definitions corresponding to implied globals
	//(no definition - no import)
	//applies regardless of the employed module system
	commonUtilities.retrieveImpliedGlobalReferences(inputFiles);

	console.log(`Imported feature reference detection ended.`);

	//used for debugging
	inputFiles.buckets.forEach(fileList => {

		fileList.forEach(fileObj => {

			let inputFile = fileObj[1];
			inputFile.dumpImportedDefinitionsOfSourceFileToFile(inputFiles);
			// console.log(inputFile.fileName);
			// console.log(inputFile.usedImpliedGlobals);
		});
	});
	
	return [];
}

/**
 * Retrieves the JS modules that share element. Creates an object including element, element's defininition module and the modules that share it.
 * @param inputFiles
 * @param sourceFile
 * @param element
 * @returns the aforementioned object, if multiple modules share element, otherwise null.
 */
function getCommonCoupledModuleSetObjectOfElement(inputFiles, sourceFile, element) {
	
	if(element.isExported === true || element instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {
		
		//retrieve the modules of the system that
		//share/use/import the specific element (variable/function)
		var commonCoupledModuleSetRegardingExplicitGlobal = retrieveCommonCoupledModuleSetOfElement(inputFiles, sourceFile, element);
		
		//explicitGlobal is shared by multiple source files
		//(the first file of commonCoupledModuleSetRegardingExplicitGlobal corresponds
		//to the definition module of explicitGlobal
		if(commonCoupledModuleSetRegardingExplicitGlobal.length > 1) {
			
			var commonCoupledModuleSet = new CommonCoupledModuleSet.CommonCoupledModuleSet(element, sourceFile, commonCoupledModuleSetRegardingExplicitGlobal);
			
			//add common coupled module set to the system's common coupling occurences
			return commonCoupledModuleSet;
		}
	}
	
	return null;
}

/**
 * Returns the set of the modules of the input system that import and use element.
 * @param
 * @returns
 */
function retrieveCommonCoupledModuleSetOfElement(inputFiles, sourceFile, element) {
	
	var commonCoupledModules = [];
	
	var importedVariables;
	var variableIndex;
	var importedVariable;
	var importedVariableName;

	var usedImpliedGlobals;
	var impliedGlobalIndex;
	var impliedGlobal;
	var impliedGlobalName;
	
	//aliasName: the name of imported variable (case: variable becomes exported with a different name)
	var aliasName;
	
	var importedSource;
	var importedSourcePath;
	var importedSourceFile;
	var importedFile;
	
	var elementName;
	var isElementDefined;
	
	//element can be either a variable or a function - retrieve its name
	if(element instanceof Variable.Variable === true) {
		
		elementName = element.variableName;
		isElementDefined = true;
	}
	else if(element instanceof functionDeclaration.FunctionDeclaration === true) {
		
		elementName = element.functionName;
		isElementDefined = true;
	}
	else {

		elementName = element.variableName;
		isElementDefined = false;
	}

	// console.log(typeof element);
	// console.log(elementName);
	
	//add declaration module to the set
	commonCoupledModules.push(sourceFile);
	
	//retrieve JS modules that import element
	inputFiles.forEach(function(inputFile) {
		
		if(sourceFile === inputFile) {
			
			//no need to process sourceFile (element cannot be defined and imported in the same module)
			//proceed to the next inputFile
			return;
		}

		if(isElementDefined === true) {

			//element is defined (search in inputFile's imported variables)
			importedVariables = inputFile.importedVariables;

			//is element a variable imported in inputFile? (search in importedVariables)
			for(variableIndex = 0; variableIndex < importedVariables.length; variableIndex++) {
				importedVariable = importedVariables[variableIndex];
				
				importedVariableName = importedVariable.elementName;
				
				//aliasName: the name of imported variable (case: variable becomes exported with a different name)
				aliasName = importedVariable.aliasName;
				
				importedSource = importedVariable.declaredSource;

				//importedSourceFile contains a relative path to either a folder or a JS module
				//modules whose names are given as arguments to require() comprise modules either provided by the framework
				//or external to the system under analysis
				importedSourceFile = importedSource.value;
			
				//resolve importedSourceFile with the help of the path package (path can also resolve relative paths to folders,
				//except for relative paths to JS modules)
				// importedSourcePath = path.resolve(path.dirname(inputFile.fileName) + "\\" + importedSourceFile);

				importedSourcePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedSourceFile);
				
				//retrieve importedSourcePath through iterating over the inputFiles list
				importedFile = fileUtilities.retrieveModuleInList(inputFiles, importedSourcePath);
				
				//importedSourcePath is the path to sourceFile
				//and explicitGlobal is imported (what if explicitGlobal is exported  with a different name?)

				if(importedFile === sourceFile &&
				(importedVariableName === elementName || aliasName === elementName)) {
					
					//(i) importedFile cannot be identical to inputFile (element cannot be defined and imported in the same JS module)
					//(ii) importedFile should be identical to sourceFile (element is defined in sourceFile)
					//(iii) imported variable can be used through either its name or its alias (in case it becomes exported with a different name)
					
					//importedVariable corresponds to explicitGlobal - module imports (and uses) explicitGlobal
					//add inputFile to commonCoupledModules array and proceed to the next inputFile
					commonCoupledModules.push(inputFile);
					return;
				}
				
			}
		}
		else {

			//element is not defined (it is an implied global - search in the inputFile's used implied globals)
			usedImpliedGlobals = inputFile.usedImpliedGlobals;
			for(impliedGlobalIndex = 0; impliedGlobalIndex < usedImpliedGlobals.length; impliedGlobalIndex++) {

				impliedGlobal = usedImpliedGlobals[impliedGlobalIndex];

				impliedGlobalName = impliedGlobal.elementName;
				
				importedSource = impliedGlobal.declaredSource;
			
				//resolve importedSourceFile with the help of the path package (path can also resolve relative paths to folders,
				//except for relative paths to JS modules)
				// importedSourcePath = path.resolve(path.dirname(inputFile.fileName) + "\\" + importedSource);

				importedSourcePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedSource);
				
				//retrieve importedSourcePath through iterating over the inputFiles list
				importedFile = fileUtilities.retrieveModuleInList(inputFiles, importedSourcePath);
				
				//importedSourcePath is the path to sourceFile
				//and explicitGlobal is imported (what if explicitGlobal is exported  with a different name?)

				if(importedFile === sourceFile && impliedGlobalName === elementName) {
					
					//(i) importedFile cannot be identical to inputFile (element cannot be defined and imported in the same JS module)
					//(ii) importedFile should be identical to sourceFile (element is defined in sourceFile)
					//(iii) imported variable can be used through either its name or its alias (in case it becomes exported with a different name)
					
					//impliedGlobal corresponds to element - module imports (and uses) element as an implied global
					//add inputFile to commonCoupledModules array and proceed to the next inputFile
					commonCoupledModules.push(inputFile);
					return;
				}
			}

		}
	});
	
	//return the set of the modules sharing explicitGlobal
	return commonCoupledModules;
}

/**
 * Retrieves imported variables of sourceFile (and their uses), along with implied globals.
 * @param sourceFile
 * @returns
 */
function retrieveImportedGlobalsOfModule(inputFiles, sourceFile) {
	
	var sourceVersion = sourceFile.sourceVersion;
	var moduleFramework = sourceFile.moduleFramework;
	
	if(sourceVersion === enums.SourceVersion.ES6) {
		
		es6Utilities.retrieveImportedVariablesAndFunctionsOfES6Module(inputFiles, sourceFile);
	}
	else if(sourceVersion === enums.SourceVersion.ES5) {
		
		//case: module implemented to run both on server and on client (mixed code)
		if(moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
			
			commonJSUtilities.retrieveImportedElementsOfCommonJSModule(inputFiles, sourceFile);
			
		}
		else if(moduleFramework.includes(enums.ModuleFramework.AMD) === true) {
			
			// console.log(sourceFile.fileName + " " + sourceFile.importedFunctions.length);

			//imported globals in AMD are not explicitly
			//imported (AMD does not import sth, it just defines and uses it)
			amdUtilities.retrieveImportedElementsOfAMDModule(inputFiles, sourceFile);
		}
		else {

			//update what about plain JS files (JS code designed using no module systems)?
			//plain JS files, imported elements correspond to the elements that are used (no mechanism to import an element)
			//for each variable/function definition of a file in inputFiles, search for usages in sourceFile
			plainJSUtilities.retrieveImportedElementsOfJSFile(inputFiles, sourceFile);
		}
	}

	// console.log('im: ' + sourceFile.fileName);
	// console.log(sourceFile.importedFunctions);

	//retrieve implied globals that are used in sourceFile 
	//(these variables need to be imported too)
	commonUtilities.retrieveImpliedGlobalsUsedInModule(inputFiles, sourceFile);

	// console.log('im: ' + sourceFile.fileName);
}



/**
 * Retrieves exported variables of sourceFile.
 * @param sourceFile
 * @returns
 */
function retrieveExportedElementsOfModule(sourceFile, sourceFiles) {
	
	var sourceVersion = sourceFile.sourceVersion;
	var moduleFramework = sourceFile.moduleFramework;
	// console.log(sourceFile.fileName + " " + moduleFramework);
	if(sourceVersion === enums.SourceVersion.ES6) {
		
		es6Utilities.retrieveExportedVariablesAndFunctionsOfES6Module(sourceFile);
	}
	else if(sourceVersion === enums.SourceVersion.ES5) {
		
//		if(moduleFramework === enums.ModuleFramework.CommonJS) {
		// console.log(moduleFramework);
		
		//case: module implemented to run both in server and in browser (mixed code)
		if(moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {	
			//retrieve exported elements (variables, functions and anonymus object expressions) of commonJS module
			commonJSUtilities.retrieveExportedElementsOfCommonJSModule(sourceFile, sourceFiles);
		}
		else if(moduleFramework.includes(enums.ModuleFramework.AMD) === true) {
			
			//exported variables and functions in AMD are not explicitly
			//exported (AMD does not export sth, it just defines it)
			amdUtilities.retrieveExportedVariablesAndFunctionsOfAMDModule(sourceFile);
		}
		else {

			plainJSUtilities.retrieveExportedElementsOfJSFile(sourceFile);
		}
	}
	
}

exports.calculateCouplingMetricsOfModule = calculateCouplingMetricsOfModule;
exports.assessCommonCouplingOccurencesInSystem = assessCommonCouplingOccurencesInSystem;
exports.calculateCommonCouplingModuleSets = calculateCommonCouplingModuleSets;
exports.retrieveExportedElementsOfModule = retrieveExportedElementsOfModule;
exports.retrieveImportedGlobalsOfModule = retrieveImportedGlobalsOfModule;