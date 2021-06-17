/**
 * fileUtilities.js. Provides utlities regarding file processing.
*/

const os = require('os');
var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');

var mkdirp = require('../../node_modules/mkdirp');
var jsonStream = require('../../node_modules/JSONStream');

var enums = require('../analysis/ast/util/enums.js');

var commonJSUtilities = require('../analysis/metrics/commonJSUtilities/commonJSUtilities.js');
var amdUtilities = require('../analysis/metrics/amdUtilities/amdUtilities.js');
var es6Utilities = require('../analysis/metrics/es6Utilities/es6Utilities.js');

var externalLibraries = [];

function updateExternalLibraries(externalLibraryArray) {

	//the 1st, 3rd, ... index keeps the name of the library's exported object name
	externalLibraries = externalLibraryArray.filter(externalLib => {

		let externalLibIndex = externalLibraryArray.indexOf(externalLib);
		return externalLibIndex !== -1 && externalLibIndex % 2 === 0;
	});
}

/**
 * Returns the version and module framework of code within sourceFile (ES6, CommonJS or AMD)
 * @param sourceFile
 * @returns
 */
function retrieveVersionOfCode(sourceFile) {

	if(sourceFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

		//is sourceFile an AMD module? (case: module implemented to run both on server and on client)
		var isAMDModule = amdUtilities.isSourceFileAnAMDModule(sourceFile);

		//what if a module is not an amd module? (it is a plain JS module defining functions/variables in its top-level scope)
		if(isAMDModule === false) {

			sourceFile.moduleFramework = [];
			sourceFile.moduleFramework.push(enums.ModuleFramework.plain);
		}
	}

}

/**
 * Reads the file pointed by sourceFileName and returns its contents.
 * @param {*} sourceFileName 
 */
function retrieveSourceCodeFromFile(sourceFileName) {
	return fs.readFileSync(sourceFileName, 'utf-8');
}

/**
 * Retrieves the json files located within directory
 * @param {*} directory 
 */
function retrieveJSONFilesFromDirectory(directory, jsonFileList) {

	var jsonFileList = jsonFileList || [];
	
	var isDirectory = fs.statSync(directory).isDirectory();
	var filePath;

	if(isDirectory === false ) {

		return jsonFileList;
	}

	var files = fs.readdirSync(directory);
	files.forEach(function(file) {

		let filePath = directory + "/" + file;
		
		try {

			if(fs.statSync(filePath).isDirectory() === true) {
				
				//current file corresponds to a directory
				retrieveJSONFilesFromDirectory(directory + "/" + file, jsonFileList);
			}
			else if (file.endsWith('json') === true) {
					
				//include only js sourcefiles in result list (do not analyze tests!!!)
				filePath = path.resolve(directory + "/" + file);
				jsonFileList.push(filePath);
			}
		}
		catch(err) {

			console.log('File ' + filePath + ' does not exist. Proceeding...');
		}
					
	});

	return jsonFileList;
}

function retrieveBabelrcFileInDirectory(directory, ignoreTestsArray, testFileDirectoryArray) {

	return retrieveFilesInDirectory(directory, [], '.babelrc', ignoreTestsArray, testFileDirectoryArray);
}

/**
 * Removes json files from directory synchronously (needed in order to prevent json file overwriting using JSONStream).
 * @param resultFirectory
 * @returns
 */
function removeJSONFilesFromResultDirectory(resultDirectory, jsonFileList) {

	if(fs.existsSync(resultDirectory) === false) {

		console.log(`Directory ${resultDirectory} does not exist. Resuming to project analysis.`);
		fs.mkdirSync(resultDirectory);
		return;
	}

	//list json files located within resultDirectory
	var fileList = retrieveJSONFilesFromDirectory(resultDirectory, jsonFileList);

	fileList.forEach(function(filePath) {
		
		//erase file synchronously
		try {

			fs.unlinkSync(filePath);
		}
		catch(err) {

			console.log('File ' + filePath + ' not found.');
		}

	});
}

/**
 * Removes the directory containing the application's files that resulted from older executions of the tool.
 * (Prevent errors related to project's file copying).
 * @param {*} projectDirectory 
 */
