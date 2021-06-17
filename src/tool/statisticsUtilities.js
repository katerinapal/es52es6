var path = require('path');
var fs = require('fs');
var logError = require('../io/debug-utils').logError;
var createCSVWriter = require('../../node_modules/csv-writer').createObjectCsvWriter;
var jscodeshift = require('../../node_modules/jscodeshift');

var enums = require('../analysis/ast/util/enums.js');
var mdgUtilities = require('../analysis/mdg/mdgUtilities.js');
const ObjectLiteral = require('../analysis/ast/model/objectLiteral');
const Variable = require('../analysis/ast/model/variable');
const FunctionDeclaration = require('../analysis/ast/model/functionDeclaration');

/**
 * For each inputFile specified in the hashmap inputFiles,
 * calculate the number of the exported objects and their properties.
 * @param {*} inputFiles 
 */
function assessNumberOfExportedObjectsAndTheirProperties(inputFiles) {

    let exportedObjects = [];
	let exportedObjectProperties = [];

	inputFiles.buckets.forEach(fileList => {

		//fileList is an array containing a pair of [key, value] for each JS file
		//key: the file's absolute path, value: the object modelling the file
		fileList.forEach(fileArray => {

            let inputFile = fileArray[1];

            //objects with properties are exported through:
            //(a) exported variables that are assigned object literals
            //(b) exported functions that are bound with properties 
            //we care only for them, since the other objects are already encapsulated (no need to mention them)

            // console.log(inputFile.fileName);
            if(inputFile.explicitGlobals.length > 0) {

                let exportedVariables = inputFile.explicitGlobals.filter(explicitGlobal => {

                    //(a) return only the exported variables that contain object properties
                    return explicitGlobal.isExported === true && explicitGlobal.objectProperties.length > 0;
                });

                let exportedVariableLocations = exportedVariables.map(exportedVariable => {

                    return exportedVariable.variableDeclarationNode.value.loc;
                });

                // exportedVariableLocations.forEach(exportedVariableLoc => {

                //     console.log('Initially exported variable object location: ' + JSON.stringify(exportedVariableLoc));
                // });

                exportedObjects = exportedObjects.concat(exportedVariables);

                //along with exported objects, keep their properties too
                let exportedVariableProperties = [];

                exportedVariables.forEach(exportedVariable => {

                    // console.log(exportedVariable.objectProperties.length);
                    exportedVariableProperties = exportedVariableProperties.concat(exportedVariable.objectProperties);
                });
                // console.log(exportedVariableProperties);
                exportedObjectProperties = exportedObjectProperties.concat(exportedVariableProperties);

                // console.log(exportedObjectProperties.length);
            }

            if(inputFile.definedFunctions.length > 0) {

                let definedFunctions = inputFile.definedFunctions.filter(function(definedFunction) {

                    //(b) return only the exported functions that are either constructors or contain function properties
                    return definedFunction.isExported === true && 
                           (definedFunction.isConstructor === true || 
                           definedFunction.functionProperties.length > 0);
                });

                let definedFunctionLocations = definedFunctions.map(definedFunction => {

                    return definedFunction.functionNode.value.loc;
                });

                // console.log(inputFile.fileName);
                // definedFunctionLocations.forEach(definedFunctionLocation => {

                //     console.log('Initially exported function object location: ' + JSON.stringify(definedFunctionLocation));
                // });
            
                exportedObjects = exportedObjects.concat(definedFunctions);
                let exportedFunctionProperties = [];
                definedFunctions.forEach(definedFunction => {

                    exportedFunctionProperties = exportedFunctionProperties.concat(definedFunction.functionProperties);
                });

                exportedObjectProperties = exportedObjectProperties.concat(exportedFunctionProperties);
            }
            
			if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

                //inputFile models a CommonJS module
                //objects with properties are also exported through their assignment to exports/module.exports
                if(inputFile.exportedProperties.length > 0) {

                    exportedObjects = exportedObjects.concat(inputFile.exportedProperties);
                    let exportedObjectProperties = [];

                    inputFile.exportedProperties.forEach(exportedProperty => {

                        exportedObjectProperties = exportedObjectProperties.concat(exportedProperty.objectProperties);
                    })

                    let exportedPropertyLocations = inputFile.exportedProperties.map(exportedProperty => {

                        // console.log(exportedProperty.exportedPropertyASTNode);
                        if(exportedProperty.exportedPropertyASTNode !== null) {

                            if(exportedProperty.exportedPropertyASTNode.value != undefined) {

                                return exportedProperty.exportedPropertyASTNode.value.loc;
                            }
                            return exportedProperty.exportedPropertyASTNode.loc;
                        }
                        
                        return null;
                    });

                    // exportedPropertyLocations.forEach(exportedPropertyLocation => {

                    //     console.log('Initially exported object location: ' + JSON.stringify(exportedPropertyLocation));
                    // });
                }
                
            }
            else if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

                //inputFile models an AMD module
                //objects with properties are also exported if they are returned from the callback function
                //provided in define()
                if(inputFile.objectLiteral !== null) {

                    exportedObjects = exportedObjects.concat(inputFile.objectLiteral);
                    exportedObjectProperties = exportedObjectProperties.concat(inputFile.objectLiteral.objectProperties);

                    // console.log('Initially exported object location: ' + JSON.stringify(inputFile.objectLiteral.objectExpressionASTNode.loc));
                }
                
            }
        });
    });
    
    console.log('#Exported Objects with Properties: ' + exportedObjects.length);
    console.log('#Exported Object Properties: ' + exportedObjectProperties.length);
}

/**
 * For each file of the analyzed system, dump analysis information
 * to a csv file.
 * @param {*} inputFiles 
 */
