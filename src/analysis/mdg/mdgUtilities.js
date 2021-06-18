/**
 * http://usejsdoc.org/
 */

var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var cloneDeep = require('../../../node_modules/lodash.clonedeep');

var Variable = require('../ast/model/variable.js');
var FunctionDeclaration = require('../ast/model/functionDeclaration.js');
var ExportedProperty = require('../ast/model/exportedProperty.js');
var ObjectLiteral = require('../ast/model/objectLiteral.js');
var ImpliedGlobalVariable = require('../ast/model/impliedGlobalVariable.js');

var ImportedElement = require('../ast/model/importedElement.js');
var ImportedNamespace = require('../ast/model/importedNamespace.js');

var amdUtilities = require('../metrics/amdUtilities/amdUtilities.js');

var ModuleDependenceGraph = require('./ModuleDependenceGraph.js');
var moduleDependencyEnum = require('./ModuleDependency.js');

var util = require('../ast/util/util.js');
var enums = require('../ast/util/enums.js');
let reservedWords = require('../ast/util/reservedWords.js');
var fileUtilities = require('../../io/fileUtilities.js');
// const { init } = require('tern/lib/def');

/**
 * Creates and returns the Module Dependence Graph.
 * @param inputFiles
 * @returns
 */
function createMDG(inputFiles, directory) {
	
	/**
	 * Module Dependence Graph: graph visualizing dependencies between the modules of the analyzed system:
	 * (a) nodes: JS modules of the analyzed system
	 * (b) edges: module dependencies (imports) -> extension with global usages
	 */

	console.log(`Constructing the MDG of the system.`);
	
	//(i) initialize MDG (initialize graph nodes)
	var moduleDependenceGraph = new ModuleDependenceGraph.ModuleDependenceGraph(directory);
	moduleDependenceGraph.initializeNodeListOfMDG(inputFiles);
	
	//(ii) update MDG with edges (modules' data and function dependencies)
	moduleDependenceGraph.updateMDGEdges(inputFiles);

	//visualise MDG to image
	//moduleDependenceGraph.visualizeGraph();
	
	return moduleDependenceGraph;
}

/**
 * Retrieves the module import dependencies of inputFile.
 * @param inputFiles the input file hashmap
 * @param moduleDependenceGraph the MDG used for retrieving the file's module import deps
 * @param inputFile the file importing features from other files
 * @param isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
 */
function retrieveModuleDependenciesOfModule(inputFiles, moduleDependenceGraph, inputFile, isLibrary = false) {
	
	//refactor to use some() (or find()) instead of filter()
	//boolean question (no need to search all list elements)
	if((inputFile.moduleDependencyList.some(md => md.type === 'import') === true) ||
		(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true &&
		inputFile.moduleDependencyList.some(md => md.type === 'replace') === true)) {

		//do not traverse MDG again, in the case that inputFile's module dependency list is
		//already generated (during statistics retrieval)
		return;
	}

	console.log(`Retrieving module dependencies of ${inputFile.fileName}. IsLibrary: ${isLibrary}`);

	//retrieve MDG node representing inputFile
	let mdgNode = moduleDependenceGraph.retrieveMDGNodeRepresentingModule(inputFile);

	// console.log('i: ' + inputFile.fileName);

	//print mdgNode
//	mdgNode.printMDGNode();
	
	//retrieve adjacent nodes
	//Adjacent node: object of type {MDGNode, MDGEdge}
	//MDGNode: object of type {SourceFile, AdjacencyList}
	//MDGEdge: object of type {edgeType [enum], ImportedElement, usageSet}
	let adjacencyList = mdgNode.adjacencyList;
	
	//module dependencies: the elements that are imported in inputFile (module imports + replace of define() calls)
	let moduleDependencies = [];

	let exportedFunction;
	let exportedVariable;
	let isExternalLibrary;

	// console.log(inputFile.fileName + " " + adjacencyList.length);
	// console.log(fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile));

	if(fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile) === true) {

		//inputFile comprises an external library - do not consider import dependencies
		//for that module
		return;
	}

	console.log(`#Module dependencies: ${adjacencyList.length}`);
	
	//retrieve module dependencies of inputFile (retrieve dependencies that are included in the MDG)
	adjacencyList.forEach(adjacentNode => {
		
		//each adjacentNode contains the module dependency (import)
		let adjacentMDGNode = adjacentNode.node;
		let representedModule = (adjacentMDGNode.representedModule === undefined ? adjacentMDGNode : adjacentMDGNode.representedModule);
		let moduleDependency = adjacentNode.moduleDependency;

		isExternalLibrary = fileUtilities.doesFileContainCodeFromExternalLibrary(representedModule);

		//library systems are syntactically transformed
		//(imports are introduced, just like in non-libraries.
		//However, exports are introduced regardless of their use,
		//since all modules act as entry files, check function for extra exports in entry files)
		//again, I don't consider importing features from files that are external to the analyzed system 
		//(e.g. require.js in RequireJS projects, external libraries e.g. jquery in non-modular ES5)
		if(moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.NamespaceImport && 
			moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.ModuleImport && 
			moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition &&
			moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyUse &&
			moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification && 
			(isExternalLibrary === true || (moduleDependency.usageSet.length === 0))) {

			//do not consider import scripts when:
			//(a) an AMD module imports elements from require.js (require.js added in the excluded file argument of the execution command)
			//(b) a module imports implied globals or exported global variables from an external library

			//do not introduce imports, in the case that 
			//the imported element (implied global) has no usages
			return;
		}

		// console.log(moduleDependency.edgeType + " " + (adjacentMDGNode.representedModule != undefined ? adjacentMDGNode.representedModule.fileName : null));
		// console.log(moduleDependency);

		// console.log(adjacentMDGNode.representedModule.fileName);
		
		//(i) add module dependency in moduleDependencies array (module dependencies of inputFile (imports))
		// console.log(moduleDependency)
		let importDependencyObject = {};
		importDependencyObject.type = "import";
		importDependencyObject.dependency = moduleDependency;
		importDependencyObject.dependency.usageSet = importDependencyObject.dependency.usageSet.map(elemUse => elemUse.value);
		importDependencyObject.importFileModuleFramework = (representedModule.moduleFramework === undefined ? null : representedModule.moduleFramework);

		//(ii) add module dependency as an export to adjacentMDGNode.representedModule
		let exportDependencyObject;

		if(adjacentMDGNode.representedModule === undefined) {

			//adjacentMDGNode represents an external npm package - 
			//do not introduce export script (these packages are not refactored), 
			//introduce import script only
			moduleDependencies.push(importDependencyObject);
			return;
		}

		// console.log(representedModule.fileName);
		// console.log(moduleDependency.edgeType);
		// console.log(moduleDependency.usageSet);
		
		if(moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.NamespaceImport || 
		   moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.NamespaceModification) {

			//NamespaceImport dependency: all properties, variables, functions, classes 
			//of module represented by adjacentMDGNode must be exported
			//update: not all (only the used ones, try to improve encapsulation)
			//update: it also applies to AMD
			// console.log(adjacentMDGNode.representedModule.fileName + ' ' + moduleDependency.accessedElement.elementName);
			// console.log(moduleDependency.accessedElement.moduleDefinitions);
			moduleDependency.accessedElement.isModified = moduleDependency.accessedElement.isModifiedThroughoutSystem;

			// console.log(moduleDependency.accessedElement);

			//namespace import might bring >1 properties
			//(export element names have changed - do NOT compare against them!)
			let exportedObjects = addExportDependenciesToModuleDependencyList(adjacentMDGNode.representedModule, moduleDependency.accessedElement, inputFiles, isLibrary);
			
			// console.log()
			// console.log(adjacentMDGNode.representedModule.fileName);
			// console.log('e: ' + exportedObjects.length + ' ' + isLibrary);

			//don't filter out imported features in case of a library
			if(exportedObjects.length > 1 &&
				isLibrary === false) {

				//namespace import brings multiple definitions (exportedObjects)
				//import the definitions (properties) that are actually used
				//update: consider each exported object in the case of a nested import
				// console.log(moduleDependency);
				if(exportedObjects.find(expObj => {

					// console.log(expObj);
					return expObj.exportedElement.isNested === true;

				}) === undefined && 
				moduleDependency.accessedElement.isMappedToReferencedObjects() === false) {

					let usageSet = moduleDependency.accessedElement.elementUsages;
					let importedElementNodes = moduleDependency.accessedElement.importedElementNodes;

					//retrieve the actual import of these definitions
					//(needed to retrieve the refs of the imported features)
					//imported feat refs are retrieved through the import type
					//((a) simple require() invocation, 
					//(b) require() invocation succeeded by a direct access to the property (member expression))
					let impElNodePropRefs = importedElementNodes.filter(impElNode => {

						return impElNode.parentPath.value.type === 'MemberExpression';
					});

					//retrieve the imported feature's uses
					let elementMemberExpRefs = usageSet.filter(usage => {

						//element (property) accessed through the result of require() (member expression)
						//imported-feat = <require_invoc>.<property>
						//keep usage
						if(impElNodePropRefs.length > 0) {

							return true;
						}

						//imported-feat = <require_invoc>
						//keep usages inside member expressions
						return usage.parentPath.value.type === 'MemberExpression';
					});
					// console.log(usageSet);

					//filter exportedObjects based on the properties
					//that are actually used in the module that imports the namespace
					exportedObjects = exportedObjects.filter(exportedObject => {

						// console.log(exportedObject);

						let exportedElement = exportedObject.exportedElement;
						// let elementName = exportedElement.exportedElementName;
						let elementName = exportedElement.elementAlias;

						//if import is succeeded by a property access
						//and this access references elementName
						//consider exportedObject
						//impElNodePropRefs: filtered from the import statements for 
						//the specific imported element (1-1 mapping between imported feats-module deps)
						if(impElNodePropRefs.find(impElNodePropRef => {

							return impElNodePropRef.parentPath.value.property.type === 'Identifier' &&
									impElNodePropRef.parentPath.value.property.name === elementName;

						}) != undefined) {

							return true;
						}

						// console.log(elementMemberExpRefs);

						//is elementName referenced within a reference of the imported namespace?
						let elementRefs = elementMemberExpRefs.filter(elementMemberExpRef => {

							// console.log(elementMemberExpRef);

							//import (require()) is succeeded by a direct property access
							//check whether usage references the actual element (property)
							//or the accessedElememt's alias (in cases of assignment of 
							//the member expression to a feature with another name (name aliasing))
							if(impElNodePropRefs.length > 0) {

								return elementMemberExpRef.value.name === elementName;
							}

							return elementMemberExpRef.parentPath.value.type === 'MemberExpression' &&
									elementMemberExpRef.parentPath.value.property.type === 'Identifier' &&
								elementMemberExpRef.parentPath.value.property.name === elementName;
						});

						//update: is elementName referenced right after the import stmt?
						//(in cases of nested imports inside other statements, e.g. call expressions)
						let propRefInStmtNestingImport = impElNodePropRefs.find(impElNodePropRef => {

							// console.log(impElNodePropRef.parentPath.parentPath.value.type)

							//impElNodePropRef: CallExpression
							//parent: MemberExpression (through filtering)
							//grandparent: not an (a) assignment, (b) expression statement, (c) variable declarator
							if(impElNodePropRef.parentPath.parentPath.value.type === 'AssignmentExpression' ||
								impElNodePropRef.parentPath.parentPath.value.type === 'ExpressionStatement' ||
								impElNodePropRef.parentPath.parentPath.value.type === 'VariableDeclarator') {

								return false;
							}

							// console.log(impElNodePropRef.parentPath.value);

							//keep exportedObject only in the case that
							//it specifies the property accessed after the import statement
							//that is nested
							if(impElNodePropRef.parentPath.value.type === 'MemberExpression' &&
								impElNodePropRef.parentPath.value.property.type === 'Identifier' &&
								impElNodePropRef.parentPath.value.property.name === elementName) {

								return true;
							}
							
							return false;
						});

						// console.log(propRefInStmtNestingImport);
						// console.log(moduleDependency.accessedElement.boundToExportedDefinition);

						//update: consider exportedObject also in case
						//of a reference in a statement that nests the import statement (e.g. callexpression)
						if(propRefInStmtNestingImport != undefined ||
							elementRefs.length > 0 || 
							exportedObject.isNested === true || 
							moduleDependency.accessedElement.boundToExportedDefinition === true || 
							exportedObject.isObjectReferenced === true) {

							//elementName accessed at least 1 through a reference to imported namespace
							//or it is imported in a nested scope at least once
							//or it is exported from the module
							//add it to the generation of import codemods
							return true;
						}

						return false;
					});
				}

				
			}

			// console.log(exportedObjects.length)
			if(exportedObjects.length === 0) {

				//no property is being used (and thus needs to be exported)
				return;
			}

			//create module dependency with respect to each exported definition
			//add it to the module's dependency list
			//and proceed to the next module dependency
			// console.log(exportedObjects);

			if(exportedObjects.length === 1) {

				let exportedObject = exportedObjects[0];
				let exportedElement = exportedObject.exportedElement;

				// console.log(exportedObject)
				// console.log(moduleDependency.accessedElement);
				// console.log(exportedElement);

				if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

					//case: accessedElement is a property,
					//while the import statement (member expression)
					//is nested in other expression (e.g. call expression)
					let importExpAccessingProp = moduleDependency.accessedElement.importedElementNodes.find(impElNode => {

						//only applies to properties (don't proceed otherwise)
						if(exportedElement.dataType !== 'property') {

							return false;
						}

						//keep an import expression that
						//(a) it's parent is a member expression
						//(b) the property of the parent member expression is the feature specified in exportedElement
						return impElNode.parentPath.value.type === 'MemberExpression' &&
								impElNode.parentPath.value.property.type === 'Identifier' &&
								impElNode.parentPath.value.property.name === exportedElement.elementAlias;
					});

					//1 definition is actually used
					//(namespace has names based on the definition module's name)
					if(exportedElement.dataType === 'variable' ||
						exportedElement.dataType === 'function' ||
						(exportedElement.dataType === 'property' &&
						importExpAccessingProp !== undefined)) {

						moduleDependency.accessedElement.elementName = exportedElement.isImportedAndReexported === false ? 
																		exportedElement.elementAlias :
																		exportedElement.importAlias;
					}

					// console.log(moduleDependency);

					//importedElement is imported in nested scope,
					//while it's mapped to 1 property
					//update: if exportedElement is referenced as an object, it's exported under importAlias
					if(exportedElement.isObjectReferenced === true ||
						(moduleDependency.accessedElement.isNested === true &&
							exportedElement.numberOfPropertiesExportedFromModule === 1)) {

						moduleDependency.accessedElement.elementName = exportedElement.importAlias;
					}
				}

				// //case: accessedElement is a property,
				// //while the import statement (member expression)
				// //is nested in other expression (e.g. call expression)
				// let importExpAccessingProp = moduleDependency.accessedElement.importedElementNodes.find(impElNode => {

				// 	//only applies to properties (don't proceed otherwise)
				// 	if(exportedElement.dataType !== 'property') {

				// 		return false;
				// 	}

				// 	//keep an import expression that
				// 	//(a) it's parent is a member expression
				// 	//(b) the property of the parent member expression is the feature specified in exportedElement
				// 	return impElNode.parentPath.value.type === 'MemberExpression' &&
				// 			impElNode.parentPath.value.property.type === 'Identifier' &&
				// 			impElNode.parentPath.value.property.name === exportedElement.elementAlias;
				// });

				// //1 definition is actually used
				// //(namespace has names based on the definition module's name)
				// if(exportedElement.dataType === 'variable' ||
				// 	exportedElement.dataType === 'function' ||
				// 	(exportedElement.dataType === 'property' &&
				// 	importExpAccessingProp !== undefined)) {

				// 	moduleDependency.accessedElement.elementName = exportedElement.isImportedAndReexported === false ? 
				// 													exportedElement.elementAlias :
				// 													exportedElement.importAlias;
				// }

				// // console.log(moduleDependency);

				// //importedElement is imported in nested scope,
				// //while it's mapped to 1 property
				// //update: if exportedElement is referenced as an object, it's exported under importAlias
				// if(exportedElement.isObjectReferenced === true ||
				// 	(moduleDependency.accessedElement.isNested === true &&
				// 		exportedElement.numberOfPropertiesExportedFromModule === 1)) {

				// 	moduleDependency.accessedElement.elementName = exportedElement.importAlias;
				// }

				// if(exportedElement.isObjectReferenced === true) {

				// 	moduleDependency.accessedElement.elementName = exportedElement.importAlias;
				// }
				// else if(moduleDependency.accessedElement.isNested === true &&
				// 	exportedElement.numberOfPropertiesExportedFromModule === 1) {

				// 	moduleDependency.accessedElement.elementName = exportedElement.elementAlias;
				// }

				let importDependencyObject = {};
				importDependencyObject.type = "import";
				importDependencyObject.dependency = moduleDependency;
				importDependencyObject.importFileModuleFramework = (representedModule.moduleFramework === undefined ? null : representedModule.moduleFramework);
				// importDependencyObject.doesImportedNamespaceHandleThis = exportedObject.exportedElement !== undefined ? exportedObject.exportedElement.doesExportedObjectHandleThis: false;
				importDependencyObject.isFunctionConstructor = exportedElement.isFunctionConstructor;
				importDependencyObject.isObjectReferenced = exportedElement.isObjectReferenced;
				importDependencyObject.functionProperties = exportedElement.functionProperties;
				importDependencyObject.isInitializedWithObjectExpression = exportedElement.isInitializedWithObjectExpression;
				importDependencyObject.objectProperties = exportedElement.objectProperties;
				importDependencyObject.isImportedElementExportedViaModuleExports = exportedElement.isExportedObjectDefinedThroughAssignmentToExports;
				importDependencyObject.numberOfPropertiesExportedFromModule = exportedElement.numberOfPropertiesExportedFromModule;
				importDependencyObject.isNested = moduleDependency.accessedElement.isNested;
				importDependencyObject.impElBoundToFeatAssignedWithModObj = moduleDependency.accessedElement.impElBoundToFeatAssignedWithModObj;
				importDependencyObject.isReexportedDefinitionBoundToTheExportObject = moduleDependency.accessedElement.isReexportedDefinitionBoundToTheExportObject;
				// importDependencyObject.elementName = exportedObject.exportAlias;

				// let elementName;
				// if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				// 	elementName = exportedObject.exportedElement.exportAlias === undefined ? 
				// 					importDependencyObject.dependency.accessedElement.declaredSource : 
				// 					exportedObject.exportedElement.exportAlias;

				// 	elementName = elementName.replace(/.\//g, '');
				// 	elementName = elementName.replace(/-/g, '');
				// 	elementName += 'js';
				// }
				// else {

				// 	elementName = exportedObject.exportedElement.exportedElementName;
				// }
				
				// //the name of the imported element corresponds to the specific element's export alias
				// importDependencyObject.dependency.accessedElement.elementName = (exportedObject.exportedElement.exportAlias === undefined ? 
				// 																elementName : 
				// 																exportedObject.exportedElement.exportAlias);
				
				// console.log(importDependencyObject);
				moduleDependencies.push(importDependencyObject);

				//proceed to the next dependence
				return;
			}

			// console.log(moduleDependency.accessedElement);

			//multiple definitions are actually used (create 1 import codemod)
			let importDependencyObject = {};
			importDependencyObject.type = "import";
			importDependencyObject.dependency = moduleDependency;
			moduleDependency.accessedElement.isModified = moduleDependency.accessedElement.isModifiedThroughoutSystem;
			importDependencyObject.importFileModuleFramework = (representedModule.moduleFramework === undefined ? null : representedModule.moduleFramework);
			importDependencyObject.isFunctionConstructor = moduleDependency.accessedElement.isCohesive;
			importDependencyObject.functionProperties = [];
			importDependencyObject.objectProperties = [];
			importDependencyObject.doesModuleExportMultipleDefinitions = true;
			importDependencyObject.numberOfPropertiesExportedFromModule = exportedObjects[0].exportedElement.numberOfPropertiesExportedFromModule;
			importDependencyObject.isNested = moduleDependency.accessedElement.isNested;
			importDependencyObject.impElBoundToFeatAssignedWithModObj = moduleDependency.accessedElement.impElBoundToFeatAssignedWithModObj;
			importDependencyObject.isReexportedDefinitionBoundToTheExportObject = moduleDependency.accessedElement.isReexportedDefinitionBoundToTheExportObject;

			// console.log(moduleDependency.accessedElement);
			//2 exports of 2 different properties bound to the export object
			exportedObjects.forEach(exportedObject => {

				// console.log(exportedObject);
				let exportedElement = exportedObject.exportedElement;
				importDependencyObject.isObjectReferenced = exportedElement.isObjectReferenced;
				importDependencyObject.isImportedElementExportedViaModuleExports = exportedElement.isExportedObjectDefinedThroughAssignmentToExports;
				importDependencyObject.isInitializedWithObjectExpression = exportedElement.isInitializedWithObjectExpression;
				// importDependencyObject.objectProperties = exportedObject.objectProperties;
				// importDependencyObject.isImportedElementExportedViaModuleExports = exportedElement.isExportedObjectDefinedThroughAssignmentToExports;
				// importDependencyObject.elementName = exportedElement.exportAlias;

				let elementName = exportedElement.exportAlias === undefined ? 
									importDependencyObject.dependency.accessedElement.declaredSource : 
									exportedElement.exportAlias;

				// elementName = elementName.replace(/.\//g, '');
				// elementName = elementName.replace(/-/g, '');
				// elementName += 'js';

				// //the name of the imported element corresponds to the specific element's export alias
				// // importDependencyObject.dependency.accessedElement.elementName = (exportedObject.exportAlias === undefined ? elementName : exportedObject.exportAlias);
				// importDependencyObject.dependency.accessedElement.elementName = moduleDependency.accessedElement.elementName;
				let propertyName = (exportedObject.exportedElement.exportAlias === undefined ? 
									elementName : 
									exportedObject.exportedElement.exportAlias);

				importDependencyObject.functionProperties.push( {

					propertyName: propertyName,
					isExported: true
				});

				importDependencyObject.objectProperties.push( {

					propertyName: propertyName,
					isExported: true
				});

				moduleDependencies.push(importDependencyObject);

				// console.log(importDependencyObject);
			});
			
			// console.log(moduleDependencies.map(md => md.dependency.accessedElement));
			return;
		}
		else if (moduleDependency.usageSet.length > 0) {

			// console.log(moduleDependency)
			let moduleDefinition = moduleDependency.accessedElement.moduleDefinition;

			// console.log(moduleDefinition)

			// console.log(moduleDependency.accessedElement);
			exportDependencyObject = mapModuleDefinitionToExportDepObject(adjacentMDGNode.representedModule, moduleDependency.accessedElement, moduleDefinition, inputFiles, isLibrary);
			// console.log(moduleDependency.accessedElement.moduleDefinition);
			// console.log(exportDependencyObject)

			// exportDependencyObject.exportedElement.exportedElementName = moduleDependency.accessedElement.elementName;

			// exportDependencyObject.exportedElement.elementNode = inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true ? 
			// 													(moduleDependency.accessedElement.elementDeclarationNode.value === undefined ? 
			// 													 moduleDependency.accessedElement.elementDeclarationNode : 
			// 													 moduleDependency.accessedElement.elementDeclarationNode.value) :
			// 													 exportDependencyObject.exportedElement.elementNode;

			exportDependencyObject.exportedElement.isExported = true;
			exportDependencyObject.exportedElement.isCohesive = moduleDependency.accessedElement.isCohesive;
			exportDependencyObject.exportedElement.isImplied = (moduleDependency.edgeType === 'ImpliedGlobalImport') ? true : false;

			importDependencyObject.impElBoundToFeatAssignedWithModObj = moduleDependency.accessedElement.impElBoundToFeatAssignedWithModObj;

			if(moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalDefinition) {

				//a module variable is imported and modified at another module
				//(i) export codemod is followed by the creation of a modification function containing the statement that modifies the module variable
				//(ii) import codemod is followed by the substraction of the statement that modifies the module variable with a call to the newly created modification function

				// console.log(moduleDependency)

				//retrieve usages corresponding to modifications of the module variable in inputFile
				let usageSet = moduleDependency.accessedElement.elementUsages;
				
				let importedElementUsages = usageSet.filter(elemRef => {

					return elemRef.value.type === 'Identifier' &&
							elemRef.value.name === moduleDependency.accessedElement.elementName;
				});

				//retrieve the statements that modify the module variable (needed both for the definition module and
				//for the module importing the variable -
				//in the definition module, modification functions containing the modification statement is going to be created,
				//in the module importing the variable, the modification statement is going to be replaced with a call to the modification function)
				let modificationStatements = [];
				
				// usageSet.forEach(function(usageIdentifier) {
				importedElementUsages.forEach(usageIdentifier => {

					let {isEsModified, modExp} = util.isIdentifierRepresentingAnElementModification(usageIdentifier);

					// console.log(usageIdentifier);
					if(isEsModified === true) {

						// console.log(`${inputFile.fileName} modifies ${moduleDependency.accessedElement.elementName} (line ${usageIdentifier.value.loc.start.line}).`);
						let surrStmts = jscodeshift(modExp).closest(jscodeshift.Statement);

						if(surrStmts.length === 0) {

							return;
						}

						// console.log(surrStmts.at(0).get().value);
						modificationStatements.push(surrStmts.at(0).get().value);

						// let modificationStatement;
						// let traverseStmt = usageIdentifier;
						
						// console.log(traverseStmt);
						// while(traverseStmt !== null &&
						// 	  traverseStmt.value.type !== 'AssignmentExpression' && traverseStmt.value.type !== 'UpdateExpression') {

						// 	modificationStatement = traverseStmt;
						// 	traverseStmt = traverseStmt.parentPath;
						// }
						// console.log(usageIdentifier.parentPath.parentPath);

						// if(traverseStmt !== null) {

						// 	//find the surrounding statement of traverseStmt
						// 	let surrStmt = jscodeshift(traverseStmt).closest(jscodeshift.Statement).at(0).get();
						// 	modificationStatements.push(surrStmt.value);

						// 	// let stmtsContainingModStmt = representedModule.astRootCollection.find(jscodeshift.Statement).filter(stmt => {

						// 	// 	let stmtAST = jscodeshift(stmt);
						// 	// 	let modStmts = stmtAST.find(jscodeshift[traverseStmt.value.type]).filter(modStmt => {

						// 	// 		return modStmt.value === traverseStmt.value;
						// 	// 	});

						// 	// 	if(modStmts.length > 0) {

						// 	// 		return true;
						// 	// 	}

						// 	// 	return false;
						// 	// });


						// 	// modificationStatements.push(traverseStmt.value);
						// }

						//usageIdentifier represents the usage of the variable
						//the grandparent AST node represents the modification expression statement
						// modificationStatements.push(usageIdentifier.parentPath.parentPath.value);
					}
				});

				// console.log(modificationStatements);

				//modificationFunctions will contain the objects with the names of the modification functions that are going to be created,
				//along with the modification statements
				let modificationFunctions = [];
				let modificationFunctionObject;

				//update: for each variable, map all modification statements to 1 mutation function
				if(modificationStatements.length > 0) {

					modificationFunctionObject = {

						//the function that is going to be introduced is specified by:
						//(i) the name of the module represented by adjacentMDGNode
						//(ii) the name of the accessed property
						modificationFunctionName: path.basename(adjacentMDGNode.representedModule.fileName, '.js') + "_" +
													"set_" + moduleDependency.accessedElement.elementName,
						modificationFunctionBodyStatements: modificationStatements
					};

					modificationFunctions.push(modificationFunctionObject);
					adjacentMDGNode.representedModule.updateModificationFunctions(modificationFunctionObject);
				}

				// for(let statementIndex = 0; statementIndex < modificationStatements.length; statementIndex++) {

				// 	modificationFunctionObject = {

				// 		//the function that is going to be introduced is specified by:
				// 		//(i) the name of the module represented by adjacentMDGNode
				// 		//(ii) the name of the accessed property
				// 		//(ii) the number of the already existent modification functions
				// 		//(prevent object overwriting)
				// 		modificationFunctionName: path.basename(adjacentMDGNode.representedModule.fileName, '.js') + "_" +
				// 									moduleDependency.accessedElement.elementName + "_" +
				// 									"modificationFunc" + "_" + 
				// 									adjacentMDGNode.representedModule.modificationFunctions.length,
				// 		modificationFunctionBodyStatement: modificationStatements[statementIndex]
				// 	};

				// 	modificationFunctions.push(modificationFunctionObject);
				// 	adjacentMDGNode.representedModule.updateModificationFunctions(modificationFunctionObject);
				// }

				//(i) in the definition module, modification functions containing the modification statements are going to be created
				exportDependencyObject.exportedElement.modificationFunctions = modificationFunctions;

				// console.log(modificationFunctions);

				//(ii) in the module importing the variable, the modification statement is going to be replaced with a call to the modification function
				importDependencyObject.dependency.modificationFunctions = modificationFunctions;
				
			}

			// console.log(adjacentMDGNode.representedModule.fileName);
			// console.log(exportDependencyObject);

			adjacentMDGNode.representedModule.addExportDependencyToModuleDependencyList(exportDependencyObject);
		
			
		}
		else if(moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition) {

			//moduleDependency involves the definition of a global object property
			importDependencyObject.definitionFunctionName = path.basename(adjacentMDGNode.representedModule.fileName, '.js') + "_" +
															moduleDependency.accessedElement.elementName + "_" +
															"func" + adjacentMDGNode.representedModule.modificationFunctions.length;
		}
		else if(moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyUse ||
				moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification) {

					// console.log(inputFile.fileName + " " + adjacentMDGNode.representedModule.fileName);
					// console.log(adjacentMDGNode.representedModule.fileName);
					// console.log(jscodeshift(moduleDependency.accessedElement.propertyDefinitionNode).toSource());

			//GOPU/GOPM dependency (2-module dependency: 
			//its establishment involves the application of transformations in 2 modules
			//[the module that uses/modifies the property and the module that defines the property])
			let definitionFunctionName = path.basename(adjacentMDGNode.representedModule.fileName, '.js') + "_" +
										 "func" + adjacentMDGNode.representedModule.modificationFunctions.length;
			
			//import dependency object: involves the module that uses/modifies the property
			importDependencyObject.definitionFunctionName = definitionFunctionName;

			//export dependency object: involves the module that defines the property
			//the property's definition module needs to know:
			//(i) the name of the function that will be introduced
			//(ii) the body of the function that will be introduced
			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			// exportDependencyObject.modificationFunction;

			let modificationFunctionObject = {};
			modificationFunctionObject.functionName = definitionFunctionName;
			modificationFunctionObject.dependency = moduleDependency;

			// console.log(moduleDependency.accessedElement.propertyDefinitionNode);

			//add the function info object in the export transformation object
			exportDependencyObject.modificationFunction = modificationFunctionObject;

			//add the function info object in the modification functions of the module that defines the property
			//(the modification functions comprise the functions that will be introduced in the module
			//-needed in order to prevent function overwrites)
			// console.log(adjacentMDGNode.representedModule.modificationFunctions.length);
			adjacentMDGNode.representedModule.updateModificationFunctions(modificationFunctionObject);
			// console.log(adjacentMDGNode.representedModule.modificationFunctions.length);

			// console.log(inputFile.fileName);
			// console.log(adjacentMDGNode.representedModule.fileName);
			// console.log(inputFile.fileName !== adjacentMDGNode.representedModule.fileName);

			//if the two modules are not the same (i.e. the global property is not used/modified in the same module),
			//the usage module must import the function from the definition module through an ES6 named import,
			//while the definition module (the module represented by adjacentMDGNode) must export the function
			//through an ES6 named export
			let importFile = path.relative(path.dirname(mdgNode.representedModule.fileName) + "\\", adjacentMDGNode.representedModule.fileName);
			if(importFile.startsWith('.') === false) {

				importFile = './' + importFile;
			};

			if(inputFile.fileName !== adjacentMDGNode.representedModule.fileName) {

				//add importSource in importDependencyObject
				//mdgNode: the module that imports an element
				//adjacentMDGNode: the module that exports the respective element

				importDependencyObject.dependency.importFile = importFile;

				importDependencyObject.dependency.functionIsImported = true;
				// exportDependencyObject.dependency.functionIsExported = true;
				exportDependencyObject.importFile = importFile;
				exportDependencyObject.setterFunction = true;
			}
			else {

				
				importDependencyObject.dependency.functionIsImported = false;
				// importDependencyObject.dependency.importFile = importFile;
				exportDependencyObject.importFile = importFile;
				exportDependencyObject.setterFunction = true;
				// exportDependencyObject.dependency.functionIsExported = false;
			}

			// console.log(mdgNode.representedModule.fileName);
			// console.log(importDependencyObject);
			// console.log(adjacentMDGNode.representedModule.fileName);
			// console.log(exportDependencyObject);

			//add export script to the adjacent node's module dependency list
			// adjacentMDGNode.representedModule.addExportDependencyToModuleDependencyList(exportDependencyObject);
			// adjacentMDGNode.representedModule.moduleDependencyList.push(exportDependencyObject);
			adjacentMDGNode.representedModule.addGlobalObjectPropertyDependencyToList(exportDependencyObject);
		}
		else if(moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.ModuleImport && 
				adjacentMDGNode.representedModule.moduleType === enums.ModuleType.library &&
				adjacentMDGNode.representedModule.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

					// console.log(adjacentMDGNode);
			//modifying library code applies only to client-side code
			//adding library code body creates a huge JSON
			// let programBody = adjacentMDGNode.representedModule.astRootCollection.find(jscodeshift.Program).get('body').value;
			exportDependencyObject = {};
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.elementName = adjacentMDGNode.representedModule.libraryObjectName === 'null' ?
																	path.basename(adjacentMDGNode.representedModule.fileName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '') :
																	adjacentMDGNode.representedModule.libraryObjectName;
			// exportDependencyObject.exportedElement.elementNode = programBody[0];
			exportDependencyObject.exportedElement.dataType = 'libraryObject';
			exportDependencyObject.type = 'export';
			adjacentMDGNode.representedModule.addExportDependencyToModuleDependencyList(exportDependencyObject);
		}

		// console.log(importDependencyObject);
		moduleDependencies.push(importDependencyObject);
		
		// var exportDependencyObject = {};
		// exportDependencyObject.type = "export";

		// //importedDependency: needed to resolve the type of the imports that will be established, 
		// //along with the exports that need to be established in the module represented by adjacentMDGNode
		// exportDependencyObject.importedDependency = moduleDependency;
		// // exportDependencyObject.exportedElementName = moduleDependency.importedElement.elementName;
		// adjacentMDGNode.representedModule.addExportDependencyToModuleDependencyList(exportDependencyObject);
		
	});

	// console.log(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD))
	if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

		//update: what if a function is defined outside the define/require hook?
		let moduleDeps = generateModuleDependenciesOfBuiltinFunctionInvocations(inputFile, inputFiles);

		moduleDependencies = moduleDependencies.concat(moduleDeps);

		// //for every AMD module, introduce a transformation for the replace of define()
		// //with the body of the callback function specified as the last parameter of the call to define()
		// moduleDependencies.push(exportDependencyObject);
	}

	// console.log(inputFile.fileName);
	// console.log(inputFile.isEntryFile)

	if(inputFile.isEntryFile === true) {

		//inputFile is the project's entry file
		//add export dependencies in its module dependence list, regardless of the fact that it's not imported anywhere
		let exportDeps = retrieveExportDependenciesOfEntryFile(inputFile, inputFiles, isLibrary);
		// console.log(exportDeps);

		//add export dependencies of entry file only in the case they do not already exist
		//assumption: all definitions bound to the export object of the entry file
		//are exported after refactoring, in order to be accessed from other modules
		//(e.g. test files, modules of projects using the analyzed project as a library)
		exportDeps.forEach(exportDependencyObject => {

			if(inputFile.moduleDependencyList.some(exportDep => {

				// console.log(exportDependencyObject);
				// // console.log()
				// console.log(exportDep);
				return exportDep.type === 'export' && 
			   exportDep.exportedElement.elementName === exportDependencyObject.exportedElement.elementName &&
			   
			   exportDep.exportedElement.elementNode === exportDependencyObject.exportedElement.elementNode
			}) === false) {

				//add exportDependency object only in the case it is not already added
				moduleDependencies.push(exportDependencyObject);
			}
		});
		
		// moduleDependencies = moduleDependencies.concat(exportDeps);
	}
	
	//update module dependencies of inputFile (import dependencies)
	inputFile.updateModuleDependencyList(moduleDependencies);

	// console.log(inputFile.moduleDependencyList.filter(md => md.type === 'import').map(md => md.dependency.accessedElement));
	// console.log(inputFile.moduleDependencyList.filter(md => md.type === 'export').map(md => md));

	// console.log(inputFile.moduleDependencyList);

	//add export scripts for exported variables/functions/properties of inputFile
	//regardless of whether they are imported in another module or not
	// addRedundantExportDependenciesToModuleDependencyList(inputFile);

	//add export scripts for implied globals (regardless of whether 
	//they are imported in another module or not)
	addModuleDependenciesOfDefinedImpliedGlobals(inputFile, inputFiles);
}

/**
 * Returns module dependencies with respect to builtin function invocations
 * (applies to AMD modules).
 * @param {*} sourceFile 
 */
function generateModuleDependenciesOfBuiltinFunctionInvocations(sourceFile, inputFiles) {

	//Each AMD module, regardless of the transformations that need to be applied to it,
	//must be replaced with an ES6 module (calls to define()/require() must be replaced
	//with the body of the callback function specified as last parameter)
	let moduleDepObjs = [];

	//find (a) the object that is the last argument of define() or
	// 	   (b) the callback function 
	let builtinFunctionInvStmts = amdUtilities.retrieveBuiltinFunctionInvocations(sourceFile);

	// console.log(sourceFile.fileName)
	// console.log(builtinFunctionInvStmts.length);

	if(builtinFunctionInvStmts.length === 0) {

		return [];
	}

	builtinFunctionInvStmts.forEach(builtinFunctionInvStmt => {

		let modDepObject = {};
		modDepObject.type = "replace";
		modDepObject.exportedElement = {};

		let builtinFunctionInv = builtinFunctionInvStmt.value.expression;
		let calleeName = builtinFunctionInv.callee.name;
		let invArgs = builtinFunctionInv.arguments;
		let invArg = invArgs[invArgs.length - 1];

		//(a) object literals exported as arguments of define()
		//they're exported properties of sourceFile
		//(b) require()/requirejs() invocations where 
		//the last argument is not a callback
		//(they're simply removed)
		if(invArg.type !== 'FunctionExpression') {

			//(a)
			if(calleeName === 'define') {

				sourceFile.exportedProperties.forEach(exportedProp => {

					// console.log(exportedProp);
	
					//the object expression export is identical to its definition
					// modDepObject = mapModuleDefinitionToExportDepObject(sourceFile, null, exportedProp, inputFiles);
	
					modDepObject.exportedElement.objectProperties = exportedProp.objectProperties.map(objectProp => {
	
						return {
	
							propertyName : objectProp.propertyName,
							propertyDefinitionNode : objectProp.propertyDefinitionNode,
							isExported : objectProp.isExported,
							objectPropertyUsages : objectProp.objectPropertyUsages.map (objectPropRef => objectPropRef.value)
						};
					});
	
					modDepObject.exportedElement.elementName = path.basename(sourceFile.fileName, '.js') + '_obj';
					modDepObject.exportedElement.dataType = 'object';
					modDepObject.exportedElement.elementNode = exportedProp.objectExpressionASTNode;
					modDepObject.exportedElement.surrExpressionNode = builtinFunctionInvStmt.value;
					modDepObject.exportedElement.isWrappedInDefine = true;
	
					moduleDepObjs.push(modDepObject);
				});
				
				return;
			}
			
			//(b)
			modDepObject.exportedElement.dataType = 'builtinFunctionInvocation';
			modDepObject.exportedElement.exportedElementName = null;
			modDepObject.exportedElement.elementNode = null;
			modDepObject.exportedElement.isExported = false;
			modDepObject.exportedElement.isCohesive = false;
			modDepObject.exportedElement.returnStatementNode = null;
			modDepObject.exportedElement.objectProperties = [];
			modDepObject.exportedElement.surrExpressionNode = builtinFunctionInvStmt.value;
			modDepObject.exportedElement.isWrappedInDefine = false;
			
			moduleDepObjs.push(modDepObject);

			return;
		}

		let callbackFunction = sourceFile.retrieveDefinedFunctionByNode(invArg);
		if(callbackFunction === null) {

			return;
		}

		modDepObject.exportedElement.dataType = 'callback';
		modDepObject.exportedElement.exportedElementName = callbackFunction.functionName;
		modDepObject.exportedElement.elementNode = callbackFunction.functionNode.value;
		modDepObject.exportedElement.isExported = callbackFunction.isExported;
		modDepObject.exportedElement.isCohesive = callbackFunction.isConstructor;
		modDepObject.exportedElement.returnStatementNode = callbackFunction.returnStatementNode !== null ? 
											callbackFunction.returnStatementNode.value : 
											null;

		//callback function is executed after the builtin function invocation (no properties)
		modDepObject.exportedElement.objectProperties = [];

		modDepObject.exportedElement.surrExpressionNode = builtinFunctionInvStmt.value;
		modDepObject.exportedElement.isWrappedInDefine = (calleeName === 'define' ? true : false);
		
		moduleDepObjs.push(modDepObject);
	});

	return moduleDepObjs;
}

/**
 * Updates a module with its export dependencies, w.r.t features that
 * are not used locally in the system. Applies to library projects.
 * @param {*} inputFile the module
 * @param {*} inputFiles the input file hashmap
 */
function updateLibraryModuleExportDependencies(inputFile, inputFiles) {

	//in libraries, all exported features of inputFile
	//are exported regardless of their use
	//thus, inputFile acts as the system's entry file
	let expDeps = retrieveExportDependenciesOfEntryFile(inputFile, inputFiles, true);

	//add export dependencies of entry file only in the case they do not already exist
	//(they're included in the module's incoming module dependences)
	expDeps = expDeps.filter(exportDependencyObject => {

		if(inputFile.moduleDependencyList.some(exportDep => {

			// console.log(exportDep);
			return exportDep.type === 'export' && 
			exportDep.exportedElement.elementName === exportDependencyObject.exportedElement.elementName &&
			   
			exportDep.exportedElement.elementNode === exportDependencyObject.exportedElement.elementNode
		}) === false) {

			//add exportDependency object only in the case it is not already added
			return true;
		}

		return false;
	});

	inputFile.updateModuleDependencyList(expDeps);
}

/**
 * Retrieves the export dependencies of inputFile.
 * In the case that is the project's entryfile, its definitions are exported regardless of whether it is imported.
 * @param {*} inputFile the project's entryfile
 * @param {*} inputFiles the input file hashmap
 * @param {*} isLibrary is the analyzed system a library? useful for specifying the transformation type
 */
function retrieveExportDependenciesOfEntryFile(inputFile, inputFiles, isLibrary = false) {

	// console.log(inputFile.fileName);
	let exportDependencies = [];

	let definedFunctions = inputFile.definedFunctions;
	let explicitGlobals = inputFile.explicitGlobals;
	let exportedProperties = inputFile.exportedProperties;

	definedFunctions = definedFunctions.filter(df => {

		return df.isExported === true;
	});

	definedFunctions.forEach(definedFunction => {

		let exportDependencyObject = isLibrary === true ?
									mapLibraryModuleDefinitionToExportDepObject(inputFile, null, definedFunction, inputFiles, true) :
									mapModuleDefinitionToExportDepObject(inputFile, null, definedFunction, inputFiles, isLibrary);
		exportDependencies.push(exportDependencyObject);
	});

	explicitGlobals = explicitGlobals.filter(eg => {

		return eg.isExported === true;
	});

	explicitGlobals.forEach(explicitGlobal => {

		let exportDependencyObject = isLibrary === true ? 
									mapLibraryModuleDefinitionToExportDepObject(inputFile, null, explicitGlobal, inputFiles, true) :
									mapModuleDefinitionToExportDepObject(inputFile, null, explicitGlobal, inputFiles, isLibrary);
		exportDependencies.push(exportDependencyObject);
	});

	exportedProperties.forEach(exportedProperty => {
	
		//create an object representing the modification that needs to be performed for the exported object
		//in the properties that need to be exported, include only the properties used (create object for the importing module)
		let exportDependencyObject = isLibrary === true ? 
									mapLibraryModuleDefinitionToExportDepObject(inputFile, null, exportedProperty, inputFiles, true) :
									mapModuleDefinitionToExportDepObject(inputFile, null, exportedProperty, inputFiles, isLibrary);
		exportDependencies.push(exportDependencyObject);
	});

	return exportDependencies;
}

/**
 * Maps a module definition pointed by importedElement to a module dependency object
 * based on (a) the module system of inputFile and (b) its type.
 * @param {*} inputFile the module defining the feature specified in importedElement
 * @param {*} importedElement a definition imported and referenced in inputFile
 * @param {*} moduleDefinition the module definition pointed by importedElement (variable, function, exported property)
 * @param {*} isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
 */
function mapModuleDefinitionToExportDepObject(inputFile, importedElement, moduleDefinition, inputFiles, isLibrary = false) {

	let accessedProperties = importedElement !== null ? importedElement.accessedProperties : [];
	let namespaceUses = importedElement !== null ? importedElement.elementUsages : [];
	let importedElementNodes = importedElement !== null ? importedElement.importedElementNodes : [];

	//if importedElement is accessed dynamically at least once in the system
	//(all its properties should be exported)
	let isNamespaceAccessedDynamically = importedElement !== null ? importedElement.isAccessedDynamically : false;

	// console.log(importedElement)
	let isNamespaceModified = (importedElement instanceof ImportedElement.ImportedElement || 
								importedElement instanceof ImportedNamespace.ImportedNamespace) &&
								importedElement !== null ? importedElement.updateIsModifiedThroughoutSystem() : false;

	let exportDependencyObject = {};

	//moduleDefinition is an implied global (applies regardless of the module framework)
	if(moduleDefinition instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {

		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement = {};
		exportDependencyObject.exportedElement.dataType = 'implied';
		exportDependencyObject.exportedElement.variableName = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.creationStatement = moduleDefinition.creationStatement.value;
		exportDependencyObject.exportedElement.modificationFunctions = [];

		return exportDependencyObject;
	}

	//separate logic for CommonJS: retrieve chains of import-export-import... that apply on CommonJS
	//TODO: the retrieval of import-export-import chains should be decoupled from the construction of export codemod scripts
	//an imported namespace/element might be imported and re-exported in < n modules,
	//where n is the number of the modules that import that namespace/element-
	//coupling between functionalities leads to the generation of export scripts
	//before determining that a namespace/element is imported and re-exported,
	//thus not all modules share the same info
	//(due to the creation of export scripts with primitive types, no connection between export script object and the actual moduleDefinition)

	//update: added logic for transforming library CJS systems
	if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

		//moduleDefinition type: FunctionDeclaration | Variable | ExportedProperty
		// console.log(inputFile.fileName);
		// console.log(moduleDefinition)

		let exportedObjectDefinitions = inputFile.astRootCollection.find(jscodeshift.AssignmentExpression).filter(node => {

			return (node.value.left.type === 'MemberExpression' && 
				   (node.value.left.object.type === 'Identifier' && node.value.left.object.name === 'module' &&
				   node.value.left.property.type === 'Identifier' && node.value.left.property.name === 'exports')) ||
				   node.value.left.type === 'Identifier' && node.value.left.name === 'exports';
		});

		if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

			//what if importedElement represents a declaration that is imported, re-exported and re-imported?
			//the actual imported namespace needs to be retrieved in the module that imports the re-imported namespace
			//applies to non-library systems
			//processed before creating export script objects

			// if(inputFile.isEntryFile === true) {

			// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
			// }
			

			//function references comprise the moduleDefinition references that are
			//not within a member expression (member expressions: moduleDefinition property references)
			let functionReferences = namespaceUses.filter(namespaceUse => {

				return namespaceUse.parentPath.value.type !== 'MemberExpression';
			});
	
			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.dataType = 'function';
			exportDependencyObject.exportedElement.functionName = `mod_${moduleDefinition.functionName}`;
			exportDependencyObject.exportedElement.elementAlias = moduleDefinition.functionName !== 'anonymus' ?
																	moduleDefinition.functionName :
																	path.basename(inputFile.fileName, '.js').replace(/[^\w\s-]/gi, '');
			exportDependencyObject.exportedElement.functionNode = moduleDefinition.functionNode.value;
			exportDependencyObject.exportedElement.exportedFunctionNode = moduleDefinition.exportedFunctionNode.value;

			exportDependencyObject.exportedElement.modificationFunctions = [];

			//the alias of the exported object is determined within the definition module limits
			//(case: importing the same declaration under multiple aliases)
			exportDependencyObject.exportedElement.exportAlias = moduleDefinition.functionName === 'anonymus' ? 
																	path.basename(inputFile.fileName, '.js').replace(/[^\w\s-]/gi, '') : 
																	moduleDefinition.functionName;

			exportDependencyObject.exportedElement.importAlias = exportDependencyObject.exportedElement.exportAlias;
			exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isConstructor;
			exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
			exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
			exportDependencyObject.exportedElement.elementUsages = functionReferences.map(functionRef => functionRef.value);
			
			// FunctionProperty
			exportDependencyObject.exportedElement.functionProperties = moduleDefinition.functionProperties.map(functionProperty => {

				return functionProperty.mapFunctionPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;
			
			// FunctionProperty
			exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				return prototypeProperty.mapFunctionPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = (exportedObjectDefinitions.length > 0);
			exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
			exportDependencyObject.exportedElement.isNested = importedElement !== null ? 
																importedElement.isNested : 
																false;

			exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;

			// console.log(exportDependencyObject);
			return exportDependencyObject;
		}

		if(moduleDefinition instanceof Variable.Variable === true) {

			// console.log(moduleDefinition);

			//what if importedElement represents an object declaration that is imported, re-exported and re-imported?
			//the actual imported namespace needs to be retrieved in the module that imports the re-imported namespace
			//applies to non-library systems
			//processed before creating export script objects

			// if(inputFile.isEntryFile === true) {

			// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
			// }
	
			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.dataType = 'variable';
			exportDependencyObject.exportedElement.variableName = `mod_${moduleDefinition.variableName}`;
			exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
			exportDependencyObject.exportedElement.initializationValueNode = moduleDefinition.initializationValueNode;
			exportDependencyObject.exportedElement.variableDeclarationNode = moduleDefinition.variableDeclarationNode.value;
			exportDependencyObject.exportedElement.exportedVariableNode = moduleDefinition.exportedVariableNode.value;
			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = moduleDefinition.isInitializedWithObjectExpression;
			exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
			exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isInitializedWithFunctionConstructor;
			exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
			
			// ObjectProperty
			exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProperty => {

				return objectProperty.mapObjectPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

			// ObjectProperty
			exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				return prototypeProperty.mapObjectPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.modificationFunctions = [];
			exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
			exportDependencyObject.exportedElement.importAlias = exportDependencyObject.exportedElement.exportAlias;
			exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = (exportedObjectDefinitions.length > 0);
			exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;
			exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
			exportDependencyObject.exportedElement.isNested = importedElement !== null ? 
																importedElement.isNested :
																false;

			return exportDependencyObject;
		}

		//moduleDefinition is an exported property
		// console.log(inputFile.fileName);
		// console.log(moduleDefinition);
		// console.log(importedElement.moduleDefinitions);

		//importedElement might be null (in case of an entry file,
		//where I assume that all module features are imported from the client project's modules,
		//but I don't have any imported elements mapped to these module features-
		//I assume that all properties are exported)
		let propertyCount = importedElement !== null ? 
								importedElement.moduleDefinitions.exportedProperties.length :
								inputFile.exportedProperties.length;

		//the importAlias for an object of an entry file is based on the file's name
		let importAlias = path.basename(inputFile.fileName, '.js');
		// importAlias = importAlias.replace(/.\//g, '');
		// importAlias = importAlias.replace(/-/g, '');
		importAlias = `${importAlias.replace(/[^\w\s]/gi, '')}js`;

		// let propertyCount = importedElement !== null ? 
		// 						importedElement.moduleDefinitions.exportedProperties.length :
		// 						0;

		//is importedElement used outside member expressions?
		//all its exported properties should be imported
		let importedElementRefs = importedElement !== null ? 
									importedElement.elementUsages.filter(elementRef => {

										// let mbExpImports = importedElementNodes.filter(impElNode => {

										// 	return impElNode.parentPath.value.type === 'MemberExpression';
										// });
										// if(mbExpImports.length > 0) {

										// 	return false;
										// }

										//refactor to use find() instead of filter()
										//no need to search all list elements
										let mbExpImport = importedElementNodes.find(impElNode => {

											return impElNode.parentPath.value.type === 'MemberExpression';
										});

										if(mbExpImport !== undefined) {

											return false;
										}

										return elementRef.parentPath.value.type !== 'MemberExpression';
									}) :
									[];

		//map property to a module dependency object only in the case it is referenced in other modules
		// console.log(importedElement);
		// console.log(moduleDefinition);

		//what if module definition is imported, re-exported and re-imported?
		//case: stage.js, lib\index.js
		//moduleDefinition needs to be retrieved in the module that imports the re-imported definition
		//applies to non-library systems
		//processed before creating export script objects

		// if(isLibrary === false) {

		// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
		// }

		//is property introduced through a direct access (require() succeeded by a member expression?)
		let isPropertyImportedThroughAMemberExpression = importedElementNodes.some(impElNode => {

			// console.log(impElNode.parentPath.value.type);
			// console.log(impElNode.value.loc);
			return impElNode.parentPath.value.type === 'MemberExpression';
		});

		// console.log(isPropertyImportedThroughAMemberExpression);
		// console.log(moduleDefinition.isImportedAndReexported)

		//moduleDefinition is 
		//(a) imported through a member expression (property direct access) or 
		// assigned the result an import and re-exported
		//(b) exported from its definition module along with other properties
		//(c) a property that is bound to the module object
		let expElName = (moduleDefinition.exportedPropertyName === null ||
						(isPropertyImportedThroughAMemberExpression === true &&
						moduleDefinition.isImportedAndReexported === true) &&
						propertyCount > 1 &&
						moduleDefinition.propertyExportedThroughModuleExports === false)?
						importAlias :
						`mod_${moduleDefinition.exportedPropertyName}`;

		// console.log('def: ' + inputFile.fileName);
		// console.log(isPropertyImportedThroughAMemberExpression === true &&
		// 	moduleDefinition.isImportedAndReexported === true)
		// console.log(propertyCount);
		// console.log(expElName)

		

		let propertyReferences = importedElement !== null ? 
									importedElement.elementUsages.filter(elementRef => {

									// console.log(elementRef);

									//property is the object returned from require()
									//keep all references
									if(moduleDefinition.propertyExportedThroughModuleExports === true) {

										return true;
									}

									//property imported through the object returned from require() (member expression)
									//keep all references
									let propertyImportNodes = importedElementNodes.filter(impElNode => {

										if(impElNode.parentPath.value.type !== 'MemberExpression') {

											return false;
										}
											
										let mbProp = impElNode.parentPath.value.property;
										if(mbProp.type === 'Identifier' && mbProp.name === moduleDefinition.exportedPropertyName) {

											return true;
										}

										return false;
									});

									if(propertyImportNodes.length > 0) {

										return true;
									}

									return elementRef.parentPath.value.type === 'MemberExpression' &&
											elementRef.parentPath.value.property.type === 'Identifier' &&
											elementRef.parentPath.value.property.name === moduleDefinition.exportedPropertyName;
									}) : 
									[];

		// console.log(inputFile.fileName);
		// console.log(moduleDefinition.exportedPropertyName + ' ' + propertyReferences.length);
		// console.log(importedElementRefs.length)

		let impElDef = importedElement !== null ? importedElement.importedElementNodes.find(impElNode => {

			let closestAssignments = jscodeshift(impElNode).closest(jscodeshift.AssignmentExpression);

			if(closestAssignments.length === 0) {

				return false;
			}

			let closestAssignment = closestAssignments.at(0).get();
			if(closestAssignment.value.left.type === 'MemberExpression') {

				return true;
			}

			return false;
			
		}) : undefined;

		//create an object representing the modification that needs to be performed for moduleDefinition in the case that (at least one of the following apply):
		//(f - checked in the 1st condition) the analyzed system is a library (module features are exported/imported regardless of their usage)
		//(a) importedElement used outside member expressions (all exported properties are imported under their definition's module exported object, regardless of their references)
		//(b) moduleDefinition is used at least once
		//(c) importedElement is imported in nested scope (similar to (b))
		//(d) importedElement is imported and re-exported from module (similar to (b))
		//(update: e) importedElement is assigned to a property
		//NOTICE: both encapsulation and ISP reduction are targeted (thus, export a definition in the case it is actually used)
		if(
			inputFile.isEntryFile === true || importedElementRefs.length > 0 || 
		   propertyReferences.length > 0 || 
		   (importedElement !== null && (importedElement.isNested === true || 
		   importedElement.boundToExportedDefinition === true)) ||
		   moduleDefinition.isImportedAndReexported === true ||
		   impElDef != undefined) {

				exportDependencyObject.type = "export";
				exportDependencyObject.exportedElement = {};
				exportDependencyObject.exportedElement.dataType = 'property';
				// exportDependencyObject.exportedElement.exportedElementName = `mod_${moduleDefinition.exportedPropertyName}`;

				exportDependencyObject.exportedElement.exportedElementName = expElName;
				exportDependencyObject.exportedElement.elementAlias = moduleDefinition.exportedPropertyName;
				exportDependencyObject.exportedElement.elementNode = moduleDefinition.exportStatementASTNode.value != null ? 
																		moduleDefinition.exportStatementASTNode.value : 
																		moduleDefinition.exportStatementASTNode;

				exportDependencyObject.exportedElement.initializationNode = moduleDefinition.initializationValueASTNode;
				
				// ObjectProperty
				exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProperty => {

					return objectProperty.mapObjectPropertyToRefJSONObj(inputFile);
				});

				exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

				//added for name compliance
				exportDependencyObject.exportedElement.functionProperties = exportDependencyObject.exportedElement.objectProperties;

				exportDependencyObject.exportedElement.referencedProperties = moduleDefinition.retrieveAccessedObjectProperties();
				exportDependencyObject.exportedElement.propertyReferences = moduleDefinition.exportedPropertyReferences;
				exportDependencyObject.exportedElement.doesExportedObjectHandleThis = moduleDefinition.doesExportedPropertyHandleThis;
				// exportDependencyObject.exportedElement.importAlias = importedElement !== null ? importedElement.elementName : null;
				
				exportDependencyObject.exportedElement.importAlias = importedElement !== null ? importedElement.elementName : importAlias;
				exportDependencyObject.exportedElement.exportAlias = moduleDefinition.exportedPropertyName !== null ?
																	moduleDefinition.exportedPropertyName : expElName;
				exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
				exportDependencyObject.exportedElement.isFunctionConstructor = (moduleDefinition.isCohesive === true ? true : (importedElement !== null ? importedElement.isCohesive : false));
				exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
				exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
				exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;
				exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = moduleDefinition.propertyExportedThroughModuleExports;
				exportDependencyObject.exportedElement.numberOfPropertiesExportedFromModule = propertyCount;
				exportDependencyObject.exportedElement.isNested = importedElement !== null ? importedElement.isNested : false;
				exportDependencyObject.exportedElement.modificationFunctions = [];

				//update: also keep information of the cohesion of moduleDefinition, if it is initialized with the result of require
				if(moduleDefinition.isExportedPropertyInitializedWithInvocationOfRequire() === true) {

					let importDefinition = inputFile.retrieveImportedDefinitionByImportNode(moduleDefinition.exportStatementASTNode.right);

					// console.log(inputFile.fileName);
					// console.log(importDefinition);

					if(importDefinition === null) {

						//no imported namespace mapped to the require() invocation assigned to is found 
						//(syntax: module.exports = <require_invocation> || exports = <require_invocation>)
						exportDependencyObject.exportedElement.isFunctionConstructor = false;
					}
					else {

						exportDependencyObject.exportedElement.isFunctionConstructor = importDefinition.isCohesive;
					}

				}

				// console.log(exportDependencyObject);

				return exportDependencyObject;
		}

		return null;
	}
	
	//moduleDefinition type in AMD modules: Variable | FunctionDeclaration | ObjectLiteral
	//moduleDefinition type in non-modular ES5 modules: Variable | FunctionDeclaration
	if(moduleDefinition instanceof Variable.Variable === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'variable';

		let initializationFunction = inputFile.retrieveDefinedFunctionByNode(moduleDefinition.initializationValueNode);
		if(initializationFunction === null || initializationFunction.isConstructor === false) {

			//variable not initialized with a function or initialized with a function that is not a constructor
			accessedProperties.forEach(accessedProperty => {
	
				// console.log(accessedProperty);
				//access object property by its name
				let objectProperty = moduleDefinition.retrieveObjectPropertyByName(accessedProperty.propertyName);
	
				if(objectProperty == null) {
	
					//object property not found - do not proceed
					return;
				}
	
				//object property that is used is found, mark it as exported
				objectProperty.updateIsExported(true);
			});

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = true;
		}

		// console.log(moduleDefinition);
		exportDependencyObject.exportedElement.elementName = `mod_${moduleDefinition.variableName}`;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.variableDeclarationNode.value;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);
		exportDependencyObject.exportedElement.isFunctionConstructor = initializationFunction === null ? false : initializationFunction.isConstructor;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		exportDependencyObject.exportedElement.modificationFunctions = [];
		
		// ObjectProperty
		exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProp => {

			return objectProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		// ObjectProperty
		exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProp => {

			return prototypeProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		if(moduleDefinition.objectProperties.length === 0) {

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = false;
		}

		return exportDependencyObject;
	}

	if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'function';

		if(moduleDefinition.isConstructor === false) {

			//definedFunction is exported (pointed by importedNamespace) and its not a constructor
			//(not used for object instantiation)
			accessedProperties.forEach(accessedProperty => {

				let functionProperty = moduleDefinition.retrieveFunctionPropertyByName(accessedProperty.propertyName);
				// console.log(functionProperty);
				if(functionProperty == null) {

					//object property not found - do not proceed
					return;
				}

				functionProperty.updateIsExported(true);

				exportedElementNames.push(moduleDefinition.functionName);
			});

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = true;
		}

		exportDependencyObject.exportedElement.elementName = `mod_${moduleDefinition.functionName}`;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.functionName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.functionName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.functionNode.value;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);
		exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isConstructor;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		
		// FunctionProperty
		exportDependencyObject.exportedElement.functionProperties = moduleDefinition.functionProperties.map(functionProp => {

			return functionProp.mapFunctionPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		// FunctionProperty
		exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProp => {

			return prototypeProp.mapFunctionPropertyToRefJSONObj(inputFile);
		});

		if(moduleDefinition.functionProperties.length === 0) {

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = false;
		}

		return exportDependencyObject;
	}

	//AMD module returns an object literal 
	//(either via the parameter of define() or returned from the callback)
	if(moduleDefinition instanceof ObjectLiteral.ObjectLiteral === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'object';
		// exportDependencyObject.exportedElement.exportedElementName = path.basename(inputFile.fileName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '') + '_obj';
		exportDependencyObject.exportedElement.exportedElementName = `mod_${path.basename(inputFile.fileName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '')}`;
		exportDependencyObject.exportedElement.elementAlias = importedElement != null ? 
																importedElement.elementName :
																exportDependencyObject.exportedElement.exportedElementName;
		exportDependencyObject.exportedElement.exportAlias = exportDependencyObject.exportedElement.elementAlias;
		// exportDependencyObject.exportedElement.elementAlias = exportDependencyObject.exportedElement.exportedElementName;
		// exportDependencyObject.exportedElement.exportAlias = exportDependencyObject.exportedElement.exportedElementName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.objectExpressionASTNode;
		exportDependencyObject.exportedElement.isExported = moduleDefinition.isExported;
		exportDependencyObject.exportedElement.isCohesive = moduleDefinition.isCohesive;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);

		// ObjectProperty
		exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties == null ? 
																	[] :
																	moduleDefinition.objectProperties.map(objectProp => {

			return objectProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		return exportDependencyObject;
	}
	
	return null;
}

/**
 * Maps a module definition pointed by importedElement to a module dependency object
 * based on (a) the module system of inputFile and (b) its type.
 * Applies to libraries.
 * @param {*} inputFile the module defining the feature specified in importedElement
 * @param {*} importedElement a definition imported and referenced in inputFile
 * @param {*} moduleDefinition the module definition pointed by importedElement (variable, function, exported property)
 * @param {*} isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
 */
 function mapLibraryModuleDefinitionToExportDepObject(inputFile, importedElement, moduleDefinition, inputFiles, isLibrary = false) {

	let accessedProperties = importedElement !== null ? importedElement.accessedProperties : [];
	let namespaceUses = importedElement !== null ? importedElement.elementUsages : [];
	let importedElementNodes = importedElement !== null ? importedElement.importedElementNodes : [];

	//if importedElement is accessed dynamically at least once in the system
	//(all its properties should be exported)
	let isNamespaceAccessedDynamically = importedElement !== null ? importedElement.isAccessedDynamically : false;

	// console.log(importedElement)
	let isNamespaceModified = (importedElement instanceof ImportedElement.ImportedElement || 
								importedElement instanceof ImportedNamespace.ImportedNamespace) &&
								importedElement !== null ? importedElement.updateIsModifiedThroughoutSystem() : false;

	let exportDependencyObject = {};

	//moduleDefinition is an implied global (applies regardless of the module framework)
	if(moduleDefinition instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {

		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement = {};
		exportDependencyObject.exportedElement.dataType = 'implied';
		exportDependencyObject.exportedElement.variableName = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.creationStatement = moduleDefinition.creationStatement.value;
		exportDependencyObject.exportedElement.modificationFunctions = [];

		return exportDependencyObject;
	}

	//separate logic for CommonJS: retrieve chains of import-export-import... that apply on CommonJS
	//TODO: the retrieval of import-export-import chains should be decoupled from the construction of export codemod scripts
	//an imported namespace/element might be imported and re-exported in < n modules,
	//where n is the number of the modules that import that namespace/element-
	//coupling between functionalities leads to the generation of export scripts
	//before determining that a namespace/element is imported and re-exported,
	//thus not all modules share the same info
	//(due to the creation of export scripts with primitive types, no connection between export script object and the actual moduleDefinition)

	//update: added logic for transforming library CJS systems
	if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

		//moduleDefinition type: FunctionDeclaration | Variable | ExportedProperty
		// console.log(inputFile.fileName);
		// console.log(moduleDefinition)

		let exportedObjectDefinitions = inputFile.astRootCollection.find(jscodeshift.AssignmentExpression).filter(node => {

			return (node.value.left.type === 'MemberExpression' && 
				   (node.value.left.object.type === 'Identifier' && node.value.left.object.name === 'module' &&
				   node.value.left.property.type === 'Identifier' && node.value.left.property.name === 'exports')) ||
				   node.value.left.type === 'Identifier' && node.value.left.name === 'exports';
		});

		if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

			//what if importedElement represents a declaration that is imported, re-exported and re-imported?
			//the actual imported namespace needs to be retrieved in the module that imports the re-imported namespace
			//applies to non-library systems
			//processed before creating export script objects

			// if(inputFile.isEntryFile === true) {

			// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
			// }
			

			//function references comprise the moduleDefinition references that are
			//not within a member expression (member expressions: moduleDefinition property references)
			let functionReferences = namespaceUses.filter(namespaceUse => {

				return namespaceUse.parentPath.value.type !== 'MemberExpression';
			});
	
			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.dataType = 'function';
			exportDependencyObject.exportedElement.functionName = `mod_${moduleDefinition.functionName}`;
			exportDependencyObject.exportedElement.elementAlias = moduleDefinition.functionName !== 'anonymus' ?
																	moduleDefinition.functionName :
																	path.basename(inputFile.fileName, '.js').replace(/[^\w\s-]/gi, '');
			exportDependencyObject.exportedElement.functionNode = moduleDefinition.functionNode.value;
			exportDependencyObject.exportedElement.exportedFunctionNode = moduleDefinition.exportedFunctionNode.value;

			exportDependencyObject.exportedElement.modificationFunctions = [];

			//the alias of the exported object is determined within the definition module limits
			//(case: importing the same declaration under multiple aliases)
			exportDependencyObject.exportedElement.exportAlias = moduleDefinition.functionName === 'anonymus' ? 
																	path.basename(inputFile.fileName, '.js').replace(/[^\w\s-]/gi, '') : 
																	moduleDefinition.functionName;

			exportDependencyObject.exportedElement.importAlias = exportDependencyObject.exportedElement.exportAlias;
			exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isConstructor;
			exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
			exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
			exportDependencyObject.exportedElement.elementUsages = functionReferences.map(functionRef => functionRef.value);
			
			// FunctionProperty
			exportDependencyObject.exportedElement.functionProperties = moduleDefinition.functionProperties.map(functionProperty => {

				return functionProperty.mapFunctionPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;
			
			// FunctionProperty
			exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				return prototypeProperty.mapFunctionPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = (exportedObjectDefinitions.length > 0);
			exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
			exportDependencyObject.exportedElement.isNested = importedElement !== null ? 
																importedElement.isNested : 
																false;

			exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;

			// console.log(exportDependencyObject);
			return exportDependencyObject;
		}

		if(moduleDefinition instanceof Variable.Variable === true) {

			// console.log(moduleDefinition);

			//what if importedElement represents an object declaration that is imported, re-exported and re-imported?
			//the actual imported namespace needs to be retrieved in the module that imports the re-imported namespace
			//applies to non-library systems
			//processed before creating export script objects

			// if(inputFile.isEntryFile === true) {

			// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
			// }
	
			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.dataType = 'variable';
			exportDependencyObject.exportedElement.variableName = `mod_${moduleDefinition.variableName}`;
			exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
			exportDependencyObject.exportedElement.initializationValueNode = moduleDefinition.initializationValueNode;
			exportDependencyObject.exportedElement.variableDeclarationNode = moduleDefinition.variableDeclarationNode.value;
			exportDependencyObject.exportedElement.exportedVariableNode = moduleDefinition.exportedVariableNode.value;
			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = moduleDefinition.isInitializedWithObjectExpression;
			exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
			exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isInitializedWithFunctionConstructor;
			exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
			
			// ObjectProperty
			exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProperty => {

				return objectProperty.mapObjectPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

			// ObjectProperty
			exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				return prototypeProperty.mapObjectPropertyToRefJSONObj(inputFile);
			});

			exportDependencyObject.exportedElement.modificationFunctions = [];
			exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
			exportDependencyObject.exportedElement.importAlias = exportDependencyObject.exportedElement.exportAlias;
			exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = (exportedObjectDefinitions.length > 0);
			exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;
			exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
			exportDependencyObject.exportedElement.isNested = importedElement !== null ? 
																importedElement.isNested :
																false;

			return exportDependencyObject;
		}

		//moduleDefinition is an exported property
		// console.log(inputFile.fileName);
		// console.log(moduleDefinition);
		// console.log(importedElement.moduleDefinitions);

		//importedElement might be null (in case of an entry file,
		//where I assume that all module features are imported from the client project's modules,
		//but I don't have any imported elements mapped to these module features-
		//I assume that all properties are exported)
		let propertyCount = importedElement !== null ? 
								importedElement.moduleDefinitions.exportedProperties.length :
								inputFile.exportedProperties.length;

		//the importAlias for an object of an entry file is based on the file's name
		let importAlias = path.basename(inputFile.fileName, '.js');
		// importAlias = importAlias.replace(/.\//g, '');
		// importAlias = importAlias.replace(/-/g, '');
		importAlias = `${importAlias.replace(/[^\w\s]/gi, '')}js`;

		// let propertyCount = importedElement !== null ? 
		// 						importedElement.moduleDefinitions.exportedProperties.length :
		// 						0;

		//is importedElement used outside member expressions?
		//all its exported properties should be imported
		let importedElementRefs = importedElement !== null ? 
									importedElement.elementUsages.filter(elementRef => {

										// let mbExpImports = importedElementNodes.filter(impElNode => {

										// 	return impElNode.parentPath.value.type === 'MemberExpression';
										// });
										// if(mbExpImports.length > 0) {

										// 	return false;
										// }

										//refactor to use find() instead of filter()
										//no need to search all list elements
										let mbExpImport = importedElementNodes.find(impElNode => {

											return impElNode.parentPath.value.type === 'MemberExpression';
										});

										if(mbExpImport !== undefined) {

											return false;
										}

										return elementRef.parentPath.value.type !== 'MemberExpression';
									}) :
									[];

		//map property to a module dependency object only in the case it is referenced in other modules
		// console.log(importedElement);
		// console.log(moduleDefinition);

		//what if module definition is imported, re-exported and re-imported?
		//case: stage.js, lib\index.js
		//moduleDefinition needs to be retrieved in the module that imports the re-imported definition
		//applies to non-library systems
		//processed before creating export script objects

		// if(isLibrary === false) {

		// 	updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
		// }

		//is property introduced through a direct access (require() succeeded by a member expression?)
		let isPropertyImportedThroughAMemberExpression = importedElementNodes.some(impElNode => {

			// console.log(impElNode.parentPath.value.type);
			// console.log(impElNode.value.loc);
			return impElNode.parentPath.value.type === 'MemberExpression';
		});

		// console.log(isPropertyImportedThroughAMemberExpression);
		// console.log(moduleDefinition.isImportedAndReexported)

		//moduleDefinition is 
		//(a) imported through a member expression (property direct access) or 
		// assigned the result an import and re-exported
		//(b) exported from its definition module along with other properties
		//(c) a property that is bound to the module object
		let expElName = (moduleDefinition.exportedPropertyName === null ||
						(isPropertyImportedThroughAMemberExpression === true &&
						moduleDefinition.isImportedAndReexported === true) &&
						propertyCount > 1 &&
						moduleDefinition.propertyExportedThroughModuleExports === false)?
						importAlias :
						`mod_${moduleDefinition.exportedPropertyName}`;

		// console.log('def: ' + inputFile.fileName);
		// console.log(isPropertyImportedThroughAMemberExpression === true &&
		// 	moduleDefinition.isImportedAndReexported === true)
		// console.log(propertyCount);
		// console.log(expElName)

		

		let propertyReferences = importedElement !== null ? 
									importedElement.elementUsages.filter(elementRef => {

									// console.log(elementRef);

									//property is the object returned from require()
									//keep all references
									if(moduleDefinition.propertyExportedThroughModuleExports === true) {

										return true;
									}

									//property imported through the object returned from require() (member expression)
									//keep all references
									let propertyImportNodes = importedElementNodes.filter(impElNode => {

										if(impElNode.parentPath.value.type !== 'MemberExpression') {

											return false;
										}
											
										let mbProp = impElNode.parentPath.value.property;
										if(mbProp.type === 'Identifier' && mbProp.name === moduleDefinition.exportedPropertyName) {

											return true;
										}

										return false;
									});

									if(propertyImportNodes.length > 0) {

										return true;
									}

									return elementRef.parentPath.value.type === 'MemberExpression' &&
											elementRef.parentPath.value.property.type === 'Identifier' &&
											elementRef.parentPath.value.property.name === moduleDefinition.exportedPropertyName;
									}) : 
									[];

		// console.log(inputFile.fileName);
		// console.log(moduleDefinition.exportedPropertyName + ' ' + propertyReferences.length);
		// console.log(importedElementRefs.length)

		let impElDef = importedElement !== null ? importedElement.importedElementNodes.find(impElNode => {

			let closestAssignments = jscodeshift(impElNode).closest(jscodeshift.AssignmentExpression);

			if(closestAssignments.length === 0) {

				return false;
			}

			let closestAssignment = closestAssignments.at(0).get();
			if(closestAssignment.value.left.type === 'MemberExpression') {

				return true;
			}

			return false;
			
		}) : undefined;

		//create an object representing the modification that needs to be performed for moduleDefinition in the case that (at least one of the following apply):
		//(f - checked in the 1st condition) the analyzed system is a library (module features are exported/imported regardless of their usage)
		//(a) importedElement used outside member expressions (all exported properties are imported under their definition's module exported object, regardless of their references)
		//(b) moduleDefinition is used at least once
		//(c) importedElement is imported in nested scope (similar to (b))
		//(d) importedElement is imported and re-exported from module (similar to (b))
		//(update: e) importedElement is assigned to a property
		//NOTICE: both encapsulation and ISP reduction are targeted (thus, export a definition in the case it is actually used)
		if( isLibrary === true ||
			inputFile.isEntryFile === true || importedElementRefs.length > 0 || 
		   propertyReferences.length > 0 || 
		   (importedElement !== null && (importedElement.isNested === true || 
		   importedElement.boundToExportedDefinition === true)) ||
		   moduleDefinition.isImportedAndReexported === true ||
		   impElDef != undefined) {

				exportDependencyObject.type = "export";
				exportDependencyObject.exportedElement = {};
				exportDependencyObject.exportedElement.dataType = 'property';
				// exportDependencyObject.exportedElement.exportedElementName = `mod_${moduleDefinition.exportedPropertyName}`;

				exportDependencyObject.exportedElement.exportedElementName = expElName;
				exportDependencyObject.exportedElement.elementAlias = moduleDefinition.exportedPropertyName;
				exportDependencyObject.exportedElement.elementNode = moduleDefinition.exportStatementASTNode.value != null ? 
																		moduleDefinition.exportStatementASTNode.value : 
																		moduleDefinition.exportStatementASTNode;

				exportDependencyObject.exportedElement.initializationNode = moduleDefinition.initializationValueASTNode;
				
				// ObjectProperty
				exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProperty => {

					return objectProperty.mapObjectPropertyToRefJSONObj(inputFile);
				});

				exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

				//added for name compliance
				exportDependencyObject.exportedElement.functionProperties = exportDependencyObject.exportedElement.objectProperties;

				exportDependencyObject.exportedElement.referencedProperties = moduleDefinition.retrieveAccessedObjectProperties();
				exportDependencyObject.exportedElement.propertyReferences = moduleDefinition.exportedPropertyReferences;
				exportDependencyObject.exportedElement.doesExportedObjectHandleThis = moduleDefinition.doesExportedPropertyHandleThis;
				// exportDependencyObject.exportedElement.importAlias = importedElement !== null ? importedElement.elementName : null;
				
				exportDependencyObject.exportedElement.importAlias = importedElement !== null ? importedElement.elementName : importAlias;
				exportDependencyObject.exportedElement.exportAlias = moduleDefinition.exportedPropertyName !== null ?
																	moduleDefinition.exportedPropertyName : expElName;
				exportDependencyObject.exportedElement.isAccessedDynamically = isNamespaceAccessedDynamically;
				exportDependencyObject.exportedElement.isFunctionConstructor = (moduleDefinition.isCohesive === true ? true : (importedElement !== null ? importedElement.isCohesive : false));
				exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
				exportDependencyObject.exportedElement.includedInModifiedNamespace = isNamespaceModified;
				exportDependencyObject.exportedElement.isImportedAndReexported = moduleDefinition.isImportedAndReexported;
				exportDependencyObject.exportedElement.isExportedObjectDefinedThroughAssignmentToExports = moduleDefinition.propertyExportedThroughModuleExports;
				exportDependencyObject.exportedElement.numberOfPropertiesExportedFromModule = propertyCount;
				exportDependencyObject.exportedElement.isNested = importedElement !== null ? importedElement.isNested : false;
				exportDependencyObject.exportedElement.modificationFunctions = [];

				//update: also keep information of the cohesion of moduleDefinition, if it is initialized with the result of require
				if(moduleDefinition.isExportedPropertyInitializedWithInvocationOfRequire() === true) {

					let importDefinition = inputFile.retrieveImportedDefinitionByImportNode(moduleDefinition.exportStatementASTNode.right);

					// console.log(inputFile.fileName);
					// console.log(importDefinition);

					if(importDefinition === null) {

						//no imported namespace mapped to the require() invocation assigned to is found 
						//(syntax: module.exports = <require_invocation> || exports = <require_invocation>)
						exportDependencyObject.exportedElement.isFunctionConstructor = false;
					}
					else {

						exportDependencyObject.exportedElement.isFunctionConstructor = importDefinition.isCohesive;
					}

				}

				// console.log(exportDependencyObject);

				return exportDependencyObject;
		}

		return null;
	}
	
	//moduleDefinition type in AMD modules: Variable | FunctionDeclaration | ObjectLiteral
	//moduleDefinition type in non-modular ES5 modules: Variable | FunctionDeclaration
	if(moduleDefinition instanceof Variable.Variable === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'variable';

		let initializationFunction = inputFile.retrieveDefinedFunctionByNode(moduleDefinition.initializationValueNode);
		if(initializationFunction === null || initializationFunction.isConstructor === false) {

			//variable not initialized with a function or initialized with a function that is not a constructor
			accessedProperties.forEach(accessedProperty => {
	
				// console.log(accessedProperty);
				//access object property by its name
				let objectProperty = moduleDefinition.retrieveObjectPropertyByName(accessedProperty.propertyName);
	
				if(objectProperty == null) {
	
					//object property not found - do not proceed
					return;
				}
	
				//object property that is used is found, mark it as exported
				objectProperty.updateIsExported(true);
			});

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = true;
		}

		// console.log(moduleDefinition);
		exportDependencyObject.exportedElement.elementName = `mod_${moduleDefinition.variableName}`;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.variableName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.variableDeclarationNode.value;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);
		exportDependencyObject.exportedElement.isFunctionConstructor = initializationFunction === null ? false : initializationFunction.isConstructor;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		exportDependencyObject.exportedElement.modificationFunctions = [];
		
		// ObjectProperty
		exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties.map(objectProp => {

			return objectProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		// ObjectProperty
		exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProp => {

			return prototypeProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		if(moduleDefinition.objectProperties.length === 0) {

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = false;
		}

		return exportDependencyObject;
	}

	if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'function';

		if(moduleDefinition.isConstructor === false) {

			//definedFunction is exported (pointed by importedNamespace) and its not a constructor
			//(not used for object instantiation)
			accessedProperties.forEach(accessedProperty => {

				let functionProperty = moduleDefinition.retrieveFunctionPropertyByName(accessedProperty.propertyName);
				// console.log(functionProperty);
				if(functionProperty == null) {

					//object property not found - do not proceed
					return;
				}

				functionProperty.updateIsExported(true);

				exportedElementNames.push(moduleDefinition.functionName);
			});

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = true;
		}

		exportDependencyObject.exportedElement.elementName = `mod_${moduleDefinition.functionName}`;
		exportDependencyObject.exportedElement.elementAlias = moduleDefinition.functionName;
		exportDependencyObject.exportedElement.exportAlias = moduleDefinition.functionName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.functionNode.value;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);
		exportDependencyObject.exportedElement.isFunctionConstructor = moduleDefinition.isConstructor;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		
		// FunctionProperty
		exportDependencyObject.exportedElement.functionProperties = moduleDefinition.functionProperties.map(functionProp => {

			return functionProp.mapFunctionPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		// FunctionProperty
		exportDependencyObject.exportedElement.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProp => {

			return prototypeProp.mapFunctionPropertyToRefJSONObj(inputFile);
		});

		if(moduleDefinition.functionProperties.length === 0) {

			exportDependencyObject.exportedElement.isInitializedWithObjectExpression = false;
		}

		return exportDependencyObject;
	}

	//AMD module returns an object literal 
	//(either via the parameter of define() or returned from the callback)
	if(moduleDefinition instanceof ObjectLiteral.ObjectLiteral === true) {

		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = 'export';
		exportDependencyObject.exportedElement.dataType = 'object';
		// exportDependencyObject.exportedElement.exportedElementName = path.basename(inputFile.fileName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '') + '_obj';
		exportDependencyObject.exportedElement.exportedElementName = `mod_${path.basename(inputFile.fileName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '')}`;
		exportDependencyObject.exportedElement.elementAlias = importedElement != null ? 
																importedElement.elementName :
																exportDependencyObject.exportedElement.exportedElementName;
		exportDependencyObject.exportedElement.exportAlias = exportDependencyObject.exportedElement.elementAlias;
		// exportDependencyObject.exportedElement.elementAlias = exportDependencyObject.exportedElement.exportedElementName;
		// exportDependencyObject.exportedElement.exportAlias = exportDependencyObject.exportedElement.exportedElementName;
		exportDependencyObject.exportedElement.elementNode = moduleDefinition.objectExpressionASTNode;
		exportDependencyObject.exportedElement.isExported = moduleDefinition.isExported;
		exportDependencyObject.exportedElement.isCohesive = moduleDefinition.isCohesive;
		exportDependencyObject.exportedElement.isObjectReferenced = moduleDefinition.isObjectReferenced;
		exportDependencyObject.exportedElement.returnStatementNode = inputFile.mapExportedDefinitionToReturnStatement(moduleDefinition);

		// ObjectProperty
		exportDependencyObject.exportedElement.objectProperties = moduleDefinition.objectProperties == null ? 
																	[] :
																	moduleDefinition.objectProperties.map(objectProp => {

			return objectProp.mapObjectPropertyToRefJSONObj(inputFile);
		});

		exportDependencyObject.exportedElement.usedBesidesProperties = moduleDefinition.usedBesidesProperties;

		return exportDependencyObject;
	}
	
	return null;
}

/**
 * For each exported variable, function, property introduce an export script
 * in inputFile's module dependency list (used for Namespace import dependencies that access inputFile.)
 * @param {*} inputFile the file defining the features specified in importedNamespace
 * @param importedNamespace the imported module object referencing the exported feature(s)
 * @param inputFiles the input file hashmap
 * @param isLibrary is the analyzed system a library? useful for specifying the transformation type (default value is false)
 */
function addExportDependenciesToModuleDependencyList(inputFile, importedNamespace, inputFiles, isLibrary = false) {

	// console.log('i: ' + inputFile.fileName);
	// console.log(inputFile.moduleFramework);
	// console.log(importedNamespace);

	//importedNamespaces do not apply in non-modular ES5
	if(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

		//this does not apply to non-modular ES5 code
		return;
	}

	//a namespace import might result in importing multiple module definitions
	//case: namespace import brings two functions/variables
	let exportDependencyObjects = [];
	let exportDependencyObject;

	// console.log(importedNamespace.moduleDefinitions);

	let moduleDefinitions = importedNamespace.moduleDefinitions;
	let exportedFunctions = moduleDefinitions.exportedFunctions;
	let exportedVariables = moduleDefinitions.exportedVariables;
	let exportedProperties = moduleDefinitions.exportedProperties;

	//separate logic for CommonJS
	//(retrieving chains of import-export-import-... that apply on CommonJS)
	if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

		//CommonJS module: all variables/functions/object literals are exported
		//exported definedFunctions/explicitGlobals: functions/variables assigned to the export object
		//each importedNamespace is mapped to a set of moduleDefinitions (no need to iterate over inputFile's exported definitions)
		//((i) variables/functions assigned to the definition module's export object, (ii) exported properties (definitions bound to the export object))
		
		//import of external module
		//create an artificial object for its import in the client module
		if(importedNamespace.declaredSource.startsWith('.') === false) {

			let exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElement = {};
			exportDependencyObject.exportedElement.dataType = 'variable';
			exportDependencyObject.exportedElement.variableName = importedNamespace.elementName;
			exportDependencyObject.exportedElement.elementAlias = importedNamespace.elementName;
			exportDependencyObject.exportedElement.exportAlias = importedNamespace.elementName;
			
			exportDependencyObjects.push(exportDependencyObject);
			return exportDependencyObjects;
		}

		exportedFunctions.forEach(definedFunction => {
	
			exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, definedFunction, inputFiles, isLibrary);
			if(exportDependencyObject === null) {

				return;
			}

			inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
	
			// console.log(exportDependencyObject);
			if(exportDependencyObjects.some(exportDep => 
				exportDep.exportedElement.exportedElementName === exportDependencyObject.exportedElement.exportedElementName && 
				exportDep.exportedElement.elementNode === exportDependencyObject.exportedElement.elementNode) === false) {

				//add exportDependency object only in the case it is not already added
				exportDependencyObjects.push(exportDependencyObject);
			}
		});
	
		exportedVariables.forEach(explicitGlobal => {

			// console.log(explicitGlobal.variableName + ' ' + explicitGlobal.isObjectReferenced);
	
			exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, explicitGlobal, inputFiles, isLibrary);
			if(exportDependencyObject === null) {

				return;
			}

			inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
	
			if(exportDependencyObjects.some(exportDep => 
				exportDep.exportedElement.exportedElementName === exportDependencyObject.exportedElement.exportedElementName && 
				
				exportDep.exportedElement.elementNode === exportDependencyObject.exportedElement.elementNode) === false) {

				//add exportDependency object only in the case it is not already added
				exportDependencyObjects.push(exportDependencyObject);
			}
	
		});

		//source file exports objects through assigning/binding them to module.exports/exports
		//export only the properties that are actually used
		exportedProperties.forEach(exportedProperty => {

			// console.log(importedNamespace);
			// console.log(exportedProperty);

			//create an object representing the modification that needs to be performed for exportedProperty in the case that (at least one of the following apply):
			//(a) importedNamespace used outside member expressions (all exported properties are imported under their definition's module exported object, regardless of their references)
			//(b) exportedProperty is used at least once
			//(c) importedNamespace is imported in nested scope (similar to (b))
			//(d) importedNamespace is imported and re-exported from module (similar to (b))
			//NOTICE: both encapsulation and ISP reduction are targeted (thus, export a definition in the case it is actually used)
			exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, exportedProperty, inputFiles, isLibrary);
			if(exportDependencyObject === null) {

				return;
			}

			inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);

			if(exportDependencyObjects.some(exportDep => 
											exportDep.exportedElement.exportedElementName === exportDependencyObject.exportedElement.exportedElementName && 
											exportDep.exportedElement.elementNode === exportDependencyObject.exportedElement.elementNode) === false) {

				//add exportDependency object only in the case it is not already added
				exportDependencyObjects.push(exportDependencyObject);
			}
			
		});

		// console.log(exportDependencyObjects);
		return exportDependencyObjects;
	}

	//AMD module
	//importedNamespace is mapped to the respective exported definitions
	//search accessedProperties within them (in the case that they are objects that can be destructured)
	exportedFunctions.forEach(exportedFunc => {

		exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, exportedFunc, inputFiles, isLibrary);
		if(exportDependencyObject === null) {

			return;
		}

		//add exportDependencyObject in the inputFile's module dependence list
		inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);

		//add exportDependencyObject once
		if(exportDependencyObjects.some(depObj => {

			return depObj === exportDependencyObject;

		}) === false) {

			exportDependencyObjects.push(exportDependencyObject);
		}
	});

	exportedVariables.forEach(exportedVar => {

		exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, exportedVar, inputFiles, isLibrary);
		// console.log(exportDependencyObject);
		if(exportDependencyObject === null) {

			return;
		}

		//add exportDependencyObject in the inputFile's module dependence list
		inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);

		//add exportDependencyObject once
		if(exportDependencyObjects.some(depObj => {

			return depObj === exportDependencyObject;

		}) === false) {

			exportDependencyObjects.push(exportDependencyObject);
		}
	});

	exportedProperties.forEach(exportedProp => {

		//AMD module returns an object literal 
		//(either via the parameter of define() 
		//or either returned from the callback)

		// console.log(exportedProp)

		//map the parameter of define() to an export object (if it is an object literal)
		//in order to import it (do not export them
		//they're exported during the removal of define() invocation)
		exportDependencyObject = mapModuleDefinitionToExportDepObject(inputFile, importedNamespace, exportedProp, inputFiles, isLibrary);
		
		// console.log(exportDependencyObject)
		if(exportDependencyObject === null) {

			return;
		}

		// if(inputFile.isExportedPropertyReturnedFromFunction(exportedProp) === true) {

		// 	//add exportDependencyObject in the inputFile's module dependence list
		// 	inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
		// }

		//add exportDependencyObject in the inputFile's module dependence list
		inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);

		//add exportDependencyObject once
		if(exportDependencyObjects.some(depObj => {

			return depObj === exportDependencyObject;

		}) === false) {

			exportDependencyObjects.push(exportDependencyObject);
		}
	
	});

	return exportDependencyObjects;
}

/**
 * Determines whether imported namespace specified in importedNamespace corresponds to an exported and re-imported namespace.
 * If yes, it retrieves the namespace that is exported and re-imported and updates its accessed properties with the properties
 * accessed through importedNamespace (investigates import-export-import-...-import-export namespace 'chains').
 * @param {*} sourceFile: the module importing and re-exporting a namespace. 
 * @param {*} importedNamespace the namespace imported in sourceFile
 * @param {*} inputFiles the input file hashmap
 * @param {*} moduleDefinition: the exported variable (or property) with whom importedNamespace is mapped. 
 * 	This definition may be assigned an imported declaration (namespace) through require().
 *  (In the case of entry files, moduleDefinition is a feature exported from the module,
 * since all exported feats are included in a imported namespaces/features from the system's clients)
 */
function updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(sourceFile, importedNamespace, inputFiles, moduleDefinition) {

	//is importedNamespace modelling an exported and re-imported namespace?
	//is there a variable (most likely) or exportedProperty that is assigned the result of a require() call?
	//export-import chains don't apply in implied globals
	if(moduleDefinition instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true ||
		sourceFile.isEntryFile === true) {

		return;
	}

	// console.log('i_e: ' + sourceFile.fileName);
	// console.log(importedNamespace);
	// console.log(moduleDefinition);
	// console.log(moduleDefinition instanceof Variable.Variable === true ?
	// 			moduleDefinition.variableName :
	// 			moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true ?
	// 			moduleDefinition.functionName :
	// 			moduleDefinition.exportedPropertyName);
	

	//also, check cases where sourceFile has an imported namespace (not null)
	//but this namespace is bound to an exported feat
	//(proceed in this case)
	// if(importedNamespace !== null && 
	// 	importedNamespace.boundToExportedDefinition === false) {

	// 	return;
	// }

	//cases checked for import-export chains:
	//(1) importedNamespace mapped to a module def initialized with require()
	//(2) importedNamespace not mapped to a module def initialized with require(), 
	//but importedNamespace exported from its module
	//(3 - for entry files) exported def is initialized with require()
	//also, consider module definitions that are not initialized with require(),
	//but they're pointed by imported namespaces that are bound to the module object of 
	//the module that contains the imported namespaces
	if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true ||
		((moduleDefinition instanceof Variable.Variable === true && 
		util.isExplicitGlobalInitializedWithCallSiteOfRequire(moduleDefinition) === false) || 
	   (moduleDefinition instanceof ExportedProperty.ExportedProperty === true && 
		(moduleDefinition.exportedPropertyASTNode.type !== 'CallExpression' || 
		moduleDefinition.exportedPropertyASTNode.callee.type !== 'Identifier' || 
		moduleDefinition.exportedPropertyASTNode.callee.name !== 'require')))) {

		//moduleDefinition not initialized with the result of require
		//no import-export-import 'chain'
		if(importedNamespace === null || 
			importedNamespace.boundToExportedDefinition === false) {

			return;
		}

		// return;
	}

	// console.log(sourceFile.fileName);
	// console.log(moduleDefinition);

	//importedNamespace is mapped to an exported definition (variable/function assigned to the export object or property bound to the export object)
	//importedNamespace is thus mapped to a definition that is imported and re-exported (exported at least twice)
	moduleDefinition.updateIsImportedAndReexported(true);
	// console.log(moduleDefinition.isImportedAndReexported);
	// console.log(importedNamespace);
	// console.log(moduleDefinition);

	// console.log(explicitGlobal.initializationValueNode.arguments);

	//moduleDefinition initialized with the result of require
	let calleeArguments = [];

	//also, consider entry files that import/re-export namespaces/feats
	if(moduleDefinition instanceof Variable.Variable === true) {

		calleeArguments = importedNamespace === null ? 
							moduleDefinition.initializationValueNode.arguments :
							importedNamespace.importedElementNodes[0].value.arguments;
	}
	else if(moduleDefinition instanceof ExportedProperty.ExportedProperty === true) {

		// console.log(moduleDefinition.exportedPropertyASTNode);
		calleeArguments = importedNamespace === null ?
							moduleDefinition.exportedPropertyASTNode.arguments :
							importedNamespace.importedElementNodes[0].value.arguments;
	}

	// console.log(moduleDefinition)
	if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === false && 
		calleeArguments != null && 
		(calleeArguments.length !== 1 || calleeArguments[0].type !== 'Literal')) {

		return;
	}

	let namespaceDefinitionFile;
	if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === false) {

		let moduleRelativePath = calleeArguments == null ? 
									null : 
									calleeArguments[0].value;

		if(moduleRelativePath == null || 
			moduleRelativePath.startsWith('.') === false) {

			return;
		}
		
		//retrieve the absolute path of the module that is the first to define the imported namespace that
		//is imported and re-exported from sourceFile, with respect to sourceFile
		let moduleAbsolutePath;

		try {

			moduleAbsolutePath = require.resolve(path.dirname(sourceFile.fileName) + path.sep + moduleRelativePath);

			//retrieve the CommonJS module specified by moduleAbsolutePath in the input file hash map
			namespaceDefinitionFile = inputFiles.retrieveInputFileInMap(moduleAbsolutePath);
		}
		catch(err) {

			console.log('Error retrieving ' + path.dirname(sourceFile.fileName) + path.sep + moduleRelativePath);
			namespaceDefinitionFile = undefined;
		}

		
	}
	else {

		//imported namespace is mapped with a function definition
		//sourceFile is the CommonJS module that is first to define moduleDefinition
		namespaceDefinitionFile = sourceFile;
	}

	if(namespaceDefinitionFile == undefined) {

		//the module defining importedNamespace is not found
		return;
	}

	// console.log('d: ' + namespaceDefinitionFile.fileName);
	// console.log(moduleDefinition);

	/*Notice: update the exported declaration of namespaceDefinitionFile (the declaration that contains properties)
	with the accessed properties of importedNamespace (importedNamespace specifies: 
	(a) the namespace that is defined in namespaceDefinitionFile and exported from it,
	(b) the namespace that is imported in sourceFile from namespaceDefinitionFile,
	(c) the namespace that is re-exported from sourceFile,
	(d) the namespace that is imported in other modules from sourceFile (and maybe aliased)
	thus, the properties accessed through the (maybe aliased) namespace correspond to properties
	of the namespace defined in namespaceDefinitionFile => update the accessed properties of the latter namespace
	with the accessed properties of the former namespace*/
	let accessedNamespaceProperties = importedNamespace === null ? [] : importedNamespace.accessedProperties;
	// console.log(accessedNamespaceProperties)

	//namespace assigned to a variable
	let exportedVariables = namespaceDefinitionFile.explicitGlobals.filter(explicitGlobal => {

		//retrieve the variables that have object properties
		return explicitGlobal.isExported === true && 
			   explicitGlobal.objectProperties.length > 0;
	});

	// console.log(exportedVariables.length);

	exportedVariables.forEach(exportedVariable => {

		accessedNamespaceProperties.forEach(accessedNamespaceProperty => {

			let retrievedProperty = exportedVariable.retrievePropertyByName(accessedNamespaceProperty.propertyName);

			// console.log(retrievedProperty);

			if(retrievedProperty !== null) {

				exportedVariable.updateIsImportedAndReexported(true);
				retrievedProperty.updateIsExported(true);

				//namespaces that are imported and re-exported are checked
				//in entry files too
				if(importedNamespace != null) {

					importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedVariable.exportedThroughModuleExports);
				}

				// importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedVariable.exportedThroughModuleExports);
			}
		});
	});

	let exportedFunctions = namespaceDefinitionFile.definedFunctions.filter(definedFunction => {

		return definedFunction.isExported === true &&
			   definedFunction.functionProperties.length > 0;
	});

	// console.log(exportedFunctions.length);

	exportedFunctions.forEach(exportedFunction => {

		accessedNamespaceProperties.forEach(accessedNamespaceProperty => {

			let retrievedProperty = exportedFunction.retrievePropertyByName(accessedNamespaceProperty.propertyName);

			if(retrievedProperty !== null) {

				exportedFunction.updateIsImportedAndReexported(true);
				retrievedProperty.updateIsExported(true);

				//namespaces that are imported and re-exported are checked
				//in entry files too
				if(importedNamespace != null) {

					importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedFunction.exportedThroughModuleExports);
				}
				
				// importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedFunction.exportedThroughModuleExports);
			}
		});
	});

	// let exportedProperties = namespaceDefinitionFile.exportedProperties.filter(exportedProperty => {

	// 	//exported properties specify object literals assigned/bound to exports/module.exports
	// 	return exportedProperty.objectProperties.length > 0;
	// });

	//exported properties specify values assigned/bound to exports/module.exports
	//they might not be objects with properties
	let exportedProperties = namespaceDefinitionFile.exportedProperties;

	exportedProperties.forEach(exportedProperty => {

		exportedProperty.updateIsImportedAndReexported(true);

		// console.log(exportedProperty.exportedPropertyName);
		// console.log(exportedProperty.isImportedAndReexported)

		//namespaces that are imported and re-exported are checked
		//in entry files too
		if(importedNamespace != null) {

			importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedProperty.propertyExportedThroughModuleExports);
		}

		// importedNamespace.updateIsReexportedDefinitionBoundToTheExportObject(exportedProperty.propertyExportedThroughModuleExports);

		// console.log(exportedProperty);
		
		// accessedNamespaceProperties.forEach(accessedNamespaceProperty => {

		// 	let retrievedProperty = exportedProperty.retrieveObjectPropertyByName(accessedNamespaceProperty.propertyName);

		// 	if(retrievedProperty !== null) {

		// 		// exportedProperty.updateIsImportedAndReexported(true);
		// 		retrievedProperty.updateIsExported(true);
		// 	}
		// });
	});
}


/**
 * For each exported variable, function, property introduce an export script
 * in inputFile's module dependency list (regardless of whether a module imports inputFile
 * -only for CommonJS modules)
 * @param {*} inputFile 
 */
function addRedundantExportDependenciesToModuleDependencyList(inputFile) {

	if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

		//inputFile is a plain JS module
		return;
	}

	var definedFunctions = inputFile.definedFunctions;
	var explicitGlobals = inputFile.explicitGlobals;
	var exportedProperties = inputFile.exportedProperties;
	let exportDependencyObject;

	// console.log('adj: ' + inputFile.fileName);

	definedFunctions.forEach(function(definedFunction) {

		if(definedFunction.isExported === true) {

			// console.log(definedFunction.functionName);
			// console.log(definedFunction.functionNode.value.loc);

			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElementName = definedFunction.functionName;
			exportDependencyObject.elementNode = definedFunction.functionNode.value;
			exportDependencyObject.modificationFunctions = [];
			exportDependencyObject.isUnused = true;

			if(inputFile.retrieveExportDependencyInModuleDependencyList(exportDependencyObject) === null) {

				console.warn("Unused export in " + inputFile.fileName + ": " + definedFunction.functionName);
				inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
			}
		}
	});

	explicitGlobals.forEach(function(explicitGlobal) {

		// console.log(explicitGlobal);
		if(explicitGlobal.isExported === true) {

			exportDependencyObject = {};
			exportDependencyObject.type = "export";
			exportDependencyObject.exportedElementName = explicitGlobal.variableName;
			exportDependencyObject.elementNode = explicitGlobal.variableDeclarationNode.value;
			exportDependencyObject.modificationFunctions = [];
			exportDependencyObject.isUnused = true;

			if(inputFile.retrieveExportDependencyInModuleDependencyList(exportDependencyObject) === null) {

				console.warn("Unused export in " + inputFile.fileName + ": " + explicitGlobal.variableName);
				inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
			}
		}
	});

	exportedProperties.forEach(function(exportedProperty) {

		// console.log(exportedProperty);
		exportDependencyObject = {};
		exportDependencyObject.type = "export";
		exportDependencyObject.exportedElementName = exportedProperty.exportedPropertyName;
		exportDependencyObject.elementNode = exportedProperty.exportedPropertyASTNode.value;
		exportDependencyObject.modificationFunctions = [];
		exportDependencyObject.isUnused = true;

		if(inputFile.retrieveExportDependencyInModuleDependencyList(exportDependencyObject) === null) {

			console.warn("Unused export in " + inputFile.fileName + ": " + exportedProperty.exportedPropertyName);
			inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
		}

	});

	if(inputFile.objectLiteral !== null) {

		exportDependencyObject = {};
		exportDependencyObject.type = "export";
		exportDependencyObject.exportedElementName = null;
		exportDependencyObject.elementNode = null;
		exportDependencyObject.modificationFunctions = [];
		inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
	}

	// console.log(inputFile.moduleDependencyList.length);
}

/**
 * For each defined implied global, introduce an export script in it's definition module
 * dependency list.
 * @param {*} inputFile 
 */
function addModuleDependenciesOfDefinedImpliedGlobals(inputFile, inputFiles) {

	console.log(`Adding implied global definition dependencies in ${inputFile.fileName}.`);
	let impliedGlobals = inputFile.impliedGlobals;
	let exportDependencyObject;

	// console.log(inputFile.fileName);
	// impliedGlobals.map(imGlob => console.log(imGlob.creationStatement));

	//implied global is:
	//(a) defined in inputFile: add a script for the introduction of its definition
	//(b) accessed in inputFile: add a script for its import in inputFile
	//(c) modified in inputFile: add a script for its import and a script for its modification
	let definedImplieds = impliedGlobals.filter(impliedGlob => {

		// console.log(impliedGlob.creationStatement.value)

		//also, add definitions for implied globals in nested for loops
		if((impliedGlob.creationStatement.value.type === 'ForInStatement' ||
			impliedGlob.creationStatement.value.type === 'ForOfStatement') && 
			impliedGlob.creationStatement.value.left.type === 'Identifier' &&
			impliedGlob.creationStatement.value.left.name === impliedGlob.variableName) {

			return true;
		}

		if(impliedGlob.creationStatement.value.type === 'ForStatement') {

			let initExp = impliedGlob.creationStatement.value.init;
			if(initExp.type === 'AssignmentExpression' &&
				initExp.left.type === 'Identifier' &&
				initExp.left.name === impliedGlob.variableName) {

				return true;
			}
		}

		// console.log(impliedGlob)

		return impliedGlob.isDefined === true;
	});

	//(a)
	definedImplieds.forEach(impliedGlobal => {

		exportDependencyObject = {};
		exportDependencyObject.exportedElement = {};
		exportDependencyObject.type = "introduce_variable_definition";
		exportDependencyObject.exportedElement.variableName = impliedGlobal.variableName;
		exportDependencyObject.exportedElement.creationStatement = impliedGlobal.creationStatement;
		exportDependencyObject.exportedElement.isAssigned = impliedGlobal.isAssigned;
		exportDependencyObject.exportedElement.isDefined = impliedGlobal.isDefined;
		exportDependencyObject.exportedElement.dataType = 'implied';
		exportDependencyObject.exportedElement.modificationFunctions = [];
		// console.log(exportDependencyObject);
		inputFile.addExportDependencyToModuleDependencyList(exportDependencyObject);
	});
}

/**
 * Updates the features (elements/namespaces) imported and 
 * re-exported at least once in the system.
 * @param {*} moduleDependenceGraph the MDG modelling the analyzed system
 * @param {*} inputFiles the file hashmap
 * Preceds the generation of export codemod objects.
 */
function updateImportedAndReexportedFeatures(moduleDependenceGraph, inputFiles, isLibrary = false) {

	//NOTICE: imported-reexported features are also retrieved in library systems
	// if(isLibrary === true) {

	// 	return;
	// }

	let inputFileList = inputFiles.convertHashMapToArray();

	inputFileList.forEach(inputFile => {

		//doesn't apply to client-side projects
		if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

			return;
		}

		if(fileUtilities.doesFileContainCodeFromExternalLibrary(inputFile) === true) {

			//inputFile comprises an external library - do not consider import dependencies
			//for that module
			return;
		}

		//retrieve MDG node representing inputFile
		let mdgNode = moduleDependenceGraph.retrieveMDGNodeRepresentingModule(inputFile);

		if(mdgNode == undefined) {

			return;
		}

		//retrieve adjacent nodes
		//Adjacent node: object of type {MDGNode, MDGEdge}
		//MDGNode: object of type {SourceFile, AdjacencyList}
		//MDGEdge: object of type {edgeType [enum], ImportedElement, usageSet}
		let adjacencyList = mdgNode.adjacencyList;
		
		//module dependencies: the elements that are imported in inputFile (module imports)
		let isExternalLibrary;

		// console.log(inputFile.fileName + " " + adjacencyList.length);

		//also, process exported feats of entryfile
		//no module deps pointing to this file exist, 
		//but I assume that all feats are exported to clients
		//thus, these feats also need to be processed
		if(inputFile.isEntryFile === true) {

			let expVars = inputFile.explicitGlobals.filter(explGlob => {

				return explGlob.isExported === true;
			});

			let expFuncs = inputFile.definedFunctions.filter(defFunc => {

				return defFunc.isExported === true;
			});

			let expProps = inputFile.exportedProperties;

			expVars.forEach(expVar => {

				updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, null, inputFiles, expVar);
			});

			expFuncs.forEach(expFunc => {

				updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, null, inputFiles, expFunc);
			});

			expProps.forEach(expProp => {

				updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, null, inputFiles, expProp);
			});

			// return;
		}

		adjacencyList.forEach(adjacentNode => {

			//each adjacentNode contains the module dependency (import)
			let adjacentMDGNode = adjacentNode.node;
			let representedModule = adjacentMDGNode.representedModule === undefined ? 
									adjacentMDGNode : 
									adjacentMDGNode.representedModule;

			let moduleDependency = adjacentNode.moduleDependency;

			isExternalLibrary = fileUtilities.doesFileContainCodeFromExternalLibrary(representedModule);

			//library systems are syntactically transformed
			//(imports/exports are introduced, regardless of feature usage)
			//again, I don't consider importing features from files that are external to the analyzed system 
			//(e.g. require.js in RequireJS projects, external libraries e.g. jquery in non-modular ES5)
			if(moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.NamespaceImport && 
				moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.ModuleImport && 
				moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition &&
				moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyUse &&
				moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification && 
				(isExternalLibrary === true || (isLibrary === false && moduleDependency.usageSet.length === 0))) {

				//do not consider import scripts when:
				//(a) an AMD module imports elements from require.js (require.js added in the excluded file argument of the execution command)
				//(b) a module imports implied globals or exported global variables from an external library

				//do not introduce imports, in the case that 
				//the imported element (implied global) has no usages
				return;
			}

			let importedElement = moduleDependency.accessedElement;

			if(importedElement instanceof ImportedElement.ImportedElement === true) {

				let moduleDefinition = importedElement.moduleDefinition;

				if(moduleDefinition == null) {

					return;
				}

				updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, moduleDefinition);
				return;
			}

			if(importedElement instanceof ImportedNamespace.ImportedNamespace === true) {

				let moduleDefinitions = importedElement.moduleDefinitions;
				let exportedVariables = moduleDefinitions.exportedVariables;
				let exportedFunctions = moduleDefinitions.exportedFunctions;
				let exportedProperties = moduleDefinitions.exportedProperties;

				exportedVariables.forEach(expVar => {

					updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, expVar);
				});

				exportedFunctions.forEach(expFunc => {

					updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, expFunc);
				});

				exportedProperties.forEach(expProp => {

					updateImportedNamespaceWithAccessedPropertiesOfReimportedNamespace(inputFile, importedElement, inputFiles, expProp);
				});

				return;
			}
		});

	});
}

exports.createMDG = createMDG;
exports.retrieveModuleDependenciesOfModule = retrieveModuleDependenciesOfModule;
exports.updateImportedAndReexportedFeatures = updateImportedAndReexportedFeatures;

exports.updateLibraryModuleExportDependencies = updateLibraryModuleExportDependencies;