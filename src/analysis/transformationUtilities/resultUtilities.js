/**
 * 
 */

var fs = require('fs');
var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var jsonStream = require('../../../node_modules/JSONStream');

var ObjectProperty = require('../ast/model/objectProperty.js');
var FunctionProperty = require('../ast/model/functionProperty.js');

var enums = require('../ast/util/enums.js');
var reservedWords = require('../ast/util/reservedWords.js');
var fileUtilities = require('../../io/fileUtilities.js');
var util = require('../ast/util/util.js');

var Variable = require('../ast/model/variable.js');
var FunctionDeclaration = require('../ast/model/functionDeclaration.js');

//array containing the transforms that need to be applied
//to the system for its integration to ES6 modules
var systemTransformationList = [];

/**
 * Writes common coupled module sets of a system to a JSON file.
 * @param commonCoupledModuleSets
 * @returns
 */
function writeCommonCoupledModuleSetsToJSON(commonCoupledModuleSets) {
	
	var commonCoupledModuleJSONObjects = [];
	commonCoupledModuleSets.forEach(function(commonCoupledModuleSet) {
		
		var sharedGlobal = commonCoupledModuleSet.sharedGlobal;
		var commonCoupledModules = commonCoupledModuleSet.commonCoupledModules;
		
		var sharedGlobalJSONObject = {
				
				"variableName": sharedGlobal.variableName
		};
		
		var commonCoupledModulesJSONArray = [];
		commonCoupledModules.forEach(function(commonCoupledModule) {
			
			var fileName = commonCoupledModule.fileName;
			
			var commonCoupledModulesJSONObject = {
					
					"fileName": fileName
			};
			
			commonCoupledModulesJSONArray.push(commonCoupledModulesJSONObject);
			
		});
		
		var jsonData = {};
		jsonData["sharedGlobal"] = sharedGlobalJSONObject;
		jsonData["commonCoupledModules"] = commonCoupledModulesJSONArray;
		
		//push json object containing modules that share sharedGlobal and
		//proceed to the next common coupled module set
		commonCoupledModuleJSONObjects.push(jsonData);
		return;
	});
	
	var jsonFilePtr = fs.createWriteStream('./resultFiles/commonCoupledModuleSets.json');
	var jsonFileStream = jsonStream.stringifyObject(null, null, null, 4);
	jsonFileStream.pipe(jsonFilePtr);
	jsonFileStream.write(["commonCoupledModuleJSONObjects", commonCoupledModuleJSONObjects]);
	jsonFileStream.end();
	
//	fs.writeFileSync('./resultFiles/commonCoupledModuleSets.json', circularJson.stringify(commonCoupledModuleJSONObjects, null, 4), function(err) {
//		
//		if(err) {
//			
//			throw err;
//		}
//		
//	});
}

/**
 * Generates a JSON object containing the moduleDependency list of inputFile
 * and returns it.
 * @param inputFile the file whose moduleDependency is mapped to a json object
 * @param inputFiles the hash map of the system's files (needed for resolving name conflicts
 * in inputFile w.r.t imported features from other files)
 * @param isLibrary is the analyzed system a library? useful for specifying the transformation type
 * @returns
 */
function generateJSONObjectContainingInputFileTransformations(inputFile, inputFiles, isLibrary = false) {
	
	let sourceFileTransformationObject = {};

	// console.log(`isLibrary: ${isLibrary}`);

	//temporary object containing inputFile's information
	let fileInfo = {};
	fileInfo.fileName = inputFile.fileName;
	fileInfo.sourceVersion = inputFile.sourceVersion;
	fileInfo.moduleFramework = inputFile.moduleFramework;
	fileInfo.isEntryFile = inputFile.isEntryFile;
	fileInfo.isIncludedInLibrary = isLibrary;
	
	//the array containing the transforms that need to be applied to inputFile
	let moduleDependencyList = inputFile.moduleDependencyList;
	let transformationList = [];
	
	console.log(`Generating json file for ${inputFile.fileName}.`);
	
	//create a json file for each module
	moduleDependencyList.forEach(moduleDependency => {

		// console.log(moduleDependency);
		
		//for each moduleDependency, create the respective transformation object (export/import)
		//mduleDependency: edge in MDG (MDGEdge)
		let transformationObject = {};
		transformationObject.type = null;
		let moduleDependencyType = moduleDependency.type;
		// console.log(moduleDependencyType)
		// let modificationFunctions = [];

		// let modificationFunctions = moduleDependency.modificationFunctions !== undefined ? moduleDependency.modificationFunctions : [];

		/**
		 * Just before inserting a transformation object to the list
		 * (when breaking switch), minimize element object to prevent memory overflow
		 * don't do this during generation of the transformation object,
		 * since processing might break
		 */
		let transformationInfo;
		switch(moduleDependencyType) {

			case 'replace':

				//update: AMD modules have an extra transformation 
				//that replaces the call to define()/require()/requirejs()
				//with the body of the callback function given as its last argument
				transformationInfo = {};
				transformationObject.type = "replace_call";
				transformationInfo.exportedElement = util.minimizeExportedFeature(moduleDependency.exportedElement);

				// transformationInfo.exportedElement = moduleDependency.exportedElement;



				// transformationInfo.exportedElement.modificationFunctions = modificationFunctions;

				transformationObject.transformationInfo = transformationInfo;
				break;
		
			case 'export':

				//update: for test files, all imports/exports are considered,
				//since a module might import a test module
				transformationInfo = {};

				if(moduleDependency.exportedElement.dataType === 'implied') {

					//exported element represents an implied global
					//(a variable that is used without being defined)
					transformationInfo.exportedElement = util.minimizeExportedFeature(moduleDependency.exportedElement);
					// transformationInfo.exportedElement = moduleDependency.exportedElement;
					transformationObject.type = "export_implied_global";
				}
				else if(moduleDependency.setterFunction === true) {

					// console.log(moduleDependency.modificationFunction.dependency.edgeType);
					if(moduleDependency.modificationFunction.dependency.edgeType !== 'GlobalObjectPropertyModification') {

						//export scripts are only considered for GOPM dependencies
						//proceed to the next transformation
						return;
					}

					// console.log(moduleDependency.modificationFunction.dependency.accessedElement);

					//export script relevant to the creation of a setter function
					let importedElementObject = {
						
						"elementName":  moduleDependency.modificationFunction.dependency.accessedElement.elementName,
						// "propertyAccessStatementNode": moduleDependency.modificationFunction.dependency.accessedElement.propertyDefinitionNode.value,
						"propertyAccessStatementNode": util.minimizeNode(moduleDependency.modificationFunction.dependency.accessedElement.propertyDefinitionNode.value),
						"definitionFunctionName": moduleDependency.modificationFunction.functionName,
						"importFile": moduleDependency.modificationFunction.importFile
					};

					transformationInfo.dependencyType = moduleDependency.modificationFunction.dependency.edgeType;
					transformationInfo.importedElement = importedElementObject;
					transformationObject.type = 'introduce_global_property_setter_function';
					
					// transformationObject.transformationInfo = transformationInfo;
				}
				else if(inputFile.moduleType === enums.ModuleType.library) {

					//export definitions from external library - these libraries are IIFEs
					//(applies to client-side code)
					transformationInfo.exportedElement = util.minimizeExportedFeature(moduleDependency.exportedElement);
					// transformationInfo.exportedElement = moduleDependency.exportedElement;
					transformationObject.type = "export_IIFE";
				}
				else {

					// console.log(moduleDependency);

					//add export dependency object regardless of module type and exported definition type
					//precondition: global variables/top-level functions are defined once in inputFile
					let exportedElement = moduleDependency.exportedElement;
					let elDataType = exportedElement.dataType;
					transformationInfo.exportedElement = util.minimizeExportedFeature(exportedElement);
					// transformationInfo.exportedElement = exportedElement;

					// transformationInfo.exportedElement.modificationFunctions = modificationFunctions;
					transformationInfo.exportedElementType = elDataType === 'variable' ?
																'VariableDeclaration' :
																(elDataType === 'function' ?
																 'FunctionDeclaration' :
																 'ObjectLiteral');

					transformationObject.type = elDataType === 'variable' ?
												'export_variable' :
												(elDataType === 'function' ?
												 'export_function' :
												 'export_object_with_properties');
				}
				
				transformationObject.transformationInfo = transformationInfo;
				// console.log(transformationObject);
				break;
			
			case 'import':

			// console.log(inputFile.fileName);
				// console.log(moduleDependency.dependency);
				
				//update: AMD module may import elements from a plain JS module (it imports all top-level functions and global variables)
				let importFileModuleFramework = moduleDependency.importFileModuleFramework;
				
				//don't map dependency to a custom object for the json file here
				//processing w.r.t. name collisions at the module feature object property level
				let dependency = moduleDependency.dependency;
				let dependencyType = dependency.edgeType;
				let doesImportedElementHandleThis = moduleDependency.doesImportedNamespaceHandleThis;
				
				transformationInfo = {};

				let importedElement = dependency.accessedElement;

				//<relative-path>
				let importedSource = importedElement.declaredSource;

				//find the imported feature's definition module
				let specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedSource);
				
				// console.log(specifiedModulePath);

				//retrieve importedSource in inputFiles' list
				let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
				
				// console.log(importFile.fileName);

				// console.log(importedElement);
				// console.log(importedElement.moduleDefinitions.exportedProperties);

				// console.log(importedElement.propertyAccessStatementNode)

				if(dependencyType === 'GlobalObjectPropertyDefinition' ||
				   dependencyType === 'GlobalObjectPropertyUse' ||
				   dependencyType === 'GlobalObjectPropertyModification') {

					// console.log(importedElement.propertyDefinitionNode.value);
					let isPropertyComputed = false;
					if(importedElement.propertyDefinitionNode.value.type === 'AssignmentExpression') {

						isPropertyComputed = importedElement.propertyDefinitionNode.value.left.computed;
					}
					else if(importedElement.propertyDefinitionNode.value.type === 'UnaryExpression') {

						isPropertyComputed = importedElement.propertyDefinitionNode.value.argument.computed;
					}
					if(isPropertyComputed === true ||
					   reservedWords.globalObjectBuiltInProperties.includes(importedElement.elementName) === true) {

						//global object property is computed (a variable, not a literal)
						//(global object indexed with bracket notation)
						//do not transform into a module variable, since it may reference every global property
						//the transformation introduces a specific variable - proceed to the next transformation
						return;
					}

					//module dependency involves the definition/use/modification
					//of a global property
					let importedElementObject = {
						
						"elementName": importedElement.elementName,
						// "propertyAccessStatementNode": importedElement.propertyDefinitionNode.value,
						"propertyAccessStatementNode": util.minimizeNode(importedElement.propertyDefinitionNode.value),
						"definitionFunctionName": moduleDependency.definitionFunctionName,
						"importFile": dependency.importFile
					};

					transformationInfo.dependencyType = dependencyType;
					transformationInfo.importedElement = importedElementObject;
					transformationObject.transformationInfo = transformationInfo;

					if(dependencyType === 'GlobalObjectPropertyDefinition') {

						transformationObject.type = 'introduce_global_property_definition';
					}
					else if(dependencyType === 'GlobalObjectPropertyUse') {

						transformationObject.type = 'introduce_global_property_getter_call';
					}
					else if(dependencyType === 'GlobalObjectPropertyModification') {

						// console.log(dependency);
						// console.log(dependency.importFile);
						// console.log(path.relative(path.basename(inputFile.fileName), dependency.importFile));
						if(dependency.importFile === undefined) {

							//inputFile resolves to the same path with importFile
							//introduce a global property setter function transform
							transformationObject.type = 'introduce_global_property_setter_function';
						}
						else {

							//inputFile does not resolve to the same path with importFile
							//introduce a global property setter function call transform
							transformationObject.type = 'introduce_global_property_setter_call';
						}
						
					}
					
				}
				else {

					// console.log(importedElement);

					//case: import of an implied global defined in a statement that is not an assignment expression
					//(the variable that is going to be imported is not assigned a value - do not import that variable as it is transformed into a local variable, 
					//proceed to the next moduleDependency)
					//+ import of an implied global with the same name with a defined implied global
					// if((dependencyType === 'ImpliedGlobalImport' && importedElement.elementDeclarationNode.type !== 'ExpressionStatement') ||
					// inputFile.retrieveImpliedGlobalByName(importedElement.elementName) !== null) {

					// 	return;
					// }

					//keep values of AST nodes representing the import statements (prevent circular dependencies due to the parents of these nodes)
					//(not critical to name conflict comparison)
					let importedElementNodeValues = importedElement.importedElementNodes == null ? 
													[] :
													importedElement.importedElementNodes.map(importedElementNode => {

														return util.minimizeNode(importedElementNode.value);
														// return importedElementNode.value;
													});
					
					//(not critical to name conflict comparison)
					let modificationFunctions = dependency.modificationFunctions != undefined ? 
												dependency.modificationFunctions.map(modFunc => {

													return util.minimizeModificationFunction(modFunc);
												}) : 
												undefined;

					// let modificationFunctions = dependency.modificationFunctions !== undefined ? dependency.modificationFunctions : null;
					let dataType;

					//(all properties critical to name conflict comparison)
					let functionProperties = [];
					let objectProperties = [];
					let prototypeProperties = [];
					let constructorProps = [];
					let accessedProperties = [];
					let elementExportedViaModuleExports;
					if(dependencyType === 'NamespaceImport' || dependencyType === 'NamespaceModification') {

						let moduleDefinitions = importedElement.moduleDefinitions;

						let exportedVariables = (moduleDefinitions.exportedVariables !== undefined ? moduleDefinitions.exportedVariables : []);
						let exportedFunctions = (moduleDefinitions.exportedFunctions !== undefined ? moduleDefinitions.exportedFunctions : []);
						let exportedProperties = (moduleDefinitions.exportedProperties !== undefined ? moduleDefinitions.exportedProperties : []);

						elementExportedViaModuleExports = exportedVariables.length > 0 ?
															exportedVariables.some(exportedVar => exportedVar.exportedThroughModuleExports) :
															exportedFunctions.length > 0 ?
															exportedFunctions.some(exportedFunc => exportedFunc.exportedThroughModuleExports) :
															exportedProperties.some(exportedProp => exportedProp.propertyExportedThroughModuleExports);

						dataType = (exportedVariables.length > 0 ? 'variable' : (exportedFunctions.length > 0 ? 'function' : 'property'));

						//exportedVariables and exportedProperties mutually excluded
						objectProperties = exportedVariables.map(exportedVariable => exportedVariable.objectProperties);
						objectProperties = objectProperties.concat(exportedProperties.map(exportedProperty => exportedProperty.objectProperties));

						//flatten array or arrays to an array of properties
						objectProperties = objectProperties.reduce((accumulator, currentValue) => {

							accumulator = accumulator.concat(currentValue);
							return accumulator;
						}, []);

						//ObjectProperty[]
						objectProperties = importFile != null ? objectProperties.map(objectProp => {

							return objectProp.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
						}) : [];

						functionProperties = exportedFunctions.map(exportedFunction => exportedFunction.functionProperties);

						//flatten array or arrays to an array of properties
						functionProperties = functionProperties.reduce((accumulator, currentValue) => {

							accumulator = accumulator.concat(currentValue);
							return accumulator;
						}, []);

						//FunctionProperty[]
						functionProperties = importFile != null ? functionProperties.map(functionProp => {

							return functionProp.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
						}): [];

						prototypeProperties = exportedVariables.map(exportedVariable => exportedVariable.prototypeProperties);
						prototypeProperties = prototypeProperties.concat(exportedFunctions.map(exportedFunction => exportedFunction.prototypeProperties));

						//flatten array or arrays to an array of properties
						prototypeProperties = prototypeProperties.reduce((accumulator, currentValue) => {

							accumulator = accumulator.concat(currentValue);
							return accumulator;
						}, []);

						prototypeProperties = importFile != null ? prototypeProperties.map(prototypeProperty => {

							if(prototypeProperty instanceof ObjectProperty.ObjectProperty === true) {

								return prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
							}
							
							return prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
						}): [];

						// if(moduleDependency.doesModuleExportMultipleDefinitions === true) {

						// 	//import namespace brings multiple definitions (functions)
						// 	functionProperties = moduleDependency.functionProperties;
						// 	objectProperties = moduleDependency.objectProperties;
						// }
					}
					else {

						let moduleDefinition = importedElement.moduleDefinition;
						// console.log(inputFile.fileName);
						// console.log(moduleDefinition)
						if(moduleDefinition instanceof Variable.Variable === true) {

							elementExportedViaModuleExports = moduleDefinition.exportedThroughModuleExports;

							dataType = 'variable';
							objectProperties = importFile != null ? moduleDefinition.objectProperties.map(objectProperty => {

								return objectProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
							}): [];

							prototypeProperties = importFile != null ? moduleDefinition.prototypeProperties.map(prototypeProperty => {

								return prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
							}): [];
						}
						else if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

							elementExportedViaModuleExports = moduleDefinition.exportedThroughModuleExports;
							dataType = 'function';
							functionProperties = importFile != null ? moduleDefinition.functionProperties.map(functionProperty => {

								return functionProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
							}) : [];

							prototypeProperties = importFile != null ? moduleDefinition.prototypeProperties.map(prototypeProperty => {

								return prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
							}) : [];
						}
						else {

							dataType = 'implied';
						}

					}

					//right before creating the json object, map critical (to name conflict comparison)
					//properties of imported element to custom minimized objects
					functionProperties = functionProperties.map(funcProp => {

						return util.minimizeProperty(funcProp);
					});

					objectProperties = objectProperties.map(objProp => {

						return util.minimizeProperty(objProp);
					});

					prototypeProperties = prototypeProperties.map(protProp => {

						return util.minimizeProperty(protProp);
					});

					accessedProperties = importedElement.accessedProperties == null ?
											undefined : 
											importedElement.accessedProperties.map(accessedProp => {

												return util.minimizeProperty(accessedProp);
											});

					//importedElementObject is updated with isImportedElementExportedViaModuleExports 
					//(needed in the resolution of the type of the import statement that is going to be introduced in the code transformation phase)
					let importedElementObject = {
							
							"elementName": importedElement.elementName,
							"aliasName": importedElement.aliasName,
							"definitionModuleName": importedElement.declaredSource === null ? null : importedElement.declaredSource,
							// "importedElementNode": importedElement.importedElementNode === null ? null : importedElement.importedElementNode.value,
							"importedElementNodes": importedElementNodeValues,
							"isImportedElementExportedViaModuleExports": elementExportedViaModuleExports,
							"dataType": dataType,
							"importedNamespaceHandlesThis": doesImportedElementHandleThis,
							// "modificationFunctions": modificationFunctions,
							"modificationFunctions": modificationFunctions,
							"exportedElementNames": moduleDependency.exportedElementNames, 
							"isFunctionConstructor": importedElement.isCohesive,
							"isObjectReferenced": moduleDependency.isObjectReferenced,
							"isModified": moduleDependency.dependency.accessedElement.isModified,
							"isNested": importedElement.isNested,
							"impElBoundToFeatAssignedWithModObj": importedElement.impElBoundToFeatAssignedWithModObj,
							"isReexportedDefinitionBoundToTheExportObject" : importedElement.isReexportedDefinitionBoundToTheExportObject,

							//needed for performing renamings due to transmission from default to named imports
							// "isImportedElementExportedViaModuleExports": moduleDependency.isImportedElementExportedViaModuleExports,
							"functionProperties": functionProperties,
							"isVariableInitializedWithObjectExpression": moduleDependency.isInitializedWithObjectExpression,
							"objectProperties": objectProperties,
							"prototypeProperties": prototypeProperties,
							"isAccessedDynamically": importedElement.isAccessedDynamically,
							"accessedProperties": accessedProperties,
							"isMappedToExportedDefinitions": importedElement.isMappedToExportedDefinitions(),
							"isMappedToImportedAndReexportedDefinitions": importedElement.isMappedToImportedAndReexportedDefinitions(),
							"boundToExportedDefinition": importedElement.boundToExportedDefinition,
							"isMappedToObjectWithPropertiesInitializedWithImportDefs": importedElement.mappedToObjectWithPropertiesInitializedWithImportedDefs(),
							"numberOfPropertiesExportedFromModule": moduleDependency.numberOfPropertiesExportedFromModule
					};
					
		//				console.log(importedElement.importedElementNode.value);
					
					transformationInfo.dependencyType = dependencyType;

					// console.log(dependency.usageSet);
					
					//update: the variable's/function's usage set is needed
					//in order to resolve the type of the es6 import statement that will be introduced
					let globalUsages = importedElement.elementUsages.map(elementUsage => {

						return util.minimizeNode(elementUsage.value);
					});
					// let globalUsages = importedElement.elementUsages.map(elementUsage => elementUsage.value);
						
						// console.log(globalUsages);
						
					//case: GlobalDefinition dependency (modification of a global variable)
					//the variable's usage set is needed, as usages need to be renamed
					//(comply with CommonJS specs during integration to ES6)
		//				importedElementObject.usageSet = dependency.usageSet;
						
					importedElementObject.usageSet = globalUsages;
					
					transformationInfo.importedElement = importedElementObject;
					
						// console.log(transformationInfo);
					// console.log(dependencyType);
					
					transformationObject.transformationInfo = transformationInfo;
					
					if(dependencyType === 'ImpliedGlobalImport' || importFileModuleFramework !== null && 
					importFileModuleFramework.includes(enums.ModuleFramework.plain) === true && dependencyType !== 'ModuleImport') {

						//AMD module imports elements from a plain JS module
						//introduce ES6 named imports
						transformationObject.type = "insert_named_import";
					}
					else {

						transformationObject.type = "insert_import";
					}
			
			// console.log(transformationObject);
				}

				break;

			case 'introduce_variable_definition':

				//transformation for implied globals that are used only within module
				// console.log(moduleDependency);

				transformationObject.type = 'introduce_implied_global_definition';
				transformationInfo = {};
				let exportedElement = util.minimizeExportedFeature(moduleDependency.exportedElement);
				// let exportedElement = moduleDependency.exportedElement;
				transformationInfo.exportedElement = exportedElement.variableName;
				// transformationInfo.creationStatement = exportedElement.creationStatement.value;
				transformationInfo.creationStatement = exportedElement.creationStatement;
				transformationInfo.isAssigned = exportedElement.isAssigned;
				transformationInfo.isDefined = exportedElement.isDefined;
				transformationObject.transformationInfo = transformationInfo;

				break;
			
			case 'encapsulate':

				//encapsulate export definition (for CommonJS)
				//TODO map moduleDependency to a custom json object 
				//(both importedElement and moduleDependency itself)
				//special types of dependencies (not import/export)
				transformationObject.type = 'encapsulate_exported_definition';
				transformationInfo = util.minimizeEncapsulatedFeature(moduleDependency);
				// transformationInfo = moduleDependency;
				transformationObject.transformationInfo = transformationInfo;
				break;

			case 'remove':

				//remove redundant import (for CommonJS)
				//TODO map moduleDependency to a custom json object
				transformationObject.type = 'remove_redundant_import';
				transformationInfo = util.minimizeEncapsulatedFeatureImport(moduleDependency);
				// transformationInfo = moduleDependency;
				transformationObject.transformationInfo = transformationInfo;
				break;
		}

		// console.log(transformationObject);
		
		//push transformObject to transformList and proceed with the next transformationObject
		if(transformationObject.type !== null) {
			
			transformationList.push(transformationObject);
		}
		
	});
	
//	console.log(transformationList);
	
	//store transformationList in sourceFileTransformationObject 
	//(sourceFileTransformationObject represents inputFile and the transformations needed for its integration to ES6)
	sourceFileTransformationObject.fileInfo = fileInfo;
	sourceFileTransformationObject.transformationList = transformationList;

	return sourceFileTransformationObject;
}

/**
 * Creates a JSON object array. Each element of the array 
 * represents a JSON object containing the transformations 
 * that need to be applied to each inputFile in inputFiles list (used for small projects).
 * @param inputFiles
 * @returns
 */
function writeJSONObjectToFile(inputFile, sourceFileTransformationObject) {

	//write data to json file
	let relativeFilePath = './resultFiles/' + inputFile.fileName.replace(/\\/g, '_');
	let jsonFileName = relativeFilePath.replace(/:/g, '') + '_result.json';

	console.log(`Writing data to ${jsonFileName}.`);
	
	// console.log(sourceFileTransformationObject);
	fs.writeFileSync(jsonFileName, JSON.stringify([sourceFileTransformationObject], null, 4), 'utf-8');

	console.log('Generated ' + jsonFileName);

	return {

		inputFileName: inputFile.fileName,
		jsonFileName: jsonFileName
	};

}

exports.writeCommonCoupledModuleSetsToJSON = writeCommonCoupledModuleSetsToJSON;
exports.generateJSONObjectContainingInputFileTransformations = generateJSONObjectContainingInputFileTransformations;
exports.writeJSONObjectToFile = writeJSONObjectToFile;

exports.systemTransformationList = systemTransformationList;