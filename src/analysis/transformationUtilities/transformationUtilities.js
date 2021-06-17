/**
 * 
 */

var fs = require('fs');
var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var jsonStream = require('../../../node_modules/JSONStream');
var mkdirp = require('../../../node_modules/mkdirp');
var readlineSync = require('../../../node_modules/readline-sync');

var enums = require('../ast/util/enums.js');
var fileUtilities = require('../../io/fileUtilities.js');
var mdgUtilities = require('../mdg/mdgUtilities.js');
var resultUtilities = require('./resultUtilities.js');
var commonJSTransformUtilities = require('./commonJSTransformUtilities.js');
var amdTransformationUtilities  = require('./amdTransformationUtilities.js');
var plainJSTransformationUtilities = require('./plainJSTransformationUtilities.js');
var statisticUtilities = require('../../tool/statisticsUtilities.js');

//contains objects, each of which model the inputFile that needs to be transformed,
//the JSON file that contains the transforms that need to be applied to it
//and the json stream for reading it
let jsonStreamList = [];

/**
* Transforms each module of inputFiles list to an ES6 module.
* @param moduleDependenceGraph the MDG used to retrieve the module dependenciesof each file
* @param inputFiles the input file hashmap
* @param projectTypeIndex the analyzed system's type (CJS/AMD/non-modular ES5)
* @param isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
* @returns
*/
function retrieveModuleDependenciesOfModules(moduleDependenceGraph, inputFiles, projectTypeIndex, isLibrary = false) {
	
	//convert hashmap to list (prevent writing many for loops)
	let inputFileList = inputFiles.convertHashMapToArray();

	//firstly, retrieve imports/exports that need to be introduced in each module
	//due to its dependencies (incoming/outgoing)
	//then, if project is a library,
	//retrieve exports that are not included in module dependencies
	//(export features, regardless of their use)
	//all modules are assumed to be entry files
	inputFileList.forEach(inputFile => {

		//retrieve module dependencies of inputFile (imports)
		//(while an import of inputFile is retrieved, the export dependency
		//is added to the module represented by the adjacent node)
		//fileList contains (key,value) pairs
		// console.log('library: ' + isLibrary)
		retrieveModuleDependenciesOfModule(inputFiles, moduleDependenceGraph, inputFile, isLibrary);
	});

	//right after the module dependency list for each file is updated 
	//with the definitions that need to be imported/exported
	//introduce dependencies for redundant imports
	//and unused exported definitions of each file in its dependency list
	//applies to non-library systems (non-library systems are syntactically transformed)
	if(isLibrary === false) {

		inputFileList.forEach(inputFile => {

			inputFile.addEncapsulationAndRedundancyDepsInModuleDependencyList();
		});
	}
	else {

		inputFileList.forEach(inputFile => {

			mdgUtilities.updateLibraryModuleExportDependencies(inputFile, inputFiles);
		});
	}

	// //after this iteration, imports/exports are resolved for each inputFile
	// //write definitions to JSON file (search exported/imported element by ast node)
	// let inputFileList = inputFiles.convertHashMapToArray();

	inputFileList.forEach(inputFile => {
		
		//generate a JSON file for each inputFile
		let inputFileSourceTransformationObject = resultUtilities.generateJSONObjectContainingInputFileTransformations(inputFile, inputFiles, isLibrary);
		let resultObject = resultUtilities.writeJSONObjectToFile(inputFile, inputFileSourceTransformationObject);
	
		jsonStreamList.push(resultObject);
	});

	console.log(`Generated json files.`);
}

/**
 * Returns the module data and function dependencies of inputFile (MDG traversal).
 * @param inputFiles the input file hashmap
 * @param moduleDependenceGraph the MDG used for retrieving the file's module dependencies
 * @param inputFile the file whose dependencies are retrieved
 * @param isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
 */
