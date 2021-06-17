/**
 * http://usejsdoc.org/
 */

var fs = require('fs');
const process = require('process');
const path = require('path');

var preprocessingUtilities = require('../preprocessing/preprocessingUtilities.js');
var cmdUtilities = require('./cmdUtilities.js');
var configurationFileUtilities = require('./configurationFileUtilities.js');
var statisticsUtilities = require('./statisticsUtilities.js');

var util = require('../analysis/ast/util/util.js');
var enums = require('../analysis/ast/util/enums.js');
var fileUtilities = require('../io/fileUtilities.js');
var metricUtilities = require('../analysis/metrics/metricUtilities.js');
var mdgUtilities = require('../analysis/mdg/mdgUtilities.js');
var resultUtilities = require('../analysis/transformationUtilities/resultUtilities.js');
var transformationUtilities = require('../analysis/transformationUtilities/transformationUtilities.js');

function main() {

	/**
	 * All command line arguments are available in the options package
	 * Run the command below to show the help
	 * 
	 * run node src\tool\main.js -h   
	 * 
	 * Examples of use:
	 * 
	 * run node src\tool\main.js --system CommonJS --entryFile ..\..\goojs\src\goo\animationpack\index.js ..\..\goojs\src\goo\animationpack 
	 * 
	 * The above command has default options <analysis, ignoreTest=true> and has the last argument as default (src argument)
	 * 
	 **/ 
	const options = cmdUtilities.parseArgs();

	// use https://github.com/75lb/command-line-args module for handling command line arguments
	if (options.help) {
		return;
	}

	var directory = options.src.filename;

	var projectType = options.system;
	var projectTypeIndex = Object.values(enums.ModuleFramework).indexOf(projectType);

	if (projectTypeIndex === -1) {
		
		//program terminates in the case that the user doesn't specify a valid module system
		console.log('Specified non-existent module system (available are: CommonJS, AMD, plainJS). Exiting.');
		return;
	}

	var programMode = '--' + options.command;
	var programModeIndex = Object.values(enums.ProgramMode).indexOf(programMode);

	if (programModeIndex === -1) {

		//program terminates in the case that the user doesn't specify a valid action upon the input project
		//also, a third option (preprocessing: add the 'use script' directive in non-strict mode code)
		console.log('Specified invalid execution mode (available are: --preprocess, --analysis, --refactoring). Exiting.');
		return;
	}

	let projectEntryFile = options.entryFile == null ? null : options.entryFile.filename;
	if(projectEntryFile == undefined && projectType !== 'plainJS') {

		//project entry file null or undefined
		console.log('Did not specify the system\'s entry file. Exiting.');
		return;
	}

	if(projectEntryFile == undefined && projectType === 'CommonJS') {

		//project entry file null or undefined
		console.log('Did not specify the system\'s entry file. Exiting.');
		return;
	}

	//process input project according to the options specified by the user
	processInputProject(options);
}

/**
 * Processes the input project, according to the command line options specified by the user.
 * @param {*} cmdOptions 
 */