function dumpProjectInformationToCSVFile(projectName, inputFiles, mdg, isLibrary = false) {
    
    let records = [];

    //for each module in inputFiles,
    //update the module dependency list through a traversal of the MDG
    //(process needed in order to retrieve the exported declarations
    //that are actually used in module other than their declaration module)
    updateInputFileModuleDependencyLists(inputFiles, mdg, isLibrary);

    //an array of input files for filtering results
    let inputFileArray = inputFiles.convertHashMapToArray();

    //consider only production modules in statistics
    let productionModules = inputFileArray.filter(inputFile => {

        return inputFile.moduleType === enums.ModuleType.componentFile;
    });

    productionModules.forEach(inputFile => {

        //for each file, create a record with the following information:
        //(1) the module's name
        //(2) whether it is a utility module (1/0)
        //(3) whether it is a class module (1/0)
        //(4) whether it is the analyzed project's entry module
        //(5) the number of the module's imported DEFINITIONS (variables/functions/objects) before the refactoring
        //(6) the number of the module's imported DEFINITIONS (variables/functions/objects) after the refactoring
        //(7) the reduction of the module's imported DEFINITIONS after the refactoring (%)
        //(8) the module's efferent coupling before the refactoring
        //(9) the module's efferent coupling after the refactoring
        //(10) the reduction of the module's EC (%)
        //(11) the module's afferent coupling before the refactoring
        //(12) the module's afferent coupling after the refactoring
        //(13) the reduction of the module's AC (%)
        //(14) the module's instability before the refactoring
        //(15) the module's instability after the refactoring
        //(16) the reduction of the module's instability (%)
        let fileRecord = {};

        //(1)
        fileRecord.moduleFile = path.relative(path.resolve('.' + path.sep) + path.sep, inputFile.fileName);

        let moduleType = retrieveModuleType(inputFile);

        //(2)
        fileRecord.isUtilityModule = (moduleType.isUtilityModule === false) ? 0 : 1;

        //(3)
        fileRecord.isClassModule = (moduleType.isClassModule === false) ? 0 : 1;

        //(4)
        fileRecord.isEntryFile = (inputFile.isEntryFile === false) ? 0 : 1;

        //(5)
        fileRecord.initialImportedDefinitions = inputFile.countInitialImportedDefinitions();

        //(6)
        fileRecord.refactoredImportedDefinitions = inputFile.countRefactoredImportedDefinitions();

        //(7)
        fileRecord.importedDefReduction = ((fileRecord.initialImportedDefinitions - 
                                              fileRecord.refactoredImportedDefinitions) /
                                              fileRecord.initialImportedDefinitions) * 100;

        fileRecord.importedDefReduction = isNaN(fileRecord.importedDefReduction) ? 
                                                '' : 
                                                fileRecord.importedDefReduction;

        //(8)
        fileRecord.initialEfferentCoupling = inputFile.calculateEfferentCouplingOfInitialModule();

        //(9)
        fileRecord.refactoredEfferentCoupling = inputFile.calculateEfferentCouplingOfRefactoredModule();

        //(10)
        fileRecord.ecReduction = ((fileRecord.initialEfferentCoupling -
                                     fileRecord.refactoredEfferentCoupling) /
                                     fileRecord.initialEfferentCoupling) * 100;

        fileRecord.ecReduction = isNaN(fileRecord.ecReduction) ? 
                                        '' : 
                                        fileRecord.ecReduction;

        //(11)
        fileRecord.initialAfferentCoupling = inputFile.calculateAfferentCouplingOfInitialModule(inputFiles);

        //(12)
        fileRecord.refactoredAfferentCoupling = inputFile.calculateAfferentCouplingOfRefactoredModule(inputFiles);

        //(13)
        fileRecord.acReduction = ((fileRecord.initialAfferentCoupling -
                                        fileRecord.refactoredAfferentCoupling) /
                                        fileRecord.initialAfferentCoupling) * 100;

        fileRecord.acReduction = isNaN(fileRecord.acReduction) ? 
                                        '' : 
                                        fileRecord.acReduction;

        //(14) eff / (eff + aff)
        fileRecord.initialInstability = fileRecord.initialEfferentCoupling / 
                                            (fileRecord.initialEfferentCoupling + 
                                             fileRecord.initialAfferentCoupling);

        fileRecord.initialInstability = isNaN(fileRecord.initialInstability) ? 
                                                '': 
                                                fileRecord.initialInstability;
           
        //(15)
        fileRecord.refactoredInstability = fileRecord.refactoredEfferentCoupling / 
                                                (fileRecord.refactoredEfferentCoupling + 
                                                fileRecord.refactoredAfferentCoupling);

        fileRecord.refactoredInstability = isNaN(fileRecord.refactoredInstability) ? 
                                                '': 
                                                fileRecord.refactoredInstability;

        //(16)
        fileRecord.insReduction = ((fileRecord.initialInstability -
                                      fileRecord.refactoredInstability) /
                                      fileRecord.initialInstability) * 100;

        fileRecord.insReduction = isNaN(fileRecord.insReduction) ? 
                                        '' : 
                                        fileRecord.insReduction;

        // console.log(fileRecord);

        records.push(fileRecord);
    });

    let csvFilePath = './resultFiles/' + projectName + '_analysisStats.csv';

    //notice: I separate the generation of the object containing analysis results
    //from the generation of the csv file on purpose
    //(the generation of the csv file is done asynchronously (writeRecords() returns a promise))
    //we need all the results in the object first (keeping the object generation and the csv file generation
    //may result in wrong results in some program executions)
    writeAnalysisDataToCSVFile(records, projectName, csvFilePath);
}

/**
 * For each input file specified in inputFiles, update the module dependency list
 * (keeps information relevant to the declarations that are imported and actually used
 * in other modules).
 * @param {*} inputFiles 
 */
function updateInputFileModuleDependencyLists(inputFiles, mdg, isLibrary = false) {

    //for each file, retrieve its module dependency list
    //through traversing mdg
    //with an MDG traversal for each file,
    //the module dependency list of each file is fully updated
    //(recall that the MDG models import dependencies,
    //so the exported declarations that are actually used
    //are retrieved through processing the import dependencies of the other modules)
    inputFiles.buckets.forEach(function(fileList) {

        //fileList contains pairs of [key, value] for each inputFile:
        //(a) key is the absolute path to the file
        //(b) value is the object capturing information for the file

        for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

            let inputFile = fileList[fileIndex][1];

            // the exported declarations that are actually used are retrieved from the MDG
            //(MDG models import dependencies which, with its traversal, will specify the declarations that need to be exported)
            //(each inputFile, after the traversal of the MDG, contains a list with its dependencies (exports/imports)
            //with other modules)
            mdgUtilities.retrieveModuleDependenciesOfModule(inputFiles, mdg, inputFile, isLibrary);
        }

    });

    if(isLibrary === true) {

        //in libraries, all modules act as entry files
        //module features are exported regardless of their use
        inputFiles.buckets.forEach(function(fileList) {

            //fileList contains pairs of [key, value] for each inputFile:
            //(a) key is the absolute path to the file
            //(b) value is the object capturing information for the file
    
            for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
    
                let inputFile = fileList[fileIndex][1];
    
                mdgUtilities.updateLibraryModuleExportDependencies(inputFile, inputFiles);
            }
    
        });
    }
}

/**
 * Determines whether the module specified in inputFile is
 * a class or a utility module
 * @param {*} inputFile 
 */
function retrieveModuleType(inputFile) {

    let isUtilityModule = false;

    let isClassModule = false;

    // console.log(inputFile.fileName);
    let exportedVariables = inputFile.explicitGlobals.filter(function(explicitGlobal) {

        return explicitGlobal.isExported === true;
    });

    let exportedProperties = inputFile.exportedProperties;

    // console.log(inputFile.fileName);
    // console.log(inputFile.definedFunctions);
    let exportedFunctions = inputFile.definedFunctions.filter(function(definedFunction) {

        return definedFunction.isExported === true;
    });

    if(exportedFunctions.length > 0) {

        // console.log(exportedFunctions);
        //in AMD modules, exportedFunctions are the callback functions provided in define()
        //an AMD module is a classModule if the returned element is a constructor function
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

            // console.log(exportedFunctions[0]);

            //determine whether the value returned from the callback is a function emulating a class

            // FIXME (Vassilis): An AMD module definition function may return (a) an object literal,
            // (b) function, (c) a variable that may refer to an object literal or function.
            // The function may be: a constructor function (class module), an empty function with assigned properties
            // (probably a utility function, see discussion on object literal), other type of function (neither class, nor utility module)
            // The Object literal may be decomposed to two or more properties (utility module). The same holds for
            // the empty function. Care should be given in cases that properties of the object literal or the empty
            // function refer to functions that use the this keyword. 
            // The same holds for CommonJS in case that module.exports is defined with an object literal or function.
            let returnedElementDeclaration = exportedFunctions[0].returnedElementDeclaration;
            if(returnedElementDeclaration !== null) {

                //returnElementDeclaration keeps a reference to the definition of the returned object
                //(e.g. variable, function)
                
                //keep initialization value of the returned element, based on its type
                if(returnedElementDeclaration.value != null &&
                    returnedElementDeclaration.value.type === 'VariableDeclaration') {

                    let declarations = returnedElementDeclaration.value.declarations;
                    // console.log(declarations[0]);
                    returnedElementNode = declarations[0].init;
                    
                }
                else {

                    returnedElementNode = returnedElementDeclaration.value;
                }

                let retrievedFunction = inputFile.retrieveDefinedFunctionByNode(returnedElementNode);

                // console.log(retrievedFunction);
                if(retrievedFunction !== null && retrievedFunction.isConstructor === true) {

                    isClassModule = true;
                }
                else {
                    // FIXME: It is not necessarily a UtilityModule. A utility module must export
                    // two or more named exports after refactoring. 
                    // ???: how is this related? in AMD modules usually 1 definition is exported (case: a value)

                    isUtilityModule = true;
                }
            }
            else if(exportedFunctions[0].returnStatementNode !== null) {

                //the module's callback returns a value (at least)
                isUtilityModule = true;
            }
        }
        else {

            //CommonJS module: it is a class module if it exports (at least) 1 constructor function
            let exportedFunctionConstructors = exportedFunctions.filter(function(exportedFunction) {

                return exportedFunction.isConstructor === true;
            });

            // console.log(inputFile.fileName);
            // console.log(exportedFunctionConstructors);

            if(exportedFunctionConstructors.length > 0) {

                //inputFile exports at least a function constructor
                //it is a class module
                isClassModule = true;
            }
            else {

                isUtilityModule = true;
            }
        }

        return {

            isClassModule: isClassModule,
            isUtilityModule: isUtilityModule
        };
    }
    
    if(exportedVariables.length > 0) {

        //module does not export function constructors
        //what if these functions are assigned to variables?
        let variablesInitializedWithFunctionConstructor = exportedVariables.filter(exportedVariable => {

            // console.log(exportedVariable)

            //exported variable is initialized with function constructor (either of (a) and (b) applies):
            //(a) properties are bound to the variable's prototype (all objects, variables and functions, have a prototype)
            //(b) function is initialized with a function constructor
            return exportedVariable.isInitializedWithFunctionConstructor === true;
        });

        if(variablesInitializedWithFunctionConstructor.length > 0) {

            isClassModule = true;
        }
        else {

            isUtilityModule = true;
        }

        return {

            isClassModule: isClassModule,
            isUtilityModule: isUtilityModule
        };
    }
    
    if(exportedProperties.length > 0) {

        //applies to CommonJS modules
        //module exports object literals with sets of properties
        isUtilityModule = true;

    }

    //module does not export anything (mark the module as utility)
    if(isUtilityModule === false && isClassModule === false) {

        isUtilityModule = true;
    }

    return {

        isClassModule: isClassModule,
        isUtilityModule: isUtilityModule
    };
}

/**
 * Retrieves the number of the export statements of the module specified in inputFile.
 * @param {*} inputFile 
 */
function retrieveNumberOfExportStatementsOfModule(inputFile) {

    //export statements: 1-1 mapping for each exported variable/function/object literal
    let numOfExportStatements = 0;

    //applies to AMD modules only: objectLiterals model a module object that is provided in define (instead of a callback function)
    //or the object returned fron the callback function provided in define
    let exportedProperties = inputFile.exportedProperties;
    let objectLiteral = inputFile.objectLiteral;

    let exportedVariables = inputFile.explicitGlobals.filter(explicitGlobal => {

        return explicitGlobal.isExported === true;
    });

    let exportedFunctions = inputFile.definedFunctions.filter(definedFunction => {

        return definedFunction.isExported === true;
    });

    // console.log(inputFile.fileName)
    // console.log(inputFile.moduleFramework);

    if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

        //AMD module export declarations through either defining them at the module scope
        //or returning them from callbacks
        numOfExportStatements += exportedVariables.length;
        exportedFunctions = exportedFunctions.filter(function(exportedFunction) {

            return exportedFunction.returnStatementNode !== null;
        });

        numOfExportStatements += exportedFunctions.length;

        if(exportedFunctions.length === 0 && objectLiteral !== null) {

            //AMD module exposes an object through providing it in define()
            //(no callback function)
            numOfExportStatements += 1;
        }
    }
    else {

        //CommonJS module: it exports variables/functions/objects explicitly through assigning/binding to module.exports/exports
        numOfExportStatements += exportedVariables.length;

        //do not consider exported functions assigned to variables (they are considered in exportedVariables)
        exportedFunctions = exportedFunctions.filter(function(exportedFunction) {

            //do not consider functions that are parts of variable declarations
            //(these variables are included in exportedVariables array)
            // console.log(exportedFunction.functionNode.parentPath);
            // return exportedFunction.functionNode.parentPath.value.type !== 'VariableDeclaration' &&
                //    (exportedFunction.functionNode.parentPath.value.type == 'AssignmentExpression');

            let parentNode = exportedFunction.functionNode.parentPath;
            // if(parentNode.value instanceof Array === true) {

            //     //consider functions that can be exported (they are located in the module's scope)
            //     return true;
            // }

            if(parentNode.value.type === 'VariableDeclaration') {

                //function assigned to a variable
                //the exported variables are already considered
                return false;
            }

            // console.log(exportedFunction);

            return true;
        });
        numOfExportStatements += exportedFunctions.length;
        // console.log(exportedProperties);
        numOfExportStatements += exportedProperties.length;
    }

    return numOfExportStatements;
}

/**
 * Retrieves the number of the exported declarations of the module specified in inputFile
 * (differs from the number of the module's export statements in the case that objects
 * with properties are exported).
 * @param {*} inputFile 
 */
function retrieveNumberOfExportedDeclarationsOfModule(inputFile) {

    let numberOfExportedDeclarations = 0;
    let exportedVariables = inputFile.explicitGlobals.filter(explicitGlobal => {

        return explicitGlobal.isExported === true;
    });

    let exportedFunctions = inputFile.definedFunctions.filter(definedFunction => {

        return definedFunction.isExported === true;
    });

    let exportedProperties = inputFile.exportedProperties;

    // console.log(inputFile.fileName + " " + exportedVariables.length + " " + exportedFunctions.length + " " + exportedProperties.length)

    //exportedVariables: 
    //(a) variables not initialized with objects or initialized with empty objects (or with properties bound on their prototype) are considered as 1, 
    //(b) variables initialized with objects (either literals or functions with properties) are considered through their properties

    //(a)
    let variablesInitializedWithPrimitiveTypesOrEmptyObjects = exportedVariables.filter(exportedVariable => {

        return exportedVariable.objectProperties.length === 0 ||
               exportedVariable.prototypeProperties.length !== 0;
    });

    numberOfExportedDeclarations += variablesInitializedWithPrimitiveTypesOrEmptyObjects.length;

    // console.log(inputFile.fileName + " " + variablesInitializedWithPrimitiveTypesOrEmptyObjects.length);
    // if(exportedVariables.length > 0) {

    //     exportedVariables.forEach(exportedVariable => console.log(exportedVariable.objectProperties));
    // }

    //(b)
    //retrieve the variables that are initialized with object literals
    //(the remaining variables)
    let variablesInitializedWithObjects = exportedVariables.filter(exportedVariable => {

        return variablesInitializedWithPrimitiveTypesOrEmptyObjects.indexOf(exportedVariable) < 0;
    });

    //map variables to the numbers of their object properties
    //and then sum them to numberOfExportedDeclarations
    numberOfExportedDeclarations += variablesInitializedWithObjects.map(variable => variable.objectProperties.length)
                                                                   .reduce((numOfObjectProperties, numOfVariableObjectProperties) => numOfObjectProperties + numOfVariableObjectProperties, 0);

    numberOfExportedDeclarations += variablesInitializedWithObjects.map(variable => variable.prototypeProperties.length)
                                                                   .reduce((numOfPrototypeProperties, numOfVariablePrototypeProperties) => numOfPrototypeProperties + numOfVariablePrototypeProperties, 0);

    if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

        //AMD module: exports the return type of the callback function (not the callback itself) 
        //or the object provided in define (if no callback is provided in it)
        //do not consider exported function in the case that it is the callback

        //(a) the function returns an object expression or an object is provided in define() (count its properties)
        //(b) the function returns a primitive value (count the value itself)

        //(a)
        let functionsReturningObjectExpressions = exportedFunctions.filter(exportedFunction => {
            return exportedFunction.returnStatementNode !== null && exportedFunction.returnStatementNode.value.argument.type === 'ObjectExpression';
        });

        if(exportedFunctions.length === 0 || functionsReturningObjectExpressions.length > 0) {

            //AMD module either provides an object literal in define() (no exported functions)
            //or a callback function tha returns an object expression
            numberOfExportedDeclarations += inputFile.objectLiteral.objectProperties.length;
        }

        //(b)
        let functionsReturningPrimitiveTypes = exportedFunctions.filter(exportedFunction => {

            //keep functions that do not return objects (return primitive types)
            return exportedFunction.returnStatementNode !== null && exportedFunction.returnStatementNode.value.argument.type !== 'ObjectExpression';
        });

        numberOfExportedDeclarations += functionsReturningPrimitiveTypes.length;
        
        
    }
    else {

        //CommonJS module:
        //(a) exported function is a constructor or has no properties (consider the function itself)
        //(b) exported function is not a constructor (consider the function's properties, if any, or the function itself)
        let functionDefinitions = exportedFunctions.filter(exportedFunction => {

            //prototype properties not considered (if exist, the function is considered a constructor function)
            return exportedFunction.isConstructor === true || exportedFunction.functionProperties.length === 0;
        });

        // console.log(functionDefinitions);

        numberOfExportedDeclarations += functionDefinitions.length;

        //(b)
        let functionObjects = exportedFunctions.filter(exportedFunction => {

            //keep functions that are not constructor functions and do not have object properties
            return functionDefinitions.indexOf(exportedFunction) < 0;
        });

        // functionObjects.forEach(functionObject => console.log(functionObject.functionProperties))

        numberOfExportedDeclarations += functionObjects.map(functionObject => functionObject.functionProperties.length)
                                                      .reduce((numOfFunctionProperties, numOfCurrentFunctionProperties) => numOfFunctionProperties + numOfCurrentFunctionProperties, 0);
    }

    //exported properties model object literals assigned/bound to exports/module.exports
    //(a) exported property has properties (consider properties)
    //(b) exported property has not properties (consider exported property itself)

    //(a)
    let exportedObjectsWithProperties = exportedProperties.filter(exportedProperty => {

        return exportedProperty.objectProperties.length > 0;
    });

    numberOfExportedDeclarations += exportedObjectsWithProperties.map(exportedObject => exportedObject.objectProperties.length)
                                                                 .reduce((numOfExportedObjectProperties, numOfCurrentExportedObjectProperties) => numOfExportedObjectProperties + numOfCurrentExportedObjectProperties, 0);

    //(b)
    let exportedEmptyObjects = exportedProperties.filter(exportedProperty => {

        //keep objects not in exportedObjectsWithProperties
        return exportedObjectsWithProperties.indexOf(exportedProperty) < 0;
    });

    numberOfExportedDeclarations += exportedEmptyObjects.length;

    return numberOfExportedDeclarations;
}
function countUsedExportedDeclarations(namedExportObj, inputFile, isLibrary = false) {

    // console.log(inputFile.fileName);
    // console.log(inputFile.moduleType);
    // console.log(namedExportObj);
    // console.log(inputFile.objectLiteral);

    let numOfUsedExportedDeclarations = 0;

    if(inputFile.moduleType === enums.ModuleType.library) {

        return 0;
    }

    //inputFile is an entry file (or it's in a library project. 
    //In libraries, all exported features are exported regardless of their use)
    //all properties of the declaration along with it are exported
    //(regardless of their use locally in the system)
    //notice: exported properties considered as 1
    if(inputFile.isEntryFile === true ||
        isLibrary === true) {

            // console.log(namedExportObj)
        numOfUsedExportedDeclarations += namedExportObj.dataType === 'implied' ? 0 :
                                            (namedExportObj.dataType === 'function' ? 
                                            namedExportObj.functionProperties.length : 
                                            namedExportObj.objectProperties.length);

        //don't consider declaration defined with object expression (its properties are already considered)
        numOfUsedExportedDeclarations = ((namedExportObj.isInitializedWithObjectExpression === true ||
                                            (namedExportObj.initializationNode != null &&
                                            namedExportObj.initializationNode.type === 'ObjectExpression') ||
                                            (namedExportObj.initializationValueNode != null &&
                                             namedExportObj.initializationValueNode.type === 'ObjectExpression')) ?
                                            numOfUsedExportedDeclarations :
                                            numOfUsedExportedDeclarations+1);
        return numOfUsedExportedDeclarations;
    }

    // console.log(namedExportObj);
    if(namedExportObj.dataType !== 'function' &&
        namedExportObj.objectProperties !== undefined && 
        namedExportObj.objectProperties.length > 0) {

        // console.log(namedExportObj.initializationNode);

        // console.log(namedExportObj.objectProperties)

        // console.log(namedExportObj);

        if(namedExportObj.isAccessedDynamically === true ||
            namedExportObj.isObjectReferenced === true) {

            if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

                //in non-modular ES5, non-cohesive objects are not destructured
                numOfUsedExportedDeclarations++;
                return numOfUsedExportedDeclarations;
            }

            //declaration is accessed dynamically (through bracket notation)
            //I cannot soundly determine the set of the accessed properties
            //I assume that all properties are used
            numOfUsedExportedDeclarations += namedExportObj.objectProperties.length;

            //declaration is not initialized with an object literal
            //consider it in the number of used declarations
            if(namedExportObj.isInitializedWithObjectExpression === false) {

                numOfUsedExportedDeclarations++;
            }

            return numOfUsedExportedDeclarations;
        }

        if(namedExportObj.isImportedAndReexported === true) {

            numOfUsedExportedDeclarations += namedExportObj.objectProperties.length;
        //    console.log(namedExportObj)
            if(namedExportObj.initializationValueNode != undefined &&
                namedExportObj.initializationValueNode.type !== 'ObjectExpression') {

                numOfUsedExportedDeclarations++;
            }

            return numOfUsedExportedDeclarations;
        }

        //the variable is not accessed dynamically
         //I can soundly determine the set of the accessed properties (they are marked as exported during analysis)
         let exportedObjectProperties = namedExportObj.objectProperties.filter(objectProperty => {

            return objectProperty.isExported === true;
        });

        //object's definition assigned to the export object
        if(namedExportObj.isExportedObjectDefinedThroughAssignmentToExports === true &&
            (namedExportObj.initializationValueNode != null &&
            namedExportObj.initializationValueNode.type === 'ObjectExpression') ||
            (namedExportObj.initializationNode != null &&
            namedExportObj.initializationNode.type === 'ObjectExpression')) {

                // console.log(namedExportObj)

            // numOfUsedExportedDeclarations++;

            numOfUsedExportedDeclarations += namedExportObj.dataType === 'property' ?
                                                namedExportObj.objectProperties.length :
                                                (exportedObjectProperties.length > 0 ? 
                                                exportedObjectProperties.length : 1);
            return numOfUsedExportedDeclarations;
        }

        if(exportedObjectProperties.length > 0) {

            if(namedExportObj.usedBesidesProperties === true) {

                numOfUsedExportedDeclarations++;
            }

            numOfUsedExportedDeclarations += exportedObjectProperties.length;
            return numOfUsedExportedDeclarations;
        }

        //variable/property contains object properties, but none of them is accessed
        //if inputFile is an entry file, count variable/property itself
        if(exportedObjectProperties.length === 0 &&
            inputFile.isEntryFile === true) {

            numOfUsedExportedDeclarations += 1;
            return numOfUsedExportedDeclarations;
        }

        //variable contains object properties, but none of them is accessed
        //(or the element is used besides its properties and it's not an object literal)
        //assume that all exported properties are used
        if(namedExportObj.usedBesidesProperties === true &&
            namedExportObj.initializationValueNode != null &&
            namedExportObj.initializationValueNode.type !== 'ObjectExpression') {

            numOfUsedExportedDeclarations++;

            if(inputFile.isEntryFile === true) {

                numOfUsedExportedDeclarations += namedExportObj.objectProperties.length;
            }
        }

        // numOfUsedExportedDeclarations += 1;
        // numOfUsedExportedDeclarations += namedExportObj.objectProperties.length;
        return numOfUsedExportedDeclarations;
    }
    
    if(namedExportObj.dataType === 'function' &&
    namedExportObj.isFunctionConstructor !== undefined && 
        namedExportObj.isFunctionConstructor === false && 
        namedExportObj.functionProperties !== undefined && 
        namedExportObj.functionProperties.length > 0) {

        //in non-modular ES5, non-compound objects are not destructured
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

            numOfUsedExportedDeclarations++;
            return numOfUsedExportedDeclarations;
        }

        //declaration imported and re-exported (count declaration itself, along with its function properties)
        if(namedExportObj.isImportedAndReexported === true ||
            namedExportObj.isObjectReferenced === true) {

                // console.log(namedExportObj);
            numOfUsedExportedDeclarations += namedExportObj.functionProperties.length + 1;
            return numOfUsedExportedDeclarations;
        }

        //declaration is initialized with a function object
        if(namedExportObj.isAccessedDynamically === true) {

            //declaration is accessed dynamically (through bracket notation)
            //I cannot soundly determine the set of the accessed properties
            //I assume that all properties are used
            numOfUsedExportedDeclarations += namedExportObj.functionProperties.length;
            return numOfUsedExportedDeclarations;
        }
       
        //declaration is not accessed dynamically
        //I can soundly determine the set of the accessed properties (they are marked as exported during analysis)
        let exportedFunctionProperties = namedExportObj.functionProperties.filter(functionProperty => {

            return functionProperty.isExported === true;
        });

        numOfUsedExportedDeclarations += exportedFunctionProperties.length;
        return numOfUsedExportedDeclarations;
    }

    //feature imported and re-exported (or iterated/referenced itself)
    //count all its object properties (and the feature itself)
    if(namedExportObj.isImportedAndReexported === true ||
        namedExportObj.isObjectReferenced === true) {

        numOfUsedExportedDeclarations += 1 + (namedExportObj.dataType === 'function' ?
                                            namedExportObj.functionProperties.length :
                                            namedExportObj.objectProperties.length);
        return numOfUsedExportedDeclarations;
    }
    
    if(namedExportObj.returnStatementNode != undefined && 
        namedExportObj.returnStatementNode.argument.type === 'ObjectExpression') {

        //TODO: what if callback function does not return anything (openmct)?
        //AMD module returns an object expression
        //consider its accessed properties, not the object itself
        // console.log(inputFile.objectLiteral);
        numOfUsedExportedDeclarations += inputFile.objectLiteral !== null ?
                                            inputFile.objectLiteral.objectProperties.filter(objectProperty => {

                                            return objectProperty.isExported === true;
                                        }).length : 0;

        return numOfUsedExportedDeclarations;
    }
    
    //variable/function not initialized with a non-cohesive object
    numOfUsedExportedDeclarations++;
    return numOfUsedExportedDeclarations;
}

/**
 * Retrieves the export dependencies of the module specified in inputFile.
 * @param {*} inputFile 
 */
function retrieveExportDependenciesOfModule(inputFile) {

    let usedNamedExports;
    let moduleDependencyList = inputFile.moduleDependencyList;

    // console.log(inputFile.fileName);
    if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

        //AMD modules export declarations through define() (or export implied globals through introducing their definition)
        //do not consider export scripts (they are considered in the scripts relevant to the replacement of define() call)
        usedNamedExports = moduleDependencyList.filter(function(moduleDependency) {

            // console.log(moduleDependency)
            return (moduleDependency.type === 'replace' && moduleDependency.isWrappedInDefine === true) ||
                    (moduleDependency.type === 'export' && moduleDependency.isImplied === true);
        });
    }
    else {

        //CommonJS module: explicitly exports each declaration
        usedNamedExports = moduleDependencyList.filter(function(moduleDependency) {

            // console.log(moduleDependency);
            return moduleDependency.type === 'export' && moduleDependency.exportedElementName !== null;
        });
    }

    return usedNamedExports;
}

function writeAnalysisDataToCSVFile(records, projectName, csvFilePath) {

    let csvWriter = createCSVWriter({path: csvFilePath,
                                     header: [
                                        {id: 'moduleFile', title: 'Module'},
                                        {id: 'isUtilityModule', title: 'Utility Module'},
                                        {id: 'isClassModule', title: 'Class Module'},
                                        {id: 'isEntryFile', title: 'Project Entry Module'},
                                        {id: 'initialImportedDefinitions', title: '#Imported Definitions (Initial)'},
                                        {id: 'refactoredImportedDefinitions', title: '#Imported Definitions (ES6)'},
                                        {id: 'importedDefReduction', title: 'Interface Reduction per module (%)'},
                                        {id: 'initialEfferentCoupling', title: 'Efferent Coupling (Initial)'},
                                        {id: 'refactoredEfferentCoupling', title: 'Efferent Coupling (ES6)'},
                                        {id: 'ecReduction', title: 'Efferent Coupling Reduction (%)'},
                                        {id: 'initialAfferentCoupling', title: 'Afferent Coupling (Initial)'},
                                        {id: 'refactoredAfferentCoupling', title: 'Afferent Coupling (ES6)'},
                                        {id: 'acReduction', title: 'Afferent Coupling Reduction (%)'},
                                        {id: 'initialInstability', title: 'Instability (Initial)'},
                                        {id: 'refactoredInstability', title: 'Instability (ES6)'},
                                        {id: 'insReduction', title: 'Instability Reduction (%)'}
                                    ]});
    
    csvWriter.writeRecords(records).then(() => {
                                    console.log('Wrote analysis stats in CSV file ' + csvFilePath);
                                });
}

/**
 * TODO: for each system, assess:
 * the number of module features (variables/function/exported properties) (countModuleFeatures()),
 * the number of exported features after the refactoring 
 * (the features that have an 'export' module dep) (countUsedExportedDeclarations())
 */

/**
 * Counts the total number of module features (variables/functions/object literals) of the system
 * (after refactoring).
 * @param {*} inputFiles 
 */
function countModuleFeatures(inputFiles) {

    let sourceFileList = inputFiles.convertHashMapToArray();

    let numOfModuleFeatures = 0;

    sourceFileList.forEach(inputFile => {

        numOfModuleFeatures += countModuleFeaturesOfFile(inputFile);
    });

    // console.log(numOfModuleFeatures);
    return numOfModuleFeatures;
}

/**
 * Count module features of inputFile.
 * Update: count module features, based on the project's framework.
 * @param {*} inputFile 
 */
function countModuleFeaturesOfFile(inputFile) {

    // console.log(inputFile.fileName);
    let numOfModuleFeatures = 0;

    /** 
     * module features: 
    (1) non-modular ES5: variables/functions/object literals defined in the module scope
    (2) CommonJS: module object properties
    (3) AMD: module object properties + variables/functions/object literals defined in the module scope
    + implied globals (regardless of module format)
    */

    //do not count module features for library
    if(inputFile.moduleType === enums.ModuleType.library) {

        return 0;
    }

    let definedImplieds = inputFile.impliedGlobals.filter(impliedGlob => {

        // console.log(impliedGlob);
        return impliedGlob.isDefined === true;
    });

    // console.log(definedImplieds);
    numOfModuleFeatures += definedImplieds.length;

    //(1) non-modular ES5
    if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

        numOfModuleFeatures += countModuleFeaturesOfES5File(inputFile);
        return numOfModuleFeatures;
    }

    //(2) CJS
    if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

        // console.log(numOfModuleFeatures);
        numOfModuleFeatures += countModuleFeaturesOfCommonJSModule(inputFile);
        // console.log(numOfModuleFeatures);
        return numOfModuleFeatures;
    }

    //(3) AMD
    numOfModuleFeatures += countModuleFeaturesOfAMDModule(inputFile);
    return numOfModuleFeatures;
}

/**
 * Counts module features of non-modular ES5 file.
 * @param {*} inputFile 
 */
function countModuleFeaturesOfES5File(inputFile) {

    // console.log(inputFile.fileName)
    let numOfModuleFeatures = 0;

    let definedFunctions = inputFile.definedFunctions.filter(defFunc => {

        // console.log(defFunc.functionNode.value.loc);
        // console.log(defFunc.functionScope === null);

        if(defFunc.functionName === 'topLevelScope') {

            return false;
        }

        //consider only functions defined in the module's top-level scope
        return defFunc.functionScope === null &&
                defFunc.isExported === true;

        // return defFunc.functionScope === null &&
        //         defFunc.functionNode.value.type !== 'FunctionExpression';
    });
    
    // console.log(definedFunctions.length)
    definedFunctions.forEach(defFunc => {
    
        //non-compound objects not destructured in non-modular ES5
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

            numOfModuleFeatures++;
            return;
        }

        numOfModuleFeatures += defFunc.functionProperties.length + 1;
    });
    
    let explicitGlobals = inputFile.explicitGlobals;
    
    // console.log(explicitGlobals.length)
    explicitGlobals.forEach(explicitGlob => {
    
        // console.log(explicitGlob.variableName);
        // console.log('o: ' + explicitGlob.objectProperties.length)
        // console.log(explicitGlob.isInitializedWithObjectExpression)

        //non-compound objects not destructured in non-modular ES5
        if((explicitGlob.isInitializedWithObjectExpression === true ||
            (explicitGlob.initializationValueNode != null &&
             explicitGlob.initializationValueNode.type === 'ObjectExpression') ||
             inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true)) {

            numOfModuleFeatures++;
            return;
        }

        numOfModuleFeatures += explicitGlob.objectProperties.length;

        //consider declaration only in the case it has no properties
        //(otherwise, its properties are already considered)
        numOfModuleFeatures += (explicitGlob.objectProperties.length > 0 ? 
                                0 :
                                1);
    });

    return numOfModuleFeatures;
}

/**
 * Counts module features of CommonJS module.
 * @param {*} inputFile 
 */
function countModuleFeaturesOfCommonJSModule(inputFile) {

    // console.log(inputFile.fileName)
    let numOfModuleFeatures = 0;

    // CommonJS: module object properties
    let definedFunctions = inputFile.definedFunctions.filter(defFunc => {

        return defFunc.isExported === true;
    });
    
    // console.log('d: ' + definedFunctions.length);
    definedFunctions.forEach(defFunc => {

        // console.log(defFunc.functionNode.value.loc);
        numOfModuleFeatures += defFunc.functionProperties.length + 1;
    });
    
    let explicitGlobals = inputFile.explicitGlobals.filter(explicitGlobal => {

        return explicitGlobal.isExported === true;
    });
    
    // console.log('e: ' + explicitGlobals.length);
    explicitGlobals.forEach(explicitGlob => {
    
        // numOfModuleFeatures += explicitGlob.objectProperties.length + 1;

        // console.log(explicitGlob.objectProperties.length)
        numOfModuleFeatures += explicitGlob.objectProperties.length;
        if(explicitGlob.isInitializedWithObjectExpression === false) {

            numOfModuleFeatures++;
        }
    });

    let exportedProperties = inputFile.exportedProperties.filter(exportedProp => {

        return exportedProp.exportedPropertyName != null;
    });
    // console.log(exportedProperties);
    // numOfModuleFeatures += exportedProperties.length;

    exportedProperties.forEach(exportedProp => {

        numOfModuleFeatures += (exportedProp.objectProperties.length > 0 ? exportedProp.objectProperties.length : 1);
    });

    return numOfModuleFeatures;
}

/**
 * Counts module features of AMD module.
 * @param {*} inputFile 
 */
function countModuleFeaturesOfAMDModule(inputFile) {

    // console.log(inputFile.fileName)
    let numOfModuleFeatures = 0;
    // AMD: (a) module object properties (declaration returned from the callback function)+ 
    // (b) variables/functions/object literals defined in the module scope

    //(a) find the callback function (function surrounded by 
    // define()/requirejs()/require() invocation)
    let callbackFuncs = inputFile.definedFunctions.filter(defFunc => {

        // console.log(defFunc.functionNode.value.loc);
        // console.log(defFunc.functionScope === null);

        if(defFunc.functionName === 'topLevelScope') {

            return false;
        }

        //find the function's closest Statement
        let surrStmts = jscodeshift(defFunc.functionNode).closest(jscodeshift.Statement);
                
        if(surrStmts.length === 0) {

            return false;
        }

        let surrStmt = surrStmts.at(0).get();
        // console.log(surrStmt.value.type);
        if(surrStmt.value.type !== 'ExpressionStatement') {

            return false;
        }

        let surrExp = surrStmt.value.expression;
            // console.log(surrStmt.value.expression.type);
        if(surrExp.type !== 'CallExpression') {

            return false;
        }

        if(surrExp.callee.type !== 'Identifier') {

            return false;
        }

        let calleeName = surrExp.callee.name;
        return calleeName === 'define' || calleeName === 'require' || 
                calleeName === 'requirejs';
    });

    callbackFuncs.forEach(callbackFunc => {

        //Variable | FunctionDeclaration | ObjectLiteral
        let returnedElementDecl = callbackFunc.returnedElementDeclaration;

        // console.log(callbackFunc.functionNode.value.loc)
        // console.log(returnedElementDecl)
        if(returnedElementDecl === null) {

            return;
        }

        if(returnedElementDecl instanceof Variable.Variable === true) {

            // console.log(returnedElementDecl)
            numOfModuleFeatures += returnedElementDecl.objectProperties.length;

            //count declaration only in the case it is not initialized with an object
            //(otherwise, its object properties are already considered)
            //also: in the case of an empty object, count declaration
            numOfModuleFeatures += ((returnedElementDecl.isInitializedWithObjectExpression === true &&
                                     returnedElementDecl.objectProperties.length > 0) ? 
                                    0 :
                                    1);

            return;
        }

        if(returnedElementDecl instanceof FunctionDeclaration.FunctionDeclaration === true) {

            numOfModuleFeatures += returnedElementDecl.functionProperties.length + 1;
            return;
        }

        if(returnedElementDecl.objectExpressionASTNode.type !== 'ObjectExpression') {

            numOfModuleFeatures += 1;
            return;
        }

        numOfModuleFeatures += returnedElementDecl.objectProperties.length;
    });
        
    //object provided as parameter to define() (also exported)
    let objectLiteral = inputFile.objectLiteral;
    // console.log(objectLiteral);
    numOfModuleFeatures += (objectLiteral !== null ? objectLiteral.objectProperties.length : 0);

    // console.log(numOfModuleFeatures);

    //(b) also count top-level declarations (globals)
    numOfModuleFeatures += countModuleFeaturesOfES5File(inputFile);

    // console.log(numOfModuleFeatures);
    return numOfModuleFeatures;
}

/**
 * Calculates the number of exported features of projectName (after the refactoring).
 * @param {*} projectName 
 * @param {*} inputFiles 
 */
function calculateAnalysisStatsForExportedMFs(projectName, inputFiles, isLibrary = false) {

    let sourceFileList = inputFiles.convertHashMapToArray();
    let records = [];

    //consider only production modules in statistics
    let productionModules = sourceFileList.filter(inputFile => {

        // console.log(inputFile.fileName + ' ' + inputFile.moduleType)
        return inputFile.moduleType === enums.ModuleType.componentFile;
    });

    //create a record with the following information (per module):
    //(1) the module's name
    //(2) the number of the module's objects (1, since there's 1-1 mapping between the module and the module object)
    //(3) whether the module's object is destructured after refactoring (0/1)
    //(4) is the module object a compound object (function constructor) or a non-cohesive object (literal)
    //(5) module object type (object literal, function constructor, function constructor with properties)
    //(6) the module's exported module features (after refactoring)
    //(7) the module's total module features
    let exportedMFs = 0;
    productionModules.forEach(inputFile => {
        
        let fileRecord = {};
        let moduleFile = path.relative(path.resolve('.' + path.sep) + path.sep, inputFile.fileName)
        
        //(1)
        fileRecord.moduleName = moduleFile;
        let exportDependencies = inputFile.moduleDependencyList.filter(moduleDep => {

            // console.log(moduleDep.type)
            return moduleDep.type === 'export';
        });

        // console.log(inputFile.fileName);

        //remove duplicates on exportDeps based on elementAlias
        //(prevent counting exported feats twice)
        let exportDeps = exportDependencies.filter((element, position) => {

            // console.log(element);
            let firstOccurenceIndex = exportDependencies.findIndex(el => {

                return el.exportedElement.elementAlias === 
                        element.exportedElement.elementAlias;
            });

            // console.log(`firstOccurenceIndex: ${firstOccurenceIndex}\nposition: ${position}`);
            
            return firstOccurenceIndex === position;
        });


        // console.log(inputFile.fileName);
        // console.log(exportDeps.length);

        //(2)
        fileRecord.totalModuleObjects = 1;

        //(3)-(4)-(5)
        //non-modular ES5: no module objects
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

            fileRecord.isDestructured = 0;
            fileRecord.isCompound = 0;
            fileRecord.objectLiteral = 0;
            fileRecord.functionConstructor = 0;
            fileRecord.functionConstructorWithProperties = 0;
        }
        else {

            //compound objects: objects NOT destructured after refactoring
            //(either cohesive or fully referenced, e.g. function parameters)
            let compoundExports = exportDeps.filter(exportDep => {

                return (exportDep.exportedElement.objectProperties &&
                        exportDep.exportedElement.objectProperties.length === 0) ||
                        exportDep.exportedElement.isObjectReferenced === true;
            });

            fileRecord.isDestructured = (exportDeps.length > 0 && 
                                         compoundExports.length === 0 ? 1 : 0);
            
            let cohesiveExports = exportDeps.filter(exportDep => {

                return exportDep.exportedElement.isCohesive === true && 
                        exportDep.exportedElement.objectProperties.length === 0;
            });

            fileRecord.isCompound = (cohesiveExports.length > 0 ? 1 : 0);

            let objectExports = exportDeps.filter(exportDep => {

                return exportDep.exportedElement.dataType === 'object';
            });

            if(objectExports.length > 0) {

                fileRecord.objectLiteral = 1;
                fileRecord.functionConstructor = 0;
                fileRecord.functionConstructorWithProperties = 0;
            }
            else {

                //cohesive objects: function constructors with * function/object properties
                let cohesiveExports = exportDeps.filter(exportDep => {

                    return exportDep.exportedElement.isFunctionConstructor === true;
                });

                let exportsOfFunctionConstructorsWithProperties = cohesiveExports.filter(exportDep => {

                    return exportDep.exportedElement.objectProperties && exportDep.exportedElement.objectProperties.length > 0 ||
                            exportDep.exportedElement.functionProperties &&  exportDep.exportedElement.functionProperties.length > 0;
                });

                fileRecord.objectLiteral = 0;
                fileRecord.functionConstructor = (cohesiveExports.length > 0) ? 1 : 0;
                fileRecord.functionConstructorWithProperties = (exportsOfFunctionConstructorsWithProperties.length > 0) ? 1 : 0;
            }
            
        }

        //(6)
        fileRecord.exportedMFs = 0;
        // console.log(inputFile.fileName + ' ' + exportDeps.length)
        exportDeps.forEach(exportDep => {

            // console.log(exportDep);
            // console.log(exportDep.exportedElement.elementNode);
            // console.log()
            let exportedDefs = countUsedExportedDeclarations(exportDep.exportedElement, inputFile, isLibrary);
            // console.log(exportedDefs)
            // exportedMFs += exportedDefs;

            fileRecord.exportedMFs += exportedDefs;
        });
        
        //(7)
        fileRecord.totalMFs = countModuleFeaturesOfFile(inputFile);

        // console.log(fileRecord);
        records.push(fileRecord);
    });

    // let fileRecord = {};

    // //(1)
    // fileRecord.exportedMFs = exportedMFs;

    // //(2)
    // fileRecord.totalMFs = countModuleFeatures(inputFiles);

    // records.push(fileRecord);

    let csvFilePath = './resultFiles/' + projectName + '_analysisStats_exportedMFs.csv';

    //notice: I separate the generation of the object containing analysis results
    //from the generation of the csv file on purpose
    //(the generation of the csv file is done asynchronously (writeRecords() returns a promise))
    //we need all the results in the object first (keeping the object generation and the csv file generation
    //may result in wrong results in some program executions)
    writeExportedModuleFeaturesToCSV(records, csvFilePath);
}

/**
 * Classifies the system's module objects to categories 
 * and writes the classification results to a csv file.
 * Applies to CommonJS/AMD modules.
 * @param {*} projectName 
 * @param {*} inputFiles 
 */
function classifyModuleObjects(projectName, inputFiles) {

    let sourceFileList = inputFiles.convertHashMapToArray();
    let records = [];

    //consider only production modules in statistics
    let productionModules = sourceFileList.filter(inputFile => {

        return inputFile.moduleType === enums.ModuleType.componentFile;
    });

    //create a record with the following information (per module):
    //(1) the module's name
    //(2) is the module object a factory object? (0/1)
    //(3) is the module object a namespace object? (0/1)
    //(4) is the module object a utility function? (0/1)
    productionModules.forEach(inputFile => {
        
        let fileRecord = {};
        let moduleFile = path.relative(path.resolve('.' + path.sep) + path.sep, inputFile.fileName);
        
        //(1)
        fileRecord.moduleName = moduleFile;

        //(2)-(4)
        //non-modular ES5: no module objects (modules attach properties to the global object - namespace object)
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

            fileRecord.isFactoryObj = 0;
            fileRecord.isNamespaceObj = 1;
            fileRecord.isUtility = 0;

            records.push(fileRecord);
            return;
        }
        
        if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

            //CommonJS
            //module object (regardless of refactoring): 
            //object ASSIGNED to exports/module.exports (CommonJS)
            
            //exported variables: variables ASSIGNED to the module object
            //(1-1 mapping to the module object) => #exportedVars: 0..1
            let exportedVars = inputFile.explicitGlobals.filter(explicitGlob => {

                return explicitGlob.isExported === true;
            });

            //exported functions: functions ASSIGNED to the module object
            //(1-1 mapping to the module object) => #exportedFuncs: 0..1
            let exportedFuncs = inputFile.definedFunctions.filter(definedFunc => {

                return definedFunc.isExported === true;
            });

            //exported properties: keep only literals/values assigned to the module object
            ////(1-1 mapping to the module object) => #exportedProps: 0..1
            let exportedProperties = inputFile.exportedProperties.filter(exportedProp => {

                return exportedProp.propertyExportedThroughModuleExports === true;
            });

            //module does not export anything (either assigning or attaching to the module object)-
            //module object is not classified
            if(exportedVars.length === 0 &&
                exportedFuncs.length === 0 &&
                inputFile.exportedProperties.length === 0) {

                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 0;
                fileRecord.isUtility = 0;
        
                records.push(fileRecord);
                return;
            }

            if(exportedVars.length > 0) {

                let exportedVar = exportedVars[0];

                //module object is a factory function
                if(exportedVar.isInitializedWithFunctionConstructor === true) {

                    fileRecord.isFactoryObj = 1;
                    fileRecord.isNamespaceObj = 0;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                //module object is a namespace object
                if(exportedVar.objectProperties.length > 0) {

                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 1;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                //module object is neither a factory nor a namespace object
                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 0;
                fileRecord.isUtility = 1;

                records.push(fileRecord);
                return;
            }

            if(exportedFuncs.length > 0) {

                let exportedFunc = exportedFuncs[0];

                //module object is a factory object
                if(exportedFunc.isConstructor === true) {

                    fileRecord.isFactoryObj = 1;
                    fileRecord.isNamespaceObj = 0;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                //module object is a namespace object
                if(exportedFunc.functionProperties.length > 0) {

                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 1;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                //module object is neither a factory not a namespace object
                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 0;
                fileRecord.isUtility = 1;

                records.push(fileRecord);
                return;
            }

            if(exportedProperties.length > 0) {

                let exportedProperty = exportedProperties[0];

                if(exportedProperty.exportedPropertyASTNode.type === 'ObjectExpression') {

                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 1;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 0;
                fileRecord.isUtility = 1;

                records.push(fileRecord);
                return;
            }

            fileRecord.isFactoryObj = 0;
            fileRecord.isNamespaceObj = 0;
            fileRecord.isUtility = 1;

            records.push(fileRecord);
            return;
        }

        if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

            //module object: (a) returned from the factory function (callback) or (b) provided in define()

            //(a)
            //#returnedElements: 0..1
            let returnedElements = inputFile.definedFunctions.filter(definedFunction => {

				return definedFunction.returnedElementDeclaration !== null &&
                        definedFunction.returnedElementDeclaration.isExported === true;
                        
			}).map(definedFunction => {

				return definedFunction.returnedElementDeclaration;
            });
            
            if(returnedElements.length > 0) {

                //returnedEl: Variable | FunctionDeclaration | ObjectLiteral
                let returnedEl = returnedElements[0];

                if(returnedEl instanceof Variable.Variable === true) {

                    //module object is a factory function
                    if(returnedEl.isInitializedWithFunctionConstructor === true) {

                        fileRecord.isFactoryObj = 1;
                        fileRecord.isNamespaceObj = 0;
                        fileRecord.isUtility = 0;

                        records.push(fileRecord);
                        return;
                    }

                    //module object is a namespace object
                    if(returnedEl.objectProperties.length > 0) {

                        fileRecord.isFactoryObj = 0;
                        fileRecord.isNamespaceObj = 1;
                        fileRecord.isUtility = 0;

                        records.push(fileRecord);
                        return;
                    }

                    //module object is neither a factory nor a namespace object
                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 0;
                    fileRecord.isUtility = 1;

                    records.push(fileRecord);
                    return;
                }

                if(returnedEl instanceof FunctionDeclaration.FunctionDeclaration === true) {

                    //module object is a factory object
                    if(returnedEl.isConstructor === true) {

                        fileRecord.isFactoryObj = 1;
                        fileRecord.isNamespaceObj = 0;
                        fileRecord.isUtility = 0;

                        records.push(fileRecord);
                        return;
                    }

                    //module object is a namespace object
                    if(returnedEl.functionProperties.length > 0) {

                        fileRecord.isFactoryObj = 0;
                        fileRecord.isNamespaceObj = 1;
                        fileRecord.isUtility = 0;

                        records.push(fileRecord);
                        return;
                    }

                    //module object is neither a factory not a namespace object
                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 0;
                    fileRecord.isUtility = 1;

                    records.push(fileRecord);
                    return;
                }

                if(returnedEl instanceof ObjectLiteral.ObjectLiteral === true) {

                    if(returnedEl.objectProperties.length > 0) {

                        fileRecord.isFactoryObj = 0;
                        fileRecord.isNamespaceObj = 1;
                        fileRecord.isUtility = 0;
    
                        records.push(fileRecord);
                        return;
                    }
    
                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 0;
                    fileRecord.isUtility = 1;
    
                    records.push(fileRecord);
                    return;
                }
            }

            //(b)
            let exportedProperties = inputFile.exportedProperties;

            if(exportedProperties.length > 0) {

                //ObjectLiteral
                let objectLiteral = exportedProperties[0];

                if(objectLiteral.objectProperties.length > 0) {

                    fileRecord.isFactoryObj = 0;
                    fileRecord.isNamespaceObj = 1;
                    fileRecord.isUtility = 0;

                    records.push(fileRecord);
                    return;
                }

                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 0;
                fileRecord.isUtility = 1;

                records.push(fileRecord);
                return;
            }

            //AMD module does not export anything
            //does it have top-level functions/variables?
            let exportedFuncs = inputFile.definedFunctions.filter(defFunc => {

                return defFunc.isExported === true;
            });

            if(exportedFuncs.length > 0 ||
                inputFile.explicitGlobals.length > 0) {

                fileRecord.isFactoryObj = 0;
                fileRecord.isNamespaceObj = 1;
                fileRecord.isUtility = 0;
            
                records.push(fileRecord);
                return;
            }

            //module does not export anything-
            //module object is not classified
            fileRecord.isFactoryObj = 0;
            fileRecord.isNamespaceObj = 0;
            fileRecord.isUtility = 0;
        
            records.push(fileRecord);
            return;
        }

    });

    let csvFilePath = './resultFiles/' + projectName + '_analysisStats_module_object_classification.csv';

    //notice: separate the generation of the object containing analysis results
    //from the generation of the csv file on purpose
    //(the generation of the csv file is done asynchronously (writeRecords() returns a promise))
    //we need all the results in the object first (keeping the object generation and the csv file generation
    //may result in wrong results in some program executions)
    writeModuleObjectClassificationResultsToCSV(records, csvFilePath);
}

/**
 * Writes the system's exported module features (after refactoring)
 * and the total module features to a csv file (asynchronously).
 * (Stats per module).
 * @param {*} records 
 * @param {*} csvFilePath 
 */
function writeExportedModuleFeaturesToCSV(records, csvFilePath) {

    let csvWriter = createCSVWriter({path: csvFilePath,
        header: [
           {id: 'moduleName', title: 'Module'},
           {id: 'totalModuleObjects', title: '#Module Objects'},
           {id: 'isDestructured', title: 'Destructured (0/1)'},
           {id: 'isCompound', title: 'Compound (0/1)'},
           {id: 'objectLiteral', title: 'Object Literal (0/1)'}, 
           {id: 'functionConstructor', title: 'Function Constructor (0/1)'},
           {id: 'functionConstructorWithProperties', title: 'Function Constructor With Properties (0/1)'},
           {id: 'exportedMFs', title: 'Exported Module Features'},
           {id: 'totalMFs', title: 'Total Module Features'}
       ]});

    csvWriter.writeRecords(records).then(() => {
    
       console.log('Wrote analysis stats w.r.t exported features in CSV file ' + csvFilePath);
    });
}

/**
 * Writes the system's exported module features (after refactoring)
 * and the total module features to a csv file (asynchronously).
 * (Stats per module).
 * @param {*} records 
 * @param {*} csvFilePath 
 */
function writeModuleObjectClassificationResultsToCSV(records, csvFilePath) {

    let csvWriter = createCSVWriter({path: csvFilePath,
        header: [
           {id: 'moduleName', title: 'Module'},
           {id: 'isFactoryObj', title: 'Factory Object (0/1)'},
           {id: 'isNamespaceObj', title: 'Namespace Object (0/1)'},
           {id: 'isUtility', title: 'Utility Function (0/1)'}
       ]});

    csvWriter.writeRecords(records).then(() => {
    
       console.log('Wrote analysis stats w.r.t module object classification in CSV file ' + csvFilePath);
    });
}

exports.assessNumberOfExportedObjectsAndTheirProperties = assessNumberOfExportedObjectsAndTheirProperties;
exports.dumpProjectInformationToCSVFile = dumpProjectInformationToCSVFile;
exports.retrieveNumberOfExportStatementsOfModule = retrieveNumberOfExportStatementsOfModule;
exports.retrieveNumberOfExportedDeclarationsOfModule = retrieveNumberOfExportedDeclarationsOfModule;
exports.retrieveModuleType = retrieveModuleType;
exports.calculateAnalysisStatsForExportedMFs = calculateAnalysisStatsForExportedMFs;
exports.classifyModuleObjects = classifyModuleObjects;