function retrieveModuleDependenciesOfModule(inputFiles, moduleDependenceGraph, inputFile, isLibrary = false) {
	
	//(i) resolve module data and function dependencies of each inputFile
	mdgUtilities.retrieveModuleDependenciesOfModule(inputFiles, moduleDependenceGraph, inputFile, isLibrary);
}

// /**
//  * Transforms each module of inputFiles list to an ES6 module (used for large opensource projects).
//  * @param inputFiles: list of input modules
//  * @returns
//  */
// function transformModules(moduleDependenceGraph, inputFiles) {

// 		var numOfNestedStatements = 0;
// 		var resultObject;
// 		var isPreconditionViolated = false;
// 		var transformViolatesPrecondition = false;
// 		var ans;
// 		inputFiles.buckets.forEach(function(fileList) {

// 			fileList.forEach(function(inputFile) {

// 				resultObject = doesModuleTransformationViolatePreconditions(inputFile);
// 				isPreconditionViolated = resultObject.isPreconditionViolated;
// 				numOfNestedStatements += resultObject.nestedStatements;
// 				if(isPreconditionViolated === true) {
		
// 					transformViolatesPrecondition = true;
// 					console.log('Transformation of ' + inputFile.fileName + ' leads to precondition violation. Consult nestedStatements.json file.');
		
// 					//move nested imports/exports of module, in order to bypass preconditions
// 					// moveNestedStatementsOfModule(inputFile);
// 				}
// 			});
// 		});

// 		if(transformViolatesPrecondition === true) {

// 			//transformation may affect the system's external behaviour
// 			//the user may proceed at the refactoring application at her own risk
// 			ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
// 			while(ans !== 'y' && ans !== 'n') {

// 				ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
// 			}

// 			if(ans === 'n') {

// 				console.log('Exiting.');
// 				return {

// 					"refactoredFilePaths": 0,
// 					"refactoredImportStatements": 0
// 				};
// 			}
// 		}
	
// 	// //retrieve module dependencies of each file of the analyzed system
// 	// //for each inputFile in inputFiles, create a JSON object and add it in a JSON object list
// 	// //write the JSON object list to a JSON file 
// 	// //(the JSON object list contains the transformations that need to be applied in the JS files of the analyzed system)
// 	// var outputStream = retrieveModuleDependenciesOfModules(moduleDependenceGraph, inputFiles);

// 	//fill the data structure containing objects that model:
// 	//(a) the inputFile that needs to be transformed
// 	//(b) the path to the json file containing the transformations that need to be performed in the inputFile
// 	//(c) the json file stream for reading
// 	retrieveModuleDependenciesOfModules(moduleDependenceGraph, inputFiles);

// 	// var resultObject;
// 	// inputFiles.buckets.forEach(bucket => {

// 	// 	console.log(bucket)
// 	// });
// 	var inputFileArray = inputFiles.buckets.reduce((fileObjects, currentBucket) => fileObjects.concat(currentBucket), []);
// 	// console.log(inputFileArray);

// 	//each file is kept in an array of form [key, value] in the file list (bucket)
// 	var refactoredFilePaths = inputFileArray.map(fileObject => fileObject[0]);

// 	jsonStreamList.forEach(fileObject => {

// 		let fileName = fileObject.inputFileName;
// 		let jsonFileName = fileObject.jsonFileName;
// 		let outputStream = fileObject.jsonFileStream;

// 		//read data after the output stream is closed
// 	outputStream.on('end', function() {

// 		//json object streaming: used for bigger projects
// 		// var readStream = fs.createReadStream('./resultFiles/result.json', {encoding: 'utf-8'});
// 		// console.log(require.resolve(jsonFileName));

// 		var readStream = fs.createReadStream(jsonFileName, {encoding: 'utf-8'});
		
// 		var parser = jsonStream.parse("*");
// 		readStream.pipe(parser).on('data', function(fileTransformationObject) {
				
// 				var fileInfo = fileTransformationObject.fileInfo;
				
// 				//fileTransformationObject: json object containing
// 				//the transformations that should be applied to a source file
// 				var fileName = fileInfo.fileName;
				