function processInputProject (cmdOptions) {

	//remove json files from resultDirectory
	let resultDirectory = './resultFiles';

	let jsonFiles = [];
	fileUtilities.removeJSONFilesFromResultDirectory(resultDirectory, jsonFiles);

	//files that are fully excluded from analysis (e.g. npm packages) (applies to CommonJS)
	//exclude directories with empty names
	let excludedFiles = cmdOptions.excludedFiles;
	let excludedDirectoryArray = excludedFiles.split(/[=,]+/);
	excludedDirectoryArray = excludedDirectoryArray.filter(excludedDirectory => {

		return excludedDirectory !== '';
	});

	//libraries that are partially excluded from analysis (e.g. external libraries) (applies to AMD)
	let libraryFiles = cmdOptions.externalLibraries;
	let libraryFileArray = libraryFiles.split(/[=,]+/);
	libraryFileArray = libraryFileArray.filter(libraryFile => {

		return libraryFile !== '';
	});

	//update external libraries 
	//(prevent conflicts between project files and external libraries)
	fileUtilities.updateExternalLibraries(libraryFileArray);

	//files that are partially excluded from analysis 
	//(for the test files, we need to resolve their module variables/functions and their imported declarations)
	let ignoreTestsOption = cmdOptions.ignoreTests;
	let testFiles = cmdOptions.tests;
	let testFileDirectoryArray = testFiles.split(/[=,]+/);
	testFileDirectoryArray = testFileDirectoryArray.filter(testDirectory => {

		return testDirectory !== '';
	});

	//the entry file's full path
	let projectEntryFile = cmdOptions.entryFile == null ? null : cmdOptions.entryFile.filename;
	let projectEntryFileAbsolutePath = projectEntryFile === null ? null : require.resolve(path.resolve(projectEntryFile));

	let files = [];
	let directory = cmdOptions.src.filename;

	let programMode = '--' + cmdOptions.command;

	//the analyzed project is a library-
	//module features are exported, regardless of their use
	//(syntax transformation)
	let isLibrary = cmdOptions.library;

	console.log(`Analyzed system is a library: ${isLibrary}.`);

	// let prgHrStart = process.hrtime();
	let hrstart = process.hrtime();
	// let prgStart = hrstart;

	//retrieve JS files located in directory
	let fileList = fileUtilities.retrieveSourceFilesInDirectory(directory, files, excludedDirectoryArray);

	console.log('Number of JS files: ' + fileList.length);

	//create astRootCollection of each file and retrieve modules defined within each file
	let inputFiles = util.retrieveModuleDefinedInFiles(fileList, excludedDirectoryArray, testFileDirectoryArray, libraryFileArray, projectEntryFileAbsolutePath);

	//useful for viewing file distribution
	// console.log(inputFiles.convertHashMapToArray().map(inpFile => inpFile.fileName))
	// return;
	// inputFiles.printBucketStats();

	if(programMode === enums.ProgramMode.preprocess) {

		//convert non-strict code to strict code (do not proceed)
		preprocessingUtilities.convertNonStrictCodeInStrictCode(inputFiles);
		return;
	}

	//used for debugging purposes
	// inputFiles.printInputFiles();

	// hrstart = process.hrtime(hrstart);
	// console.info('\nTime for file retrieval and AST construction: %ds (%dms)', hrstart[0], hrstart[1] / 1000000);

	let projectType = cmdOptions.system;
	let projectTypeIndex = Object.values(enums.ModuleFramework).indexOf(projectType);

	if (projectType === enums.ModuleFramework.AMD) {

		//project contains AMD modules - search for module paths that are specified by the user (if any)
		util.updateSourceFileAliases(inputFiles);
	}

	//add files to the server of ternjs once
	//(does NOT work: what if multiple modules define the same module variable? applies to CommonJS case)
	// util.loadFilesOnTernServer(inputFiles);

	//(i) retrieve module variables and function hierarchy of each file
	inputFiles.buckets.forEach(
		entryArray => entryArray.forEach(
			entry => util.processGlobalsAndFunctionsDefs(entry[1], projectTypeIndex, inputFiles, excludedDirectoryArray, testFileDirectoryArray))
	);

	console.info('Generated code hierarchy.');
	// return;

	// hrstart = process.hrtime(hrstart);
	// console.info('\nTime for code hierarchy model construction: %ds', hrstart[0]+hrstart[1] / 1000000000);

	//used for debugging purposes
	// sourceFile.dumpExportedDefinitionsOfSourceFile();

	//(ii) retrieve implied globals of each JS source file
	inputFiles.buckets.forEach(
		entryArray => entryArray.forEach(
			entry => util.processImpliedGlobals(entry[1], inputFiles))
	);

	// hrstart = process.hrtime(hrstart);
	// console.info('\nTime for exported declaration and implied global retrieval: %ds (%dms)', hrstart[0], hrstart[1] / 1000000);

	let result = "";

	//assess common coupling occurences in the system (common coupling assessment - requires the detection of
	//the variables and function imported in the module)

	//calculate the number of the objects that are exported from each module
	//and their properties
	// statisticsUtilities.assessNumberOfExportedObjectsAndTheirProperties(inputFiles);

	// console.log('Retrieving imported features of each module.');

	//retrieve each module's imported features, along with their uses
	let commonCoupledModuleSets = metricUtilities.assessCommonCouplingOccurencesInSystem(inputFiles);

	console.log('Retrieved imported features of each module.');

	//remove files from Tern server
	// util.removeFilesFromTernServer(inputFiles);

	// hrstart = process.hrtime(hrstart);
	// console.info('\nTime for imported declaration retrieval: %ds (%dms)', hrstart[0], hrstart[1] / 1000000);

	let moduleDependenceGraph = mdgUtilities.createMDG(inputFiles, directory);

	// hrstart = process.hrtime(hrstart);
	// console.info('\nMDG construction time: %ds (%dms)', hrstart[0], hrstart[1] / 1000000);

	let analTime = process.hrtime(hrstart);
	// console.log(analTime)

	if (projectType.includes(enums.ModuleFramework.CommonJS) === true) {

		//update the imported definition's cohesion
		//(needed to determine whether imported and re-exported objects should be destructured during export)
		//applies to CommonJS
		moduleDependenceGraph.updateCohesionOfImportedDefinitions();

		//after constructing the MDG and before processing module dependencies of each file (even for stats),
		//decide whether each imported element/namespace is imported and re-exported from its definition module
		mdgUtilities.updateImportedAndReexportedFeatures(moduleDependenceGraph, inputFiles, isLibrary);
	}

	//print MDG to file (debug function - needed for searching upon the MDG)
	moduleDependenceGraph.printMDGToFile();

	//analysis flag provided - do not proceed to the refactoring section (only create csv file)
	statisticsUtilities.dumpProjectInformationToCSVFile(path.basename(directory), inputFiles, moduleDependenceGraph, isLibrary);
	statisticsUtilities.calculateAnalysisStatsForExportedMFs(path.basename(directory), inputFiles, isLibrary);
	statisticsUtilities.classifyModuleObjects(path.basename(directory), inputFiles);

	if(programMode === enums.ProgramMode.analysis) {

		console.log('Created MDG. Exiting analysis...');
		return;
	}

	console.log('Created MDG. Transforming JS source files to modules...');

	// console.log(inputFiles.buckets.length);

	// console.log(`is library: ${isLibrary}`);
	let resultObject = transformationUtilities.transformModules(moduleDependenceGraph, inputFiles, projectTypeIndex, isLibrary);

	let refactoredFilePaths = resultObject.refactoredFilePaths;
	
	let transformTime = process.hrtime(hrstart);

	if (refactoredFilePaths.length > 0) {

		//after the application of the refactoring, update the refactored system's configuration files
		//generate files in the same path with the initial files
		configurationFileUtilities.generateConfigurationFilesOfApplication(directory, refactoredFilePaths, inputFiles, testFileDirectoryArray);
		// configurationFileUtilities.generateConfigurationFilesOfApplication(directory.replace("sourceFiles", "refactoringResults"), refactoredFilePaths);

		// console.log('#Refactored import statements of system (total): ' + resultObject.refactoredImportStatements);
		console.log('#Violated preconditions: ' + (resultObject.numOfNestedStatements != null ? resultObject.numOfNestedStatements : 0));
	}

	moduleDependenceGraph.visualizeGraph();

	// let prgEnd = process.hrtime(prgStart);

	// console.log(analTime)
	// console.log(transformTime)

	let analysisTime = analTime[0] + analTime[1] / 1000000000;
	let transformationTime = transformTime[0] + transformTime[1] / 1000000000;
	console.info('\nAnalysis time: %ds', analysisTime);
	console.info('Transformation time: %ds', transformationTime-analysisTime);
	console.info('Total execution time: %ds', transformationTime);
}

main();