function removeOldProjectFolderFromResultDirectory(projectDirectory) {

	var oldProjectDirectory = projectDirectory.replace("sourceFiles", "refactoringResults");

	// console.log(oldProjectDirectory);

	if(fs.existsSync(oldProjectDirectory) === true) {

		rimraf.sync(oldProjectDirectory);
	}
}

/**
 * Resolves files in directory synchronously.
 * @param directory
 * @returns
 */
function retrieveSourceFilesInDirectory(directory, fileList, excludedDirectoryArray) {

	return retrieveFilesInDirectory(directory, fileList, '.js', excludedDirectoryArray);
}

/**
 * Resolves files in directory synchronously.
 * @param directory
 * @returns the files listed in directory (the type of these files is determined by extension).
 */
function retrieveFilesInDirectory(directory, fileList, extension, excludedDirectoryArray) {
	fileList = fileList || [];
	
	var isDirectory = fs.statSync(directory).isDirectory();
	var copiedFileName;
	var filePath;

	if(isDirectory === false) {

		return fileList;
	}

	var files = fs.readdirSync(directory);
	files.forEach(file => {

		let excludedDirectories = excludedDirectoryArray.filter(excludedDirectory => {

			return file === excludedDirectory;
		});

		if(excludedDirectories.length > 0) {

			//file (either a file or a directory) included in excludedDirectories
			//proceed to the next file
			return;
		}
			
		if(fs.statSync(directory + "/" + file).isDirectory() === true) {
				
			//search for js sourcefiles inside directory
			retrieveFilesInDirectory(directory + "/" + file, fileList, extension, excludedDirectoryArray);
		}
		else if (file.endsWith(extension) === true) {
				
			//(i) do not analyze files created during packaging or minified code files,
			//analyze min files only in the case that they are external libraries)
			//(ii) tests are analyzed and their import statements are modified to ES6 imports
			//for the transition from CommonJS default exports to ES6 named exports
			filePath = path.resolve(directory + "/" + file);
			fileList.push(filePath);
		}
	});
	
	return fileList;
}

/**
 * Retrieves usages of instance variables in functions defined within sourceFile.
 * @param sourceFile
 * @returns
 */
function retrieveInstanceVariableUsagesInFunctionsOfFile(sourceFile) {
	
	var definedFunctions = sourceFile.definedFunctions;
	
	//for each function defined within sourceFile...
	definedFunctions.forEach(function(definedFunction) {
		
		//... retrieve the instance variables it makes use of
		retrieveInstanceVariableUsagesInFunction(definedFunction);
	});
	
//	return null;
}

/**
 * Returns the file node representing sourceFileName in sourceFiles' list.
 * @param sourceFiles the input file hashmap
 * @param sourceFileName
 * @returns
 */
function retrieveModuleInList(sourceFiles, sourceFileName) {
	
	//resolve the path to sourceFileName,
	//with respect to the input file folder
	//create relative paths without dots, in order to search
	//filePath in input file list

	// console.log('sourceFileName: ' + sourceFileName);
	//sourceFileName ends with extension
	// var filePath;
	// if(sourceFileName.endsWith('.js') === true) {
		
	// 	filePath = sourceFileName.substring(0, sourceFileName.lastIndexOf('.'));
	// }
	// else {
		
	// 	filePath = sourceFileName;
	// }
	
	// filePath = filePath.split('.').join("");
	// filePath = filePath.replace(/\//g, "\\");

	// console.log('f: ' + path.resolve(filePath));
	// console.log('f: ' + filePath);
	
	//search file in input file list
// 	for(var fileIndex = 0; fileIndex < sourceFiles.length; fileIndex++) {
		
// 		var sourceFile = sourceFiles[fileIndex];

// 		// console.log('s:' + sourceFile.fileName);
// 		// console.log('f: ' + filePath);
// 		// console.log(sourceFile.fileName.indexOf(sourceFileName) + " " + sourceFile.fileName.indexOf(filePath));
		
// 		//search by either absolute or relative path
// 		//case: moduleName with multiple dots (i.e. server.node.js in react-dom package)
// //		if(sourceFile.fileName === sourceFileName ||
// 		// if(sourceFile.fileName.indexOf(sourceFileName) !== -1 ||
// 		//    sourceFile.fileName.indexOf(filePath) !== -1) {

// 		// 	return sourceFile;
// 		// }

// 		// console.log(require.resolve(sourceFile.fileName) + " " + require.resolve(sourceFileName));
// 		// console.log(require.resolve(sourceFileName));
		
// 	}

	try {

		// console.log(`Resolving ${sourceFileName} in input file hash map.`);
		let key = require.resolve(sourceFileName);
		key = key.replace(/\//g, "\\");
		// console.log(key);
		// console.log(require.resolve(sourceFileName).replace(/\//g, "\\\\"));
		let importedFile = sourceFiles.retrieveInputFileInMap(key);
		// console.log(importedFile.fileName);
		return importedFile === undefined ? null : importedFile;
	}
	catch(err) {

		console.log(`Failed to retrieve ${sourceFileName} in hashmap. Resuming to imported feature retrieval.`);
		return null;
	}
	
	// console.log(importedFile);

	// return importedFile === undefined ? null : importedFile;

	// try {

	// 	for(var fileIndex = 0; fileIndex < sourceFiles.length; fileIndex++) {
		
	// 		var sourceFile = sourceFiles[fileIndex];
	
	// 		// console.log(require.resolve(sourceFile.fileName) === require.resolve(sourceFileName));
	// 		if(require.resolve(sourceFile.fileName) === require.resolve(sourceFileName)) {

	// 			return sourceFile;
	// 		}
			
	// 	}

	// 	return null;
	// }
	// catch(e) {

	// 	return null;
	// }
	
}

/**
 * Is file an external library file?
 * @param {*} inputFile 
 */
function doesFileContainCodeFromExternalLibrary(inputFile) {

	//update: do not analyze code from external libraries (which are compatible with both commonjs and amd)
	return isFileAnExternalLibrary(inputFile.fileName);
}

/**
 * Should be deprecated, since it is used only in client-side code.
 * Alternative: libraries should be specified manually by the user.
 * @param {*} fileName 
 */
function isFileAnExternalLibrary(fileName) {

	//update: do not analyze code from external libraries (applies to AMD)
	var basename;

	if(fileName === undefined) {

		return false;
	}

	for(var libraryIndex = 0; libraryIndex < externalLibraries.length; libraryIndex++) {

		basename = path.basename(fileName, '.js');
		if(basename.endsWith(externalLibraries[libraryIndex]) === true || basename.includes(externalLibraries[libraryIndex]) === true) {

			//fileName corresponds to an external library (jquery,backbone,underscore,require)
			return true;
		}
	}

	return false;
}

/**
 * 
 * @param {string} file_path : File path
 * Returns a platform specific path as concerning directory separators
 */
function getOSAdjustedPath(filePath){
	var osSpecificPath = filePath;
	if (os.platform() === 'win32'){
		osSpecificPath = filePath.replace(/\//ig, "\\");
	}
	return osSpecificPath;
}

/**
 * Writes JSON object to file asynchronously
 * (needed for large JSON objects).
 * @param {*} jsonFile 
 * @param {*} jsonObject 
 */
function writeJSONObjectToFile(jsonFile, jsonObject) {

	let jsonFilePtr = fs.createWriteStream(jsonFile);
	let jsonFileStream = jsonStream.stringify(null, null, null, 4);
	jsonFileStream.pipe(jsonFilePtr);
	jsonFileStream.write(jsonObject);
	jsonFileStream.end();
}

exports.updateExternalLibraries = updateExternalLibraries;
exports.retrieveVersionOfCode = retrieveVersionOfCode;
exports.retrieveSourceCodeFromFile = retrieveSourceCodeFromFile;
exports.removeJSONFilesFromResultDirectory = removeJSONFilesFromResultDirectory;
exports.retrieveSourceFilesInDirectory = retrieveSourceFilesInDirectory;
exports.retrieveInstanceVariableUsagesInFunctionsOfFile = retrieveInstanceVariableUsagesInFunctionsOfFile;
exports.retrieveModuleInList = retrieveModuleInList;
exports.doesFileContainCodeFromExternalLibrary = doesFileContainCodeFromExternalLibrary;

exports.retrieveJSONFilesFromDirectory = retrieveJSONFilesFromDirectory;
exports.retrieveBabelrcFileInDirectory = retrieveBabelrcFileInDirectory;
exports.removeOldProjectFolderFromResultDirectory = removeOldProjectFolderFromResultDirectory;
exports.path = getOSAdjustedPath;
exports.writeJSONObjectToFile = writeJSONObjectToFile;