// 				//retrieve inputFile named fileName from list
// 	//			var sourceFile = fileUtilities.retrieveModuleInList(inputFiles, fileName);
				
// 				//retrieve transformations that need to be applied to sourceFile
// 				var transformationList = fileTransformationObject.transformationList;
// 	//			console.log(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true);

// 				// console.log(fileName);
// 				// console.log(fileInfo.moduleFramework);
				
// 				if(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
					
// 					resultObject = commonJSTransformUtilities.transformCommonJSModule(fileName, transformationList);
// 				}
// 				else if(fileInfo.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

// 					resultObject = amdTransformationUtilities.transformAMDModule(fileName, transformationList);
// 				}
// 				else {

// 					//case: plain JS module
// 					resultObject = plainJSTransformationUtilities.transformPlainJSModule(fileName, transformationList);
// 				}
					
// 				// var refactoredFileName = resultObject.filePath.replace("sourceFiles", "refactoringResults");
					
// 				// refactoredFileName = refactoredFileName.replace('.js', '-es6.js');
					
// 				// refactoredFileName = path.dirname(refactoredFileName) + '\\' + path.basename(refactoredFileName, '.js') + '-es6.js';

// 				// refactoredFileName = path.dirname(refactoredFileName) + path.sep + path.basename(refactoredFileName, '.js') + '-es6.js';

// 				var refactoredFileName = fileName;
// 				console.log('Writing code to ' + refactoredFileName + '...\n');
					
// 				//create refactoredFileName's folder synchronously (create any subfolders, if necessary)
// 				mkdirp.sync(path.dirname(path.resolve(refactoredFileName)));
					
// 				// console.log(path.dirname(path.resolve(refactoredFileName)));
// 				fs.writeFileSync(refactoredFileName, resultObject.astRootCollection.toSource(), 'utf-8');
// 		});
// 	});
// 	});

// 	resultObject.refactoredFilePaths = refactoredFilePaths;
	
// 	//return refactored files' paths (the paths are needed during the transpilation down to ES5)
// 	return resultObject;
	
// }

/**
 * Transforms each module of inputFiles list to an ES6 module (used for small opensource projects).
 * @param moduleDependenceGraph: the MDG used for the transformation of the system's files
 * @param inputFiles: list of input modules
 * @param projectTypeIndex: the system's type (CJS/AMD/non-modular ES5), useful for specifying the module feature scope
 * @param isLibrary: the fact that the analyzed system is a library, useful for specifying the transformation type (default value is false)
 * @returns
 */
function transformModules(moduleDependenceGraph, inputFiles, projectTypeIndex, isLibrary = false) {

	let numOfNestedStatements = 0;
	let resultObject;
	let isPreconditionViolated = false;
	let transformViolatesPrecondition = false;
	let ans;

	inputFiles.buckets.forEach(fileList => {

		fileList.forEach(inputFile => {

			resultObject = doesModuleTransformationViolatePreconditions(inputFile[1]);
			// console.log(resultObject);
			isPreconditionViolated = resultObject.isPreconditionViolated;
			numOfNestedStatements += resultObject.nestedStatements;
			if(isPreconditionViolated === true) {
	
				transformViolatesPrecondition = true;
				console.log('Transformation of ' + inputFile[1].fileName + ' leads to precondition violation. Consult nestedStatements.json file.');
	
				//move nested imports/exports of module, in order to bypass preconditions
				// moveNestedStatementsOfModule(inputFile);
			}
		});
	});

	if(transformViolatesPrecondition === true) {

		//transformation may affect the system's external behaviour
		//the user may proceed at the refactoring application at her own risk
		ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
		while(ans !== 'y' && ans !== 'n') {

			ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
		}

		if(ans === 'n') {

			console.log('Exiting.');
			return {

				"refactoredFilePaths": 0,
				"refactoredImportStatements": 0
			};
		}
	}

	console.log(`Retrieving module dependencies of the analyzed system's files.`);
	console.log(`Is library: ${isLibrary}`);

	//fill the data structure containing objects that model:
	//(a) the inputFile that needs to be transformed
	//(b) the path to the json file containing the transformations that need to be performed in the inputFile
	//(c) the json file stream for reading
	retrieveModuleDependenciesOfModules(moduleDependenceGraph, inputFiles, projectTypeIndex, isLibrary);

	let inputFileArray = inputFiles.convertHashMapToArray();
	// console.log(inputFileArray);

	let refactoredFilePaths = inputFileArray.map(inputFile => inputFile.fileName);

	jsonStreamList.forEach(fileObject => {

		let fileName = fileObject.inputFileName;
		let jsonFileName = fileObject.jsonFileName;
		// let outputStream = fileObject.jsonFileStream;

		let fileContent = fs.readFileSync(jsonFileName, 'utf-8');

	// console.log(fileContent);

		let fileTransformationListObject = JSON.parse(fileContent);

		fileTransformationListObject.forEach(fileTransformationObject => {

			let fileInfo = fileTransformationObject.fileInfo;
				
			//fileTransformationObject: json object containing
			//the transformations that should be applied to a source file
			let fileName = fileInfo.fileName;
				
			//retrieve transformations that need to be applied to sourceFile
			let transformationList = fileTransformationObject.transformationList;
	//		console.log(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true);

			// console.log(fileName);
			// console.log(fileInfo.moduleFramework);
				
			if(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
					
				resultObject = commonJSTransformUtilities.transformCommonJSModule(fileInfo, transformationList);
			}
			else if(fileInfo.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

				resultObject = amdTransformationUtilities.transformAMDModule(fileInfo, transformationList);
			}
			else {

				//case: plain JS module
				resultObject = plainJSTransformationUtilities.transformPlainJSModule(fileInfo, transformationList);
			}

			let refactoredFileName = fileName;
			// var refactoredFileName = path.dirname(fileName) + path.sep + path.basename(fileName, '.js') + '.mjs';
			console.log('Writing code to ' + refactoredFileName + '...\n');
					
			//create refactoredFileName's folder synchronously (create any subfolders, if necessary)
			mkdirp.sync(path.dirname(path.resolve(refactoredFileName)));
					
			// console.log(path.dirname(path.resolve(refactoredFileName)));
			fs.writeFileSync(refactoredFileName, resultObject.astRootCollection.toSource(), 'utf-8');
		});
	});

	resultObject.refactoredFilePaths = refactoredFilePaths;

	//return refactored files' paths (the paths are needed during the transpilation down to ES5)
	return resultObject;

}

// /**
//  * Transforms each module of inputFiles list to an ES6 module (used for small projects).
//  * @param inputFiles: list of input modules
//  * @returns
//  */
// function transformModules(moduleDependenceGraph, inputFiles) {

// 	var numOfNestedStatements = 0;
// 	var resultObject;
// 	var isPreconditionViolated = false;
// 	var transformViolatesPrecondition = false;
// 	var ans;
// 	inputFiles.buckets.forEach(function(fileList) {

// 		fileList.forEach(function(inputFile) {

// 			resultObject = doesModuleTransformationViolatePreconditions(inputFile);
// 			isPreconditionViolated = resultObject.isPreconditionViolated;
// 			numOfNestedStatements += resultObject.nestedStatements;
// 			if(isPreconditionViolated === true) {
	
// 				transformViolatesPrecondition = true;
// 				console.log('Transformation of ' + inputFile.fileName + ' leads to precondition violation. Consult nestedStatements.json file.');
	
// 				//move nested imports/exports of module, in order to bypass preconditions
// 				// moveNestedStatementsOfModule(inputFile);
// 			}
// 		});
// 	});

// 	if(transformViolatesPrecondition === true) {

// 		//transformation may affect the system's external behaviour
// 		//the user may proceed at the refactoring application at her own risk
// 		ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
// 		while(ans !== 'y' && ans !== 'n') {

// 			ans = readlineSync.question('The refactoring might affect the system\'s external behaviour. Proceed (y/n)? ');
// 		}

// 		if(ans === 'n') {

// 			console.log('Exiting.');
// 			return {

// 				"refactoredFilePaths": 0,
// 				"refactoredImportStatements": 0
// 			};
// 		}
// 	}
	
// 	//retrieve module dependencies of each file of the analyzed system
// 	//for each inputFile in inputFiles, create a JSON object and add it in a JSON object list
// 	//write the JSON object list to a JSON file 
// 	//(the JSON object list contains the transformations that need to be applied in the JS files of the analyzed system)
// 	retrieveModuleDependenciesOfModules(moduleDependenceGraph, inputFiles);
	
// 	//read JSON file containing transformations that 
// 	//need to be applied to the files of the system
// 	var fileContent = fs.readFileSync('./resultFiles/result.json', 'utf-8');

// 	// console.log(fileContent);

// 	var systemTransformationObject = JSON.parse(fileContent);

// 	var resultObject;
// 	var refactoredFilePaths = [];

// 	let initialNamedImports = 0;
// 	let initialDefaultImports = 0;
// 	let initialImports = 0;

// 	let es6NamedImports = 0;
// 	let es6DefaultImports = 0;
// 	var refactoredImportStatements = 0;
// 	let isAnalyzedAppDesignedUsingCommonJS = false;
// 	let isAnalyzedAppDesignedUsingAMD = false;

// 	let destructuredObjects = 0;
// 	let exportedProperties = 0;

// 	let utilityModules = 0;
// 	let classModules = 0;

// 	let systemExportedDeclarations = 0;

// 	systemTransformationObject.forEach(function(fileTransformationObject) {

// 		var fileInfo = fileTransformationObject.fileInfo;

// 			//fileTransformationObject: json object containing
// 			//the transformations that should be applied to a source file
// 			var fileName = fileInfo.fileName;
			
// 			//retrieve inputFile named fileName from list
// //			var sourceFile = fileUtilities.retrieveModuleInList(inputFiles, fileName);
			
// 			//retrieve transformations that need to be applied to sourceFile
// 			var transformationList = fileTransformationObject.transformationList;
			
// //			console.log(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true);

// 			// console.log(fileName);
// 			// console.log(fileInfo.moduleFramework);
			
// 			if(fileInfo.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

// 				isAnalyzedAppDesignedUsingAMD = true;
// 				resultObject = amdTransformationUtilities.transformAMDModule(fileName, transformationList);
// 				refactoredImportStatements += resultObject.refactoredImportStatements;

// 				initialNamedImports += resultObject.initialNamedImports;
// 				initialDefaultImports += resultObject.initialDefaultImports;
// 				initialImports += resultObject.initialImports;

// 				es6NamedImports += resultObject.es6NamedImports;
// 				es6DefaultImports += resultObject.es6DefaultImports;
// 				// refactoredImportStatements += resultObject.es6Imports;

// 				destructuredObjects += resultObject.destructuredObjects;
// 				exportedProperties += resultObject.exportedProperties;
// 			}
// 			else if(fileInfo.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
				
// 				isAnalyzedAppDesignedUsingCommonJS = true;
// 				resultObject = commonJSTransformUtilities.transformCommonJSModule(fileName, transformationList);

// 				initialNamedImports += resultObject.initialNamedImports;
// 				initialDefaultImports += resultObject.initialDefaultImports;
// 				initialImports += resultObject.initialImports;

// 				es6NamedImports += resultObject.es6NamedImports;
// 				es6DefaultImports += resultObject.es6DefaultImports;
// 				refactoredImportStatements += resultObject.refactoredImportStatements;

// 				destructuredObjects += resultObject.destructuredObjects;
// 				exportedProperties += resultObject.exportedProperties;

// 				systemExportedDeclarations += resultObject.exportedDeclarations;

// 				if(resultObject.isUtilityModule !== undefined) {

// 					if(resultObject.isUtilityModule === true) {

// 						utilityModules++;
// 					}
// 					else {
	
// 						classModules++;
// 					}
// 				}
				
// 			}
// 			else {

// 				//case: plain JS module
// 				resultObject = plainJSTransformationUtilities.transformPlainJSModule(fileName, transformationList);

// 				initialNamedImports += resultObject.initialNamedImports;
// 				initialDefaultImports += resultObject.initialDefaultImports;
// 				initialImports += resultObject.initialImports;

// 				es6NamedImports += resultObject.es6NamedImports;
// 				es6DefaultImports += resultObject.es6DefaultImports;
// 				refactoredImportStatements += resultObject.refactoredImportStatements;

// 				destructuredObjects += resultObject.destructuredObjects;
// 				exportedProperties += resultObject.exportedProperties;

// 				systemExportedDeclarations += resultObject.exportedDeclarations;

// 				if(resultObject.isUtilityModule !== undefined) {

// 					if(resultObject.isUtilityModule === true) {

// 						utilityModules++;
// 					}
// 					else {
	
// 						classModules++;
// 					}
// 				}
// 			}

// 			// var refactoredFileName = resultObject.filePath.replace("sourceFiles", "refactoringResults");

// 			//update: write transform file in the same path with the initial files
// 			var refactoredFileName = resultObject.filePath;

// 			// refactoredFileName = refactoredFileName.replace('.js', '-es6.js');

// 			// refactoredFileName = path.dirname(refactoredFileName) + path.sep + path.basename(refactoredFileName, '.js') + '-es6.js';
// 			console.log('Writing code to ' + refactoredFileName + '...\n');

// 			//create refactoredFileName's folder synchronously (create any subfolders, if necessary)
// 			mkdirp.sync(path.dirname(path.resolve(refactoredFileName)));

// 			// console.log(resultObject.astRootCollection.toSource());

// 			// console.log(path.dirname(path.resolve(refactoredFileName)));
// 			fs.writeFileSync(refactoredFileName, resultObject.astRootCollection.toSource(), 'utf-8');

// 			refactoredFilePaths.push(refactoredFileName);
// 	});

	
// 	//if(isAnalyzedAppDesignedUsingCommonJS === true || isAnalyzedAppDesignedUsingAMD === true) {

// 		let msg = "#Destructured objects: " + destructuredObjects + "\n#Exported properties: " + exportedProperties + "\n";
// 		msg += '#Initial named imports: ' + initialNamedImports + '\n#Initial default imports: ' + initialDefaultImports + '\n#Initial imports: ' + initialImports +
// 				  '\n\n#ES6 named imports: ' + es6NamedImports + '\n#ES6 default imports: ' + es6DefaultImports + '\n#ES6 imports: ' + refactoredImportStatements;
// 		msg += '\n#Modules: ' + systemTransformationObject.length + '\n#Utility modules: '	+ utilityModules + '\n#Class modules: ' + classModules;	

// 		let numOfDeclarations = 0;
// 		inputFiles.buckets.forEach(function(fileList) {

// 			//each file list contains pairs of [key, value] elements for each inputFile
// 			fileList.forEach(function(fileObject) {
	
// 				let inputFile = fileObject[1];
	
// 				//exclude topLevelScope function (artificial function object
// 				//created in order to model the module's scope)
// 				numOfDeclarations += inputFile.definedFunctions.length-1;
// 				numOfDeclarations += inputFile.explicitGlobals.length;
// 				numOfDeclarations += inputFile.exportedProperties.length;
// 			});
// 		});
// 		msg += '\n#Total Declarations: ' + numOfDeclarations + 
// 			   '\n#Exported Declarations: ' + systemExportedDeclarations + 
// 			   '\n#Encapsulated Declarations: ' + (numOfDeclarations-systemExportedDeclarations);

// 		console.log(msg);
// 	//}
	
// 	//return refactored files' paths (the paths are needed during the transpilation down to ES5)
// 	// return refactoredFilePaths;
// 	return {

// 		"numOfNestedStatements": numOfNestedStatements,
// 		"refactoredFilePaths": refactoredFilePaths,
// 		"refactoredImportStatements": refactoredImportStatements
// 	};
// }

// /**
//  * Moves the nested imports/exports of inputFile at the start of the AST, in order to bypass preconditions
//  * @param {*} inputFile 
//  */
// function moveNestedStatementsOfModule(inputFile) {

// 	var jsonFileObjectArray = retrieveLocationsOfNestedStatementsOfModule(inputFile);
// 	var nestedStatements = jsonFileObjectArray[0].innerStatements;

// 	var startLine;
// 	var startColumn;
// 	var endLine;
// 	var endColumn;

// 	var expressionStatement;

// 	nestedStatements.forEach(function(nestedStatement) {

// 		statementType = nestedStatement.type;
// 		startLine = nestedStatement.loc.start.line;
// 		startColumn = nestedStatement.loc.start.column;
// 		endLine = nestedStatement.loc.end.line;
// 		endColumn = nestedStatement.loc.end.column;

// 		var statementCollection = inputFile.astRootCollection.find(jscodeshift.ExpressionStatement).filter(path => {

// 			var expressionLoc = path.value.expression.loc;
// 			return expressionLoc.start.line === startLine && expressionLoc.start.column === startColumn &&
// 				   expressionLoc.end.line === endLine && expressionLoc.end.column === endColumn;
// 		});

// 		// console.log(statementCollection.length);

// 		if(statementCollection.length === 1) {

// 			expressionStatement = statementCollection.at(0).get();

// 			// console.log(expressionStatement);

// 			//insert expression statement at the module's top-level scope (at the start of the AST)
// 			inputFile.astRootCollection.find(jscodeshift.Program).get('body',0).insertBefore(expressionStatement);

// 			// console.log('removing nested statement');
			
// 			//remove expression statement from the nested scope
// 			statementCollection.remove();
// 		}
// 	});

// 	fs.writeFileSync(inputFile.fileName, inputFile.astRootCollection.toSource(), 'utf-8');
// }

/**
 * Determines whether the transformation of the CommonJS module specified by inputFile
 * into an ES6 module leads to precondition violation.
 * @param {*} inputFile 
 */
function doesModuleTransformationViolatePreconditions(inputFile) {

	var jsonFileObjectArray = retrieveLocationsOfNestedStatementsOfModule(inputFile);

	if(jsonFileObjectArray.length === 0 || 
	   jsonFileObjectArray[0].innerStatements.length === 0) {

		 //there is no object for inputFile (inputFile does not contain nested imports/exports),
		 //or (if object exists) inputFile does not contain nested imports/exports
		 //its transformation into an ES6 module does not affect the system's behaviour

		return {

			isPreconditionViolated: false,
			nestedStatements: 0
		 };
	}

	return {

		isPreconditionViolated: true,
		nestedStatements: jsonFileObjectArray[0].innerStatements.length
	 };
}

/**
 * Retrieves the nested imports/exports of inputFile.
 * (Needed for performing transformations in the initial source code in order to bypass preconditions).
 * @param {*} inputFile 
 */
function retrieveLocationsOfNestedStatementsOfModule(inputFile) {

	var jsonFilePath = './resultFiles/nestedStatements.json';
	var jsonFileContent;
	var jsonObjectArray;
	var jsonFileObjectArray = [];

	if(fs.existsSync(jsonFilePath) === true) {

		//json file with the system's nested import/export statements exists
		jsonFileContent = fs.readFileSync(jsonFilePath, 'utf-8');
		jsonObjectArray = JSON.parse(jsonFileContent);

		jsonFileObjectArray = jsonObjectArray.filter(function(value) {

			// console.log(value);

			//find the object representing inputFile
			return value["fileName"].localeCompare(inputFile.fileName) === 0;
		});

	}
	
	//return the locations of inputFile's nested statements
	return jsonFileObjectArray;
}

exports.transformModules = transformModules;
exports.retrieveModuleDependenciesOfModules = retrieveModuleDependenciesOfModules;