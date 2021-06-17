/**
 * CommonUtilities.js.
 * Module providing functionalities applied in multiple module systems.
 * (e.g. top-level definitions in AMD/non-modular ES5, 
 * implied globals in non-strict mode in ES5 code).
 */

var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var tern = require('../../../node_modules/tern');
var ternServer = new tern.Server({});

var enums = require('../ast/util/enums.js');

var Variable = require('../ast/model/variable.js');
var FunctionDeclaration = require('../ast/model/functionDeclaration.js');
var ImpliedGlobalVariable = require('../ast/model/impliedGlobalVariable.js');
var ImportedElement = require('../ast/model/importedElement.js');
var ImportedModule = require('../ast/model/importedModule.js');
var ImportedNamespace = require('../ast/model/importedNamespace.js');

var fileUtilities = require('../../io/fileUtilities.js');
const GlobalObjectProperty = require('../ast/model/globalObjectProperty');

/**
 * Updates the imported definitions of inputFile
 * with the top-level definitions of inputFiles.
 * Applies to AMD/non-modular ES5 modules.
 * @param {*} inputFiles 
 * @param {*} inputFile 
 */
function addTopLevelDefinitionsToImportedDefinitionsOfModule(inputFiles, inputFile) {

	let importedVariables = [];
    let importedFunctions = [];
    let impliedGlobals = [];
    let importedElements = [];

    let importedSource;
    let importedVariable;
    let importedFunction;

    //in case that a plain JS module does not define global 
    //variables/functions (i.e. it is an IIFE)
    //introduce an imported module
    let importedModules = [];
    let importedModule;

    // console.log(inputFile.fileName);
    let moduleVariables = inputFile.explicitGlobals;
    let moduleFunctions = inputFile.definedFunctions.filter(definedFunc => {

        return definedFunc.functionName !== 'topLevelScope' &&
                definedFunc.functionScope === null;

        // return definedFunc.functionName !== 'topLevelScope' &&
        //         definedFunc.functionScope === null &&
        //         definedFunc.functionNode.parentPath.value.type !== 'AssignmentExpression' &&
        //         definedFunc.functionNode.parentPath.value.type !== 'VariableDeclarator';
    });

    //no formal mechanism for importing/exporting top-level definitions
    //sourceFile might reference each module variable of each other module
    //(due to variable/function declaration hoisting)

    //find modules with definitions that may be referenced in sourceFile
    //(exclude sourceFile)
    inputFiles.buckets.forEach(fileList => {

        let importFiles = fileList.filter(fileObj => {

            return fileObj[1] !== inputFile;
        });

        importFiles.forEach(importFileObj => {

            let importFile = importFileObj[1];
            
            //find the relative path from inputFile to importFile (sourceFile imports elements, inputFile defines elements)
            importedSource = path.relative(path.dirname(inputFile.fileName) + "\\", importFile.fileName);
    
            if(importedSource.startsWith('.') === false) {
    
                importedSource = '.\\' + importedSource;
            }
    
            // console.log(inputFile.fileName + " " + importedSource);
    
            //importFile's explicit globals are visible in inputFile's scope
            //exclude explicitGlobal with the same name with a module variable
            //and explicitGlobal returned from the callback function (applies to AMD)
            let explicitGlobals = importFile.explicitGlobals.filter(explicitGlob => {

                return explicitGlob.isExported === true &&
                        importFile.isDefinitionReturnedFromFunction(explicitGlob) === false;
            });

            explicitGlobals.forEach(explicitGlobal => {
    
                //exclude explicitGlobal in the case that
                //sourceFile contains a module variable with the same name
                // console.log(explicitGlob);
                let existingVariables = moduleVariables.filter(moduleVar => {

                    return moduleVar.variableName === explicitGlobal.variableName;
                });

                // console.log(existingVariables.length);
                if(existingVariables.length > 0) {

                    return;
                }
    
                importedVariable = new ImportedElement.ImportedElement(explicitGlobal.variableName, importedSource);
                importedVariable.updateElementDeclarationNode(explicitGlobal.variableDeclarationNode);
                let dataType = explicitGlobal.isInitializedWithObjectExpression === true ? 'objectLiteral': 'variable';
                importedVariable.updateIsExportedObjectOfPrimitiveType(dataType);

                //map importedVariable to explicitGlobal
                importedVariable.updateModuleDefinition(explicitGlobal);
    
                //add importedVariable once
                if(importedVariables.some(importedVar => {

                    return importedVar.compare(importedVariable) === true;
                }) === false) {

                    importedVariables.push(importedVariable);
                }

                importedElements.push(importedVariable);
            });
    
            //top-level scope functions (except these assigned to events) are visible in sourceFile's scope
            //exclude defFunc returned from the callback function (applies to AMD)
            definedFunctions = importFile.definedFunctions.filter(defFunc => {

                return defFunc.isExported === true &&
                        importFile.isDefinitionReturnedFromFunction(defFunc) === false;
            });
            definedFunctions.forEach(function(definedFunction) {
    
                //exclude definedFunction in the case that
                //sourceFile contains a module function with the same name
                let existingFunctions = moduleFunctions.filter(moduleFunc => {

                    return moduleFunc.functionName === definedFunction.functionName;
                });

                // console.log(existingFunctions.length)
                if(existingFunctions.length > 0) {

                    return;
                }
    
                importedFunction = new ImportedElement.ImportedElement(definedFunction.functionName, importedSource);
                importedFunction.updateElementDeclarationNode(definedFunction.functionNode);
                importedFunction.updateIsExportedObjectOfPrimitiveType('function');

                //map importedFunction to definedFunction
                importedFunction.updateModuleDefinition(definedFunction);

                //add importedFunction once
                if(importedFunctions.some(importedFunc => {

                    importedFunc.compare(importedFunction) === true;
                }) === false) {

                    importedFunctions.push(importedFunction);
                }

                importedElements.push(importedFunction);
            });
    
            let explicitGlobal;
    
            //implied globals are visible in sourceFile's scope
            impliedGlobals = importFile.impliedGlobals;
            impliedGlobals.forEach(impliedGlobal => {
    
                // console.log(impliedGlobal)
                importedVariable = new ImportedElement.ImportedElement(impliedGlobal.variableName, importedSource);
                importedVariable.updateElementDeclarationNode(null);
    
                //update: inputFile contains an explicitGlobal named impliedGlobal.variableName
                explicitGlobal = inputFile.retrieveExplicitGlobal(impliedGlobal.variableName);
                // console.log(inputFile.fileName + " " + impliedGlobal.variableName + " " + explicitGlobal);
                if(explicitGlobal !== null) {
    
                    //proceed to the next impliedGlobal
                    return;
                }

                importedVariable.updateModuleDefinition(impliedGlobal);

                //add importedVariable once
                if(importedVariables.some(importedVar => {

                    return importedVar.compare(importedVariable) === true;

                }) === false) {

                    importedVariables.push(importedVariable);
                };

                importedElements.push(importedVariable);
            });
    
            // console.log(inputFile.fileName);
            // console.log(explicitGlobals.length + " " + definedFunctions.length + " " + impliedGlobals.length);
            if(importFile.moduleType === enums.ModuleType.library) {
    
                importedModule = new ImportedModule.ImportedModule(importFile.libraryObjectName, importedSource);
                importedModule.updateElementDeclarationNode(null);

                if(importedModules.some(importedMod => {

                    return importedMod.compare(importedModule) === true;

                }) === false) {

                    importedModules.push(importedModule);
                }

                importedElements.push(importedModule);
            }
        });
    });

    // console.log('i: ' + inputFile.fileName)

    //update sourceFile's imported variables/functions
    inputFile.updateImportedVariables(importedVariables);

    inputFile.updateImportedFunctions(importedFunctions);

    inputFile.updateImportedModules(importedModules);

    inputFile.updateImportedElements(importedElements);
}

/**
 * Adds importedElement in each file in inputFiles.
 * Used in order to add elements defined in the top-level scope 
 * of plain JS modules or defined in the top-level scope of AMD modules
 * (global variables) in the imported definition of each other module
 * of the system.
 * @param {*} inputFiles 
 * @param {*} importFile
 * @param {*} moduleDefinition 
 */
function addImportedElementToSourceFiles(inputFiles, importFile, moduleDefinition) {

	// console.log(importedElement.elementName);
	inputFiles.buckets.forEach(fileList => {

		fileList.forEach(fileObject => {

            let inputFile = fileObject[1];
            
            if(inputFile === importFile) {

                return;
            }

            //declaredSource (relative path) is resolved from the file that imports to the file that exports the specific element
			let declaredSource = path.relative(path.dirname(inputFile.fileName) + path.sep, importFile.fileName);
			if(declaredSource.startsWith('.') === false) {

				//inputFile and importFile are in the same directory
				declaredSource = '.' + path.sep + declaredSource;
			}

            if(moduleDefinition instanceof Variable.Variable === true) {

                importedElement = new ImportedElement.ImportedElement(moduleDefinition.variableName, declaredSource);
                importedElement.updateElementDeclarationNode(null);
                importedElement.updateModuleDefinition(moduleDefinition);
            }
            else if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

                importedElement = new ImportedElement.ImportedElement(moduleDefinition.functionName, declaredSource);
                importedElement.updateElementDeclarationNode(null);
                importedElement.updateModuleDefinition(moduleDefinition);
            }
            else {

                return;
            }

			inputFile.addImportedDefinition(importedElement);
		});
	});
}

/**
 * For each top-level definition of each module in inputFiles, 
 * retrieves its references in other modules of the analyzed system.
 * @param {*} inputFiles 
 */
function retrieveTopLevelDefinitionReferences(inputFiles) {

    let inputFileList = inputFiles.convertHashMapToArray();

    let clientModules = inputFileList.filter(file => {

        return file.moduleType !== enums.ModuleType.library &&
                (file.moduleFramework.includes(enums.ModuleFramework.AMD) === true ||
                file.moduleFramework.includes(enums.ModuleFramework.plain) === true);
    });

    // console.log(clientModules.length);

    clientModules.forEach(definitionModule => {

        // console.log(definitionModule.fileName);

        //exclude definition module from the system's modules
        let referenceFiles = clientModules.filter(refFile => {

            return refFile !== definitionModule;
        });

        let exportedVars = definitionModule.explicitGlobals.filter(explicitGlobal => {

            return explicitGlobal.isExported === true;
        });

        //find references of exportedVar in the system's modules
        //except definitionModule
        exportedVars.forEach(exportedVar => {

            retrieveUsagesOfModuleDefinitionInSystem(referenceFiles, definitionModule, exportedVar);
        });

        let exportedFuncs = definitionModule.definedFunctions.filter(definedFunction => {

            return definedFunction.functionScope === null &&
                    definedFunction.isExported === true;
        });
        
        //find references of exportedFunc in the system's modules
        //except definitionModule
        exportedFuncs.forEach(exportedFunc => {

            retrieveUsagesOfModuleDefinitionInSystem(referenceFiles, definitionModule, exportedFunc);
        });
    });

}

/**
 * Retrieves the references of moduleDef defined in sourceFile
 * in the files specified in referenceFileArray.
 * @param {*} referenceFileArray input file list
 * @param {*} definitionModule module defining moduleDef
 * @param {*} moduleDef top-level definition whose references are resolved
 */
function retrieveUsagesOfModuleDefinitionInSystem(referenceFileArray, definitionModule, moduleDef) {

    // console.log(moduleDef);
    
    //find the location of identifier referencing moduleDef in its definition
    let defName;
    let defDeclNode;
    let defDeclId;
    let defRange;
    if(moduleDef instanceof Variable.Variable === true) {

        defName = moduleDef.variableName;
        defDeclNode = moduleDef.variableDeclarationNode;

        //find moduleDef's definition identifier
        let defDeclarators = defDeclNode.value.declarations.filter(decl => {

            return decl.id.type === 'Identifier' && 
                    decl.id.name === defName;
        });

        if(defDeclarators.length === 0) {
            
            return;
        }

        defDeclId = defDeclarators[0].id;
        defRange = defDeclId.range;
    }
    else if(moduleDef instanceof FunctionDeclaration.FunctionDeclaration === true) {

        defName = moduleDef.functionName;
        defDeclNode = moduleDef.functionNode;

        if(defDeclNode.value.type === 'FunctionExpression') {

            //function expression (assigned to a variable)
            return;
        }

        defDeclId = defDeclNode.value.id;
        defRange = defDeclId.range;
    }
    else if(moduleDef instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {

        defName = moduleDef.variableName;

        // console.log(moduleDef.creationStatement)

        //implied global does not have a formal declaration
        //the statement that, when executed, introduces the variable in the global scope
        defDeclNode = moduleDef.creationStatement;

        if(defDeclNode.value.type !== 'ExpressionStatement') {

            return;
        }

        //find implied global identifier inside its 'definition'
        //(it might be anywhere in the statement,
        //in the case statement introduces multiple implied globals)
        let implDefIds = jscodeshift(defDeclNode).find(jscodeshift.Identifier).filter(id => {

            return id.value.name === defName;
        });

        if(implDefIds.length === 0) {

            return;
        }

        defDeclId = implDefIds.at(0).get().value;
        defRange = defDeclId.range;
    }
    else if(moduleDef instanceof GlobalObjectProperty.GlobalObjectProperty === true) {

        defName = moduleDef.elementName;

        // console.log(moduleDef)

        //implied global does not have a formal declaration
        //the statement that, when executed, introduces the variable in the global scope
        defDeclNode = moduleDef.propertyDefinitionNode;

        if(defDeclNode.value.type !== 'AssignmentExpression') {

            return;
        }

        //find implied global identifier inside its 'definition'
        //(it might be anywhere in the statement,
        //in the case statement introduces multiple implied globals)
        let implDefIds = jscodeshift(defDeclNode).find(jscodeshift.MemberExpression).filter(mbExp => {

            return mbExp.value.property.type === 'Identifier' &&
                    mbExp.value.property.name === defName;
            return id.value.name === defName;
        });

        if(implDefIds.length === 0) {

            return;
        }

        defDeclId = implDefIds.at(0).get().value;
        defRange = defDeclId.range;
    }
    else {

        return;
    }

    console.log(`Retrieving references of ${defName} in the system.`);

    // console.log(definitionModule.fileName + ' ' + defName)
    // console.log(defRange);

    //given the definition location of moduleDef in definitionModule
    //find its references in referenceFiles

    ternServer.addFile(definitionModule.fileName, definitionModule.astRootCollection.toSource());

    //modules where moduleDef's references are assessed
    let analysisFileObjs = referenceFileArray.map(referenceFile => {

        return {

            type: "full",
			name: referenceFile.fileName,
			text: referenceFile.astRootCollection.toSource()
        };
    });

    // console.log(defRange);
    // console.log(analysisFileObjs.map(analysisFileObj => {

    //     return analysisFileObj.name;
    // }));

    let requestDetails = {
        query: {

            type: "refs",
            file: definitionModule.fileName,
            start: defRange[0],
            end: defRange[1],
            variable: defName,
        },
        
		timeout: 1000,
		files: analysisFileObjs
    };
    
    let defRefObjs = [];
    ternServer.request(requestDetails, function(error, success) {

        console.log(error);
        console.log(success);
        if(error !== null || Object.keys(success).length === 0) {

            return;
        }

        defRefObjs = success.refs;
    });

    if(defRefObjs.length === 0) {

        return;
    }

    //moduleDef is referenced in the analyzed system
    //add the reference set within each file in the respective module
    // console.log(defRefObjs)

    referenceFileArray.forEach(refFile => {

        //find moduleDef's references in refFile
        let refFileDefRefs = defRefObjs.filter(defRefObj => {

            // console.log(defRefObj);
            // console.log(require.resolve(defRefObj.file));
            return require.resolve(defRefObj.file) === require.resolve(refFile.fileName);
        });

        // console.log(refFile.fileName + ' ' + defName + ' ' + refFileDefRefs.length);
        if(refFileDefRefs.length === 0) {

            refFileDefRefs = mapElementReferencesOfRefFileToModuleDefinition(refFile, definitionModule, defName, analysisFileObjs, defRange);
            if(refFileDefRefs.length === 0) {

                return;
            }

        }

        updateModuleWithTopLevelDefinitionReferences(refFile, moduleDef, refFileDefRefs);
    });

    ternServer.delFile(definitionModule.fileName);

    console.log(`Retrieved references of ${defName} in the system.`);
}

/**
 * Updates inputFile with the references of the imported definition pointing moduleDef.
 * @param {*} inputFile 
 * @param {*} moduleDef 
 * @param {*} defRefObjs the definition's references (returned by Tern)
 */
function updateModuleWithTopLevelDefinitionReferences(inputFile, moduleDef, defRefObjs) {

    // console.log(inputFile.fileName);
    // // console.log(moduleDef);
    // // console.log(defRefObjs);
    // console.log(inputFile.importedElements.length)

    //moduleDef might be a Variable or a FunctionDeclaration object
    let defName = (moduleDef instanceof Variable.Variable === true || moduleDef instanceof ImpliedGlobalVariable.ImpliedGlobalVariable) ? 
                    moduleDef.variableName : 
                    moduleDef.functionName;

    let elementUsages = [];

    // console.log(elName)
                
    defRefObjs.forEach(defRefObj => {
                
        //defRefObj is the moduleDef's reference (as returned from Tern)
        //find it in the AST
        //(Tern and jscodeshift locations might be different in some cases,
        //keep also defName identifiers)
        let resRefRange = [defRefObj.start, defRefObj.end];
        let defRefs = inputFile.astRootCollection.find(jscodeshift.Identifier).filter(id => {
                
            return (id.value.range[0] === resRefRange[0] && id.value.range[1] === resRefRange[1]) ||
                                    id.value.name === defName;
        });
                
        //specific reference of moduleDef not found
        //proceed to the next reference
        if(defRefs.length === 0) {
                
            return;
        }
                
        defRefs.forEach(defRef => {
                
            //add defRef once
            if(elementUsages.some(elUse => {
                
                return elUse.value === defRef.value;
                
            }) === false) {
                
                elementUsages.push(defRef);
            }
        });
                
    });

    // console.log(inputFile.fileName + ' ' + defName + defRefObjs.length);
    
    //find the imported definition that points moduleDef
    let moduleDefImpEls;
    if(moduleDef instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === false) {

        moduleDefImpEls = inputFile.importedElements.filter(importedEl => {

            // console.log(importedEl)
            if(importedEl instanceof ImportedModule.ImportedModule === true ||
                importedEl instanceof ImportedNamespace.ImportedNamespace === true) {
    
                return false;
            }
    
            // console.log(importedEl.elementName)
            return importedEl.elementName === defName;
        });
    }
    else {

        moduleDefImpEls = inputFile.usedImpliedGlobals.filter(usedImpl => {

            return usedImpl.elementName === defName;
        });
    }

    // console.log(moduleDefImpEls)

    //(a) definition used in inputFile (implieds defined in inputFile)
    //(b) definition imported and used in inputFile (top-level variables/functions and implieds from other modules)
    let referencedDefinition = null;

    if(moduleDefImpEls.length === 0) {

        if(moduleDef instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {

            //inputFile might modify implied global with the same name
            referencedDefinition = inputFile.retrieveImpliedGlobalByName(defName);
        }
        else {

            referencedDefinition = null;
        }

    }
    else {

        referencedDefinition = moduleDefImpEls[0];
        moduleDefImpEls.forEach(referencedDefinition => {

            referencedDefinition.updateElementUsages(elementUsages);
        });

        return;
    }

    if(referencedDefinition === null) {

        return;
    }

    // console.log(elementUsages.length);

    referencedDefinition.updateElementUsages(elementUsages);
}

/**
 * Updates the imported variables of inputFile with the implied globals
 * created in other modules. 
 * Does not check if each implied global is actually used in inputFile
 * (this is checked after the top-level feature reference retrieval).
 * @param {*} inputFiles 
 * @param {*} inputFile 
 */
function retrieveImpliedGlobalsUsedInModule(inputFiles, inputFile) {

    console.log(`Detecting implied globals used in ${inputFile.fileName}.`);

    if(inputFile.moduleType === enums.ModuleType.library) {

        return;
    }

	let usedImpliedGlobals = [];
	let impliedGlobals;
	let usedImpliedGlobal;
	let relativePath;

	// console.log(inputFile.fileName);
    // console.log(inputFile.impliedGlobals);
    // console.log(inputFile.importedVariables);
    
    /**
     * Implied globals are introduced at runtime (no
     * way to track the variable's definition in the case that multiple
     * modules are modifying it)
     * Approximation: assume that each module modifying an implied global
     * also defines it
     */

	inputFiles.buckets.forEach(fileList => {

		fileList.filter(file => {

			return file[1] !== inputFile;
		}).forEach(sourceFile => {

            // console.log(inputFile);
            
            //retrieve implied globals created in inputFile
            //do not proceed if (sourceFile does not define implied globals)
            impliedGlobals = sourceFile[1].impliedGlobals;
            if(impliedGlobals.length === 0) {

                return;
            }
	
			//find the relative path from inputFile's directory path 
			//(inputFile imports the element) to sourceFile's path (sourceFile exports the element)
			relativePath = path.relative(path.dirname(inputFile.fileName) + "\\", sourceFile[1].fileName);
	
			if(relativePath.startsWith('.') === false) {
		
				//inputFile and importFile are in the same directory
				relativePath = '.\\' + relativePath;
			}
	
			// console.log('i: ' + sourceFile.fileName + " " + sourceFile.impliedGlobals.length + " " + inputFile.impliedGlobals.length + " " + inputFile.importedNamespaces.length);
			// console.log(inputFile.impliedGlobals.length);

			//exclude implied globals that either: 
			//(a) have the same name with inputFile's explicit globals
			//(b) are already defined (assigned a value) in inputFile
			//(c) have the same name with inpuFile's imported namespaces
			impliedGlobals = impliedGlobals.filter(impliedGlobal => {

				//(a)
				if(inputFile.explicitGlobals.some(explicitGlobal => {

					return explicitGlobal.variableName === impliedGlobal.variableName;

				}) === true) {

					return false;
				}

				//(b)
				if(inputFile.impliedGlobals.some(defImpliedGlob => {

					return defImpliedGlob.variableName === impliedGlobal.variableName;

				}) === true) {

					return false;
				}
	
				//(c)
				if(inputFile.retrieveImportedNamespace(impliedGlobal.variableName, relativePath) !== null) {
	
					return false;
				}

				return true;
			});

			impliedGlobals.forEach(impliedGlobal => {
                
                //map usedImpliedGlobal to the module definition
				usedImpliedGlobal = new ImportedElement.ImportedElement(impliedGlobal.variableName, relativePath);
                usedImpliedGlobal.updateModuleDefinition(impliedGlobal);
                usedImpliedGlobal.updateElementDeclarationNode(impliedGlobal.creationStatement);
                usedImpliedGlobal.updateReferencesImpliedGlobal(true);

                // console.log(impliedGlobal.variableName)
                
                //add usedImpliedGlobal once
                if(usedImpliedGlobals.some(usedImplGlob => {

                    return usedImplGlob === usedImpliedGlobal;

                }) === false) {

                    usedImpliedGlobals.push(usedImpliedGlobal);
                }
	
			});
		});
    });
    
    inputFile.updateUsedImpliedGlobals(usedImpliedGlobals);
    // console.log(inputFile.fileName + ' ' + inputFile.usedImpliedGlobals.length);
    // console.log(inputFile.usedImpliedGlobals);
}

/**
 * For each implied global of each module in inputFiles, 
 * retrieves its references in other modules of the analyzed system.
 * Applies to non-strict mode code, regardless of the employed module system.
 * @param {*} inputFiles 
 */
function retrieveImpliedGlobalReferences(inputFiles) {
    
    let inputFileList = inputFiles.convertHashMapToArray();

    //do not search implied global references in external libraries
    //(applies to client-side code)
    inputFileList = inputFileList.filter(inputFile => {

        return inputFile.moduleType !== enums.ModuleType.library;
    });

    inputFileList.forEach(inputFile => {

        let impliedGlobals = inputFile.impliedGlobals;

        //don't proceed in case that inputFile doesn't contain implied globals
        if(impliedGlobals.length === 0) {

            return;
        }
        
        //retrieve references of each implied global defined in inputFile
        //in the other modules (exclude inputFile)
        let referenceFiles = inputFileList.filter(refFile => {

            return refFile !== inputFile;
        });

        impliedGlobals.forEach(impliedGlobal => {

            retrieveUsagesOfModuleDefinitionInSystem(referenceFiles, inputFile, impliedGlobal);
        });
    });
}

/**
 * For each global object property of each module in inputFiles, 
 * retrieves its references in other modules of the analyzed system.
 * Applies to non-strict mode code, regardless of the employed module system.
 * @param {*} inputFiles 
 */
function retrieveGlobalObjectPropertyReferences(inputFiles) {

    console.log(`Retrieve global object properties used in the system.`);

    let inputFileList = inputFiles.convertHashMapToArray();

    //do not search global object references in external libraries
    //(applies to client-side code)
    inputFileList = inputFileList.filter(inputFile => {

        return inputFile.moduleType !== enums.ModuleType.library;
    });

    inputFileList.forEach(inputFile => {

        let globalObjProps = inputFile.globalObjectProperties;

        console.log(`$File: ${inputFile.fileName}, global object properties: ${globalObjProps.length}. `);

        //don't proceed in case that inputFile doesn't contain global object properties
        if(globalObjProps.length === 0) {

            return;
        }
        
        //retrieve references of each global object property defined in inputFile
        //in the other modules (exclude inputFile)
        let referenceFiles = inputFileList.filter(refFile => {

            return refFile !== inputFile;
        });

        globalObjProps.forEach(globalObjProp => {

            retrieveUsagesOfModuleDefinitionInSystem(referenceFiles, inputFile, globalObjProp);
        });
    });
}

/**
 * Retrieves the references of moduleDefinition within refFile.
 * (Needed for resolving occurences inside nested object/array indices).
*/
function mapElementReferencesOfRefFileToModuleDefinition(refFile, definitionModule, defName, analysisFileObjs, defRange) {

    // console.log(refFile.fileName + ' ' + defName)
    //approximation: Tern cannot retrieve element references
    //inside expressions using the bracket notation reliably
    //in the case that moduleDefinition is not referenced,
    //ensure that no identifiers are defined through moduleDefinition
    let defRefs = refFile.astRootCollection.find(jscodeshift.Identifier).filter(id => {

        return id.value.name === defName;
    });

    // console.log(defRefs.length)
    if(defRefs.length === 0) {

        return [];
    }

    //keep only references of moduleDefinition
    //prevent name collisions
    defRefs = defRefs.filter(identifier => {
                
        // console.log(identifier.value.loc);
        let identifierStart = identifier.value.range[0];
        let identifierEnd = identifier.value.range[1];

        ternServer.addFile(refFile.fileName, refFile.astRootCollection.toSource());
                
        let requestDetails = {
            query: {
                
                type: "definition",
                file: refFile.fileName,
                start: identifierStart,
                end: identifierEnd,
                variable: identifier.value.name
            },
            timeout: 1000,
            files: analysisFileObjs
        };

        //is reference modelling an access to a variable defined in refFile?
        let isRefDefinedInRefFile = false;
        let definitionFile;
        let defStart;
        let defEnd;

        ternServer.request(requestDetails, function(error, success) {
        
            // console.log(success)
            // console.log(error);
            if(error !== null || Object.keys(success).length === 0) {
        
                return;
            }
                    
            //retrieve range of declaration
            definitionFile = success.origin;
            defStart = success.start;
            defEnd = success.end;
        
        });

        ternServer.delFile(refFile.fileName);

        //definitionFile identical to refFile
        //do not proceed
        if(definitionFile != null &&
            require.resolve(definitionFile) === require.resolve(refFile.fileName)) {

            return false;
        }

        //find definition of identifier in other modules through a query in ternjs
        //(stop request after 1 sec)
        requestDetails = {
            query: {
                
                type: "definition",
                file: refFile.fileName,
                start: identifierStart,
                end: identifierEnd,
                variable: identifier.value.name
            },
            timeout: 1000,
            files: analysisFileObjs
        };
        
        let isRef = false;
        
        ternServer.request(requestDetails, function(error, success) {
        
            // console.log(success)
            // console.log(error);
            if(error !== null || Object.keys(success).length === 0) {
        
                //Ternjs approximation: assume that identifier is a moduleDefinition reference
                //in the case that position is wrongly marked as out of file
                isRef = true;
                return;
            }
                    
            //retrieve range of declaration
            definitionFile = success.origin;
            defStart = success.start;
            defEnd = success.end;
        
        });

        if(isRef === true) {

            return true;
        }
        
        if(definitionFile === undefined) {
        
            //definitionFile not modified with ternjs's results
            return false;
        }

        if(require.resolve(definitionFile) === require.resolve(definitionModule.fileName) &&
            defStart === defRange[0] && defEnd === defRange[1]) {

            return true;
        }
        
        return false;
    });

    let refFileDefRefs = [];
    defRefs.forEach(defRef => {

        refFileDefRefs.push({

            'start': defRef.value.range[0],
            'end': defRef.value.range[1]
        });
    });

    return refFileDefRefs;
}

//functionality for imported definitions 
//pointing to defined elements
exports.addTopLevelDefinitionsToImportedDefinitionsOfModule = addTopLevelDefinitionsToImportedDefinitionsOfModule;
exports.addImportedElementToSourceFiles = addImportedElementToSourceFiles;
exports.retrieveTopLevelDefinitionReferences = retrieveTopLevelDefinitionReferences;

//functionality for imported definitions 
//pointing to elements without definition (implied globals/global object properties)
exports.retrieveImpliedGlobalsUsedInModule = retrieveImpliedGlobalsUsedInModule;
exports.retrieveImpliedGlobalReferences = retrieveImpliedGlobalReferences;
exports.retrieveGlobalObjectPropertyReferences = retrieveGlobalObjectPropertyReferences;