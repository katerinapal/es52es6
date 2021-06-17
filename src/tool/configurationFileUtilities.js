/**
 * Configuration file utilities. Module that modifies the analyzed application's
 * configuration files.
 */

 var fs = require('fs');
 var path = require('path');
 var jscodeshift = require('../../node_modules/jscodeshift');

var fileUtilities = require('../io/fileUtilities.js');
var enums = require('../analysis/ast/util/enums.js');

/**
 * Retrieves property named propertyName in the json object specified by jsonObject
 * @param {*} jsonObject 
 * @param {*} propertyName 
 */
function retrievePropertyOfJsonObject(jsonObject, propertyName) {

    if(jsonObject.hasOwnProperty(propertyName) === true) {

        //jsonObject has a property named propertyName - return value of property
        return jsonObject[propertyName];
    }

    //jsonObject has not a property named propertyName - create property
    jsonObject[propertyName] = {};
    return jsonObject[propertyName]; 
}

/**
 * Creates a script for the execution of all the transpilation scripts 
 * of the array specified by transpilationScripts at once.
 * @param {*} transpilationScripts 
 */
function createApplicationTranspilationScript(transpilationScripts) {

    var transpilationScriptCommand = "";
    var transpilationScriptIndex;
    for (transpilationScriptIndex = 0; transpilationScriptIndex < transpilationScripts.length; transpilationScriptIndex++) {

        transpilationScriptCommand += "npm run " + transpilationScripts[transpilationScriptIndex];
        if(transpilationScriptIndex < transpilationScripts.length-1) {

            //add the and operator in the case that the processed transpilationScript is not the last
            transpilationScriptCommand += " && ";
        }
    }

    return transpilationScriptCommand;
}

/**
 * Helper function. Determines if the code of the module specified in inputFile
 * is in strict mode (needed in order to build the module's transpilation command).
 * @param {*} inputFile 
 */
function isSourceCodeOfModuleInStrictMode(inputFile) {

    let program = inputFile.astRootCollection.find(jscodeshift.Program);

    let objectLiterals = inputFile.astRootCollection.find(jscodeshift.Literal).filter(path => {

        if(typeof path.value.value !== 'string') {

            //object literal value not a string (object literal with nested object literals)
            return false;
        }

        var literalValue = path.value.value.replace(/"/g, '\'');
        
        return literalValue.includes('use strict') === true && path.parentPath.scope.isGlobal === true;
    });

    if(objectLiterals.length > 0) {

        //inputFile contains the 'use strict' literal (code is in strict mode)
        return true;
    }

    return false;
}

// /**
//  * Helper function. Determines the analyzed code's mode (strict/non-strict).
//  * Based on that, the respective babel plugin will be introduced in package.json.
//  */
// function isSourceCodeOfAnalyzedSystemInStrictMode(inputFiles) {

//     for(let fileIndex = 0; fileIndex < inputFiles.length; fileIndex++) {

//         let inputFile = inputFiles[fileIndex];
        
//         if(isSourceCodeOfModuleInStrictMode(inputFile) === true) {

//             //inputFile's code is in strict mode (the respective transpilation npm package must be appended in package.json)
//             return true;
//         }
//     }

//     //none of the input files contains the 'use strict' literal (code is in non-strict mode)
//     return false;
// }

/**
 * Modifies the package.json file located in resultDirectory.
 * @param {*} resultDirectory - the directory containing the refactored system
 */
function updatePackageJsonFileOfAnalyzedApplication(resultDirectory, refactoredFilePaths, inputFiles, testFileDirectoryArray) {

    let jsonFileList = [];

    //list the json files located within resultDirectory
    var fileList = fileUtilities.retrieveJSONFilesFromDirectory(resultDirectory, jsonFileList);
    var fileIndex;
    var filePath;
    var fileContent;

    var configurationJsonObject;
    var devDependencies;

    var scripts;
    var scriptName;
    var scriptCommand;
    var transpiledFilePath;
    var transpilationScripts = [];

    var transpilationScriptName;

    var refactoredFile;
    var transpiledFile;
    var transpilationScriptIndex;
    var transpilationCommandIndex;

    var transpilationCommandName;
    var transpilationCommand;

    for(fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

        filePath = fileList[fileIndex];
        if(filePath.endsWith('package.json') === true &&
           path.dirname(filePath) === path.resolve(resultDirectory)) {

            //file corresponds to package.json - modify file (insert babel 
            //packages and scripts for the transpilation of ES6 modules to ES5)

            //(1) read and parse file
            fileContent = fs.readFileSync(filePath, 'utf-8');
            configurationJsonObject = JSON.parse(fileContent);

            updatePackageJsonObjectOfAnalyzedApplication(configurationJsonObject, inputFiles, refactoredFilePaths, transpilationScripts, filePath);
        }

    }

    if(fileList.length === 0) {

        //package.json does not exist (create it in the project's directory)
        configurationJsonObject = {};
        filePath = resultDirectory + '\\package.json';
        updatePackageJsonObjectOfAnalyzedApplication(configurationJsonObject, inputFiles, refactoredFilePaths, transpilationScripts, filePath);
    }

}

/**
 * Updates the JSON object that configures the npm dependencies along with the transpilation commands.
 */
function updatePackageJsonObjectOfAnalyzedApplication(configurationJsonObject, inputFiles, refactoredFilePaths, transpilationScripts, filePath) {

    //(2) modify the devDependencies field of configurationJsonObject (add babel packages for transpilation to ES5)
    var devDependencies = retrievePropertyOfJsonObject(configurationJsonObject, "devDependencies");
    devDependencies["babel-cli"] = "latest";
    devDependencies["babel-core"] = "latest";
    devDependencies["babel-plugin-add-module-exports"] = "latest";
    devDependencies["babel-plugin-transform-es2015-modules-commonjs"] = "latest";
    devDependencies["babel-polyfill"] = "latest";
    devDependencies["babel-plugin-transform-object-rest-spread"] = "latest";

    //add both transpilation packages (some modules are in non-strict, while other are in strict mode)
    devDependencies["babel-preset-env"] = "latest";

    //(3) add commands to "scripts" property (add transpilation scripts - only for CommonJS modules)
    let inputFileList = inputFiles.convertHashMapToArray();
    let clientModules = inputFileList.filter(inputFile => {

        return inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false;
    });

    if(clientModules.length > 0) {

        //write configureationJsonObject to filePath (modify json file)
        fs.writeFileSync(filePath, JSON.stringify(configurationJsonObject, null, 4), 'utf-8');
        return;
    }

    //transpile directories of files
    //except for files in the same directory with package.json
    let refactoredFileDirs = refactoredFilePaths.map(refFilePath => {

        return path.dirname(refFilePath);
    });

    //keep refFileDir only if it's first occurence in the array 
    //is located in its array slot
    refactoredFileDirs = refactoredFileDirs.filter((refFileDir, dirIndex) => {

        return refactoredFileDirs.indexOf(refFileDir) === dirIndex;
    });

    var scripts = retrievePropertyOfJsonObject(configurationJsonObject, "scripts");
    refactoredFileDirs.forEach(refactoredDirPath => {
        
        // console.log(filePath)
        // console.log(refactoredFilePath)

        //find the relative path to the refactored directory, based on the file of the json file
        let refactoredDirRelPath = path.relative(path.dirname(filePath), refactoredDirPath);

        //for each refactored file, create a script for its transpilation to ES5
        let scriptName = "compile-" + refactoredDirRelPath.replace(/[^\w\s]/gi, '');
        let scriptCommand;

        //directory in the same file with package.json
        if(refactoredDirRelPath === '') {

            return;
        }

        scriptCommand = "babel " + refactoredDirRelPath + " --out-dir " + refactoredDirRelPath + " --require babel-polyfill --presets env";

        //add script to the json property scripts
        scripts[scriptName] = scriptCommand;

        //add the inserted script's name to the array of the transpilation scripts
        if(transpilationScripts.includes(scriptName) === false) {

            transpilationScripts.push(scriptName);
        }
    });

    //transpile files in the same directory with package.json
    refactoredFilePaths = refactoredFilePaths.filter(refactoredFilePath => {

        return path.dirname(refactoredFilePath) === path.dirname(filePath);
    });

    refactoredFilePaths.forEach(refactoredFilePath => {

        //find the relative path to the refactored directory, based on the file of the json file
        let refactoredFileRelPath = path.relative(path.dirname(filePath), refactoredFilePath);

        //for each refactored file, create a script for its transpilation to ES5
        let scriptName = "compile-" + refactoredFileRelPath.replace(/[^\w\s]/gi, '');
        let scriptCommand = "babel " + refactoredFileRelPath + " -o " + refactoredFileRelPath + " --require babel-polyfill --presets env";

        //add script to the json property scripts
        scripts[scriptName] = scriptCommand;

        //add the inserted script's name to the array of the transpilation scripts
        if(transpilationScripts.includes(scriptName) === false) {

            transpilationScripts.push(scriptName);
        }
    });

    // console.log(transpilationScripts.length);

    //(4) create a transpilation script that runs all the transpilation scripts at once 
    //(update: prevent creating commands with many chars and getting errors in the cmd)
     // transpilationScriptName = "compile";
    // scripts[transpilationScriptName] = createApplicationTranspilationScript(transpilationScripts);

    let transpilationCommandIndex = 0;
    let transpilationCommandName = "compile";
    let transpilationCommand = "";
    let transpilationScriptIndex = 0;
    while(transpilationScriptIndex >= 0 && transpilationScriptIndex < transpilationScripts.length) {

        //create multiple small commands that transpile 20 ES6 modules at a time
        transpilationCommandIndex++;
        let transpilationScriptName = 'compile-' + transpilationCommandIndex + '_script';

        //[0,19), [20, 39), ...
        scripts[transpilationScriptName] = createApplicationTranspilationScript(
                                            transpilationScripts.slice(transpilationScriptIndex, transpilationScriptIndex+20));

        //the command for the i-th 20 scripts is inserted - continue to the next 20 transpilation commands
        transpilationScriptIndex += 20;

        //transpilationCommand comprises the command that transpiles the whole system
        transpilationCommand += "npm run " + transpilationScriptName;
        if(transpilationScriptIndex <= transpilationScripts.length-1) {

            transpilationCommand += " && ";
        }

    }

    //add the system's transpilation command once
    scripts[transpilationCommandName] = transpilationCommand;

    // console.log(filePath);
    // console.log(configurationJsonObject);

   //(5) write configureationJsonObject to filePath (modify json file)
   fs.writeFileSync(filePath, JSON.stringify(configurationJsonObject, null, 4), 'utf-8');
}

/**
 * Adds property specified by propertyName with the values specified by 
 * propertyValues in the json object specified by configurationJsonObject.
 * @param {*} configurationJsonObject 
 * @param {*} propertyName 
 * @param {*} propertyValues 
 */
function updateBabelrcProperty(configurationJsonObject, propertyName, propertyValues) {

    if(configurationJsonObject.hasOwnProperty(propertyName) === true) {

        configurationJsonObject[propertyName] = configurationJsonObject[propertyName].concat(propertyValues);

        //prevent duplicates
        configurationJsonObject[propertyName].filter(function (item, pos) {
            return configurationJsonObject[propertyName].indexOf(item) === pos;
        });
    }
    else {

        configurationJsonObject[propertyName] = propertyValues;
    }

    return configurationJsonObject;
}

/**
 * Generates the .babelrc file (if it exists, it modifies it) located in resultDirectory
 */
function updateBabelrcFile(resultDirectory, ignoreTestsArray, testFileDirectoryArray) {

    //retrieve .babelrc in resultDirectory
    var fileList = fileUtilities.retrieveBabelrcFileInDirectory(resultDirectory, ignoreTestsArray, testFileDirectoryArray);
    var fileIndex;
    var fileFound;

    var resultDirectoryPath = path.resolve(resultDirectory);

    var fileContent;
    var configurationJsonObject;
    // var presets = ["es2015", "env"];
    var presets = [];
    var plugins = ["add-module-exports", "transform-object-rest-spread"];

    if(fileList.length === 0) {

        //.babelrc does not exist
        //configurationJsonObject is initialized with an empty object
        configurationJsonObject = {};
    }
    else {

        //.babelrc exists (what if multiple .babelrc files exist?)
        //configurationJsonObject is initialized with the json object contained in the file
        fileFound = false;
        for(fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

            if(resultDirectoryPath === path.dirname(fileList[fileIndex])) {

                //.babelrc exists in the analyzed application's root folder
                //configurationJsonObject is initialized with the json object contained in the file
                fileContent = fs.readFileSync(fileList[0], 'utf-8');
                configurationJsonObject = JSON.parse(fileContent);
                fileFound = true;
                break;
            }
        }

        if(fileFound === false) {

            //.babelrc file not located in the analyzed appication's root folder
            //configuration json object is initialized with an empty project
            configurationJsonObject = {};
        }
    }

    //update properties in configurationJsonObject (if they do not exist, add properties to the json object)
    //do not add transpilation packages in .babelrc (transpile each module with the respective transpilation package
    //depended on the mode of its source code (strict/non-strict))
    configurationJsonObject = updateBabelrcProperty(configurationJsonObject, "presets", presets);
    configurationJsonObject = updateBabelrcProperty(configurationJsonObject, "plugins", plugins);
    
    //write configureationJsonObject to .babelrc (modify json file)
    fs.writeFileSync(resultDirectory + '/.babelrc', JSON.stringify(configurationJsonObject, null, 4), 'utf-8');
}

/**
 * Generates the configuration files (package.json, .babelrc) of the analyzed application.
 * @param {*} resultDirectory 
 * @param {*} refactoredFilePaths 
 */
function generateConfigurationFilesOfApplication(resultDirectory, refactoredFilePaths, inputFiles, testFileDirectoryArray) {

    if(refactoredFilePaths.length === 0) {

        return;
    }

    //check if at least 1 file contains source code in strict mode 
    //(in order to introduce the respective babel plugin in package.json)
    // var codeInStrictMode = isSourceCodeOfAnalyzedSystemInStrictMode(inputFiles);

    //generate the package.json file
    updatePackageJsonFileOfAnalyzedApplication(resultDirectory, refactoredFilePaths, inputFiles, testFileDirectoryArray);

    //generate the .babelrc file
    updateBabelrcFile(resultDirectory, testFileDirectoryArray);
}

exports.generateConfigurationFilesOfApplication = generateConfigurationFilesOfApplication;