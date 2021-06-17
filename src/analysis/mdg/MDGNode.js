/**
 * MDGNode. Node representing a module of the analyzed project.
 * Each MDGNode keeps the list of its successors (adjacencyList)
 * and its predecessors (predecessors) in order to update the cohesion
 * of the imported definitions in each module 
 * (through a DFS and a reverse DFS - applies to CommonJS projects).
 */

var jscodeshift = require('../../../node_modules/jscodeshift');

var mdgEdge = require('./MDGEdge.js');
var moduleDependencyEnum = require('./ModuleDependency.js');
var util = require('../ast/util/util.js');
var enums = require('../ast/util/enums.js');

function MDGNode(sourceFile) {
	
	this.representedModule = sourceFile;

	//the MDG nodes that are the successors of this node
	//(modules whose exported definitions are used within this module)
	this.adjacencyList = [];

	//the MDG nodes that are the predecessors of this node
	//(modules that use the exported definitions of this module)
	this.predecessors = [];
	
	/**
	 * Updates mdg node's adjacency list.
	 */
	this.updateAdjacencyList = function(adjacencyList) {
		
		this.adjacencyList = this.adjacencyList.concat(adjacencyList);
	};

	/**
	 * Adds a MDG node to the mdg node's adjacency list
	 * (needed in order to introduce MDG edges due to global object property definitions/usages/modifications).
	 */
	this.addAdjacentNodeToList = function(adjacentNode) {

		// this.adjacencyList.push(adjacentNode);

		let propertyDefinitionNode = adjacentNode.moduleDependency.accessedElement.propertyDefinitionNode;

		let adjacentNodes = this.adjacencyList.filter(function(currentAdjacentNode) {

			if(currentAdjacentNode.moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition &&
			   currentAdjacentNode.moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification &&
			   currentAdjacentNode.moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyUse) {
	 
				return false;
			}

			
			// console.log(currentAdjacentNode.moduleDependency.accessedElement.propertyDefinitionNode.value);
			// console.log(adjacentNode.moduleDependency.accessedElement.propertyDefinitionNode.value);
			return currentAdjacentNode.node.representedModule.fileName === adjacentNode.node.representedModule.fileName &&
				   currentAdjacentNode.moduleDependency.edgeType === adjacentNode.moduleDependency.edgeType &&
				   currentAdjacentNode.moduleDependency.accessedElement.propertyDefinitionNode === adjacentNode.moduleDependency.accessedElement.propertyDefinitionNode;
				   
		});

		// console.log(adjacentNodes.length);
		// console.log(propertyDefinitionNode);

		//add each adjacentNode once
		if(adjacentNodes.length === 0) { //&&
			//this.representedModule.astRootCollection.find(jscodeshift[propertyDefinitionNode.value.type], propertyDefinitionNode).length !== 0) {

			// console.log(propertyDefinitionNode);
			// console.log(this.representedModule.astRootCollection.find(jscodeshift[propertyDefinitionNode.value.type], propertyDefinitionNode.value).length);

			if((adjacentNode.moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition &&
			   this.representedModule.astRootCollection.find(jscodeshift[propertyDefinitionNode.value.type], propertyDefinitionNode.value).length !== 0) ||
			   adjacentNode.moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition) {

				//(i) in the case of a GOPD dependency, add adjacentNode only in the case that
				//propertyDefinitionNode represents a statement that is included in the module's AST
				//(prevent introducing GOPD dependencies with statements from other modules)
				//(ii) in the case of a GOPU/GOPM dependency, add adjacentNode (in the previous filtering,
				//duplicate adjacent nodes due to the same statement are prevented)
				this.adjacencyList.push(adjacentNode);
			}
		}
	};

	this.addMDGNodeToPredecessors = function(mdgNode) {

		if(this.predecessors.indexOf(mdgNode) === -1) {

			this.predecessors.push(mdgNode);
		}
	}
	
	/**
	 * Updates the out-going edges of the mdg node (edges representing imports of variables/functions/namespaces/modules).
	 */
	this.retrieveOutGoingEdgesOfMDGNode = function() {
		
		let edgeObjects = [];
		
		//mdgNode: an ES6 module of the system after the application of the refactoring
		let sourceFile = this.representedModule;
		let importedElements = sourceFile.importedElements;
		
		// console.log(sourceFile.fileName + " " + sourceFile.importedElements.length);
		// console.log(sourceFile.fileName + " " + sourceFile.importedFunctions.length + " " + sourceFile.importedVariables.length);
		// console.log(sourceFile.importedNamespaces)

		//update introduce MDG edges in a sequential order
		
		//(i) introduce MDG edges representing function definition dependencies
		sourceFile.importedFunctions.forEach(importedFunction => {
			
			// console.log(importedFunction.elementName);
			
			//find usage set for importedFunction (stored in importedFunction object)
			let usageSet = importedFunction.elementUsages;

			//is importedFunction used? (if not, do not consider this dependency if sourceFile is a plain JS module)
			if(usageSet.length === 0 &&
			   sourceFile.sourceVersion === enums.SourceVersion.ES5 &&
			   sourceFile.moduleFramework.includes(enums.ModuleFramework.plain) === true) {

				return;
			}

			for(let useIndex = 0; useIndex < usageSet.length; useIndex++) {

				let usage = usageSet[useIndex];
				let isUsageInsidePropertyDefinition = false;

				let {isUsageWithinAMemberExpression, surrMbExp} = util.isIdentifierLocatedInAPropertyDefinition(usage);
				
				if(isUsageWithinAMemberExpression === true) {

					isUsageInsidePropertyDefinition = true;
					importedFunction.moduleDefinition.updateIsObjectHierarchyModifiedInMultipleModules(true);
					importedFunction.moduleDefinition.pushModuleToModulesEnrichingHierarchy(sourceFile);
				}
			}
			
			//initialize outgoing edge
			let outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.FunctionDefinition, importedFunction, usageSet);
			
			let edgeObject = {
					
					"importedSource": importedFunction.declaredSource.value !== undefined ? importedFunction.declaredSource.value : importedFunction.declaredSource,
					
					"outgoingEdge": outgoingEdge
			};
			
			//push edgeObject to array and proceed with the next outgoing edge
			edgeObjects.push(edgeObject);

		});
		
		//(ii) introduce MDG edges representing global use dependencies
		sourceFile.importedVariables.forEach(importedVariable => {
			
			// console.log(importedVariable);

			//sourceFile defines an implied global with the same name
			//or assigns an implied global with the same name (not in assignments)
			let defImplied = sourceFile.retrieveImpliedGlobalByName(importedVariable.elementName);
			if(defImplied !== null) {

				if(defImplied.isDefined === true) {

					return;
				}

				if(defImplied.isAssigned === true && 
					(defImplied.creationStatement.value.type !== 'ExpressionStatement' ||
					defImplied.creationStatement.value.expression.type !== 'AssignmentExpression')) {

					return;
				}
			}

			//find the usage set for importedVariable
			let outgoingEdge;
			let usageSet = importedVariable.elementUsages;
			let isUsageOfWriteType = false;
			let isUsageInsidePropertyDefinition = false;

			// is importedVariable used? (if not, do not consider this dependency if sourcefile is a plain JS module)
			// what if importedVariable corresponds to an implied global that is used only within its definition module?
			// consider these dependencies
			if(usageSet.length === 0 &&
			   sourceFile.sourceVersion === enums.SourceVersion.ES5 &&
			   sourceFile.moduleFramework.includes(enums.ModuleFramework.plain) === true &&
			   importedVariable.elementDeclarationNode !== null) {
 
				//do not consider dependencies related to explicit globals that are visible but not used in plain JS files
				return;
			}
			
			//is importedVariable modified in the code (at least once?)
			for(let usageIndex = 0; usageIndex < usageSet.length; usageIndex++) {
				
				let usage = usageSet[usageIndex];
				let parentNode = usage.parentPath;
				let parentNodeType = parentNode.value.type;

				isUsageOfWriteType = false;
				isUsageInsidePropertyDefinition = false;
				
//				console.log(parentNode.value.left);
//				console.log();
//				console.log(parentNode.value.right);
//				console.log(usage);
//				console.log(parentNode.value.right === usage.value);

				let {isEsModified, modExp} = util.isIdentifierRepresentingAnElementModification(usage);

				if(isEsModified === true) {

					isUsageOfWriteType = true;
					break;
				}

				let {isUsageWithinAMemberExpression, surrMbExp} = util.isIdentifierLocatedInAPropertyDefinition(usage);

				if(isUsageWithinAMemberExpression === true) {

					isUsageInsidePropertyDefinition = true;
					importedVariable.moduleDefinition.updateIsObjectHierarchyModifiedInMultipleModules(true);
					importedVariable.moduleDefinition.pushModuleToModulesEnrichingHierarchy(sourceFile);
				}
				
				// if((parentNodeType === 'AssignmentExpression' && parentNode.value.left === usage.value) || 
				//    parentNodeType === 'UpdateExpression') {
					
				// 	//found a modification of importedVariable
				// 	//no need to search for other modifications of importedVariable
				// 	isUsageOfWriteType = true;
				// 	break;
				// }
			}
			
			if(isUsageOfWriteType === true) {
				
				//importedVariable is modified at least once - create a global definition MDG edge
				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.GlobalDefinition, importedVariable, usageSet);
			}
			else {
				
				//importedVariable is not modified - create a global use MDG edge
				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.GlobalUse, importedVariable, usageSet);
			}
			
			let edgeObject = {
				
				"importedSource": importedVariable.declaredSource.value !== undefined ? importedVariable.declaredSource.value : importedVariable.declaredSource,
				"outgoingEdge": outgoingEdge
			};

			// console.log(edgeObject);
			
			//push edgeObject to array and proceed with the next outgoing edge
			edgeObjects.push(edgeObject);
			
		});

		//(iii) introduce MDG edges representing uses of imported modules (namespaces)
		sourceFile.importedNamespaces.forEach(importedNamespace => {

			//find usage set of importedNamespace
			let usageSet = importedNamespace.elementUsages;

			// console.log(importedNamespace.elementName);

			//is importedNamespace used? (if not, do not consider this dependency)
			// if(usageSet.length === 0) {

			// 	return;
			// }

			//is importedVariable modified in the code (at least once?)

			// console.log(importedNamespace);

			let isUsageOfWriteType;
			let isUsageInsidePropertyDefinition;
			for(let usageIndex = 0; usageIndex < usageSet.length; usageIndex++) {
				
				isUsageOfWriteType = false;
				isUsageInsidePropertyDefinition = false;

				let usage = usageSet[usageIndex];
				let parentNode = usage.parentPath;
				let parentNodeType = parentNode.value.type;

				let {isEsModified, modExp} = util.isIdentifierRepresentingAnElementModification(usage);

				if(isEsModified === true) {

					isUsageOfWriteType = true;
					break;
				}

				let {isUsageWithinAMemberExpression, surrMbExp} = util.isIdentifierLocatedInAPropertyDefinition(usage);
				
				if(isUsageWithinAMemberExpression === true) {

					isUsageInsidePropertyDefinition = true;
					// console.log(isUsageInsidePropertyDefinition)

					/**
					 * form: {
						exportedVariables: <array of variable objects>,
						exportedFunctions: <array of functionDeclaration objects>,
						exportedProperties: <array or exportedProperty objects (CommonJS) | 
											array of objectLiteral objects (AMD)>
					}*/
					let moduleDefinitions = importedNamespace.moduleDefinitions;

					if(Object.keys(moduleDefinitions).length > 0) {

						moduleDefinitions.exportedVariables.forEach(exportedVariable => {

							exportedVariable.updateIsObjectHierarchyModifiedInMultipleModules(true);
							exportedVariable.pushModuleToModulesEnrichingHierarchy(sourceFile);
						});
	
						moduleDefinitions.exportedFunctions.forEach(exportedFunction => {
	
							exportedFunction.updateIsObjectHierarchyModifiedInMultipleModules(true);
							exportedFunction.pushModuleToModulesEnrichingHierarchy(sourceFile);
						});
	
						moduleDefinitions.exportedProperties.forEach(exportedProperty => {
	
							exportedProperty.updateIsObjectHierarchyModifiedInMultipleModules(true);
							exportedProperty.pushModuleToModulesEnrichingHierarchy(sourceFile);
						});
					}
					

					// console.log(importedNamespace.moduleDefinitions);
				}
			}

			if(isUsageOfWriteType === true) {
				
				//importedVariable is modified at least once - create a namespace definition MDG edge
				//also model the fact that the namespace's mapped module definitions are included in a namespace that is modified somewhere in the analysed system
				//(needed to determine whether a mapped definition that is an object is going to be destructured to its properties or not)
				importedNamespace.updateNamespaceUsageInModuleDefinitions(true);

				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.NamespaceModification, importedNamespace, usageSet);
			}
			else {
				
				//importedVariable is not modified - create a namespace use MDG edge
				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.NamespaceImport, importedNamespace, usageSet);
			}


			//initialize outgoing MDG edge
			// var outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.NamespaceImport, importedNamespace, usageSet);

			let edgeObject = {

				"importedSource": importedNamespace.declaredSource.value !== undefined ? importedNamespace.declaredSource.value : importedNamespace.declaredSource,
				"outgoingEdge": outgoingEdge
			};

			//push edgeObject to array and proceed with the next outgoing edge
			edgeObjects.push(edgeObject);
		});

		//(iv) introduce MDG edges representing uses of imported modules creating without using commonjs/amd (i.e. IIFE modules)
		sourceFile.importedModules.forEach(importedModule => {

			//find usage set of importedModule
			let usageSet = importedModule.elementUsages;

			//is importedModule used? (if not, do not consider this dependency)
			// if(usageSet.length === 0) {

			// 	return;
			// }

			//initialize outgoing MDG edge
			let outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ModuleImport, importedModule, usageSet);

			let edgeObject = {

				"importedSource": importedModule.declaredSource.value !== undefined ? importedModule.declaredSource.value : importedModule.declaredSource,
				"outgoingEdge": outgoingEdge
			};

			//push edgeObject to array and proceed with the next outgoing edge
			edgeObjects.push(edgeObject);
		});

		// console.log(sourceFile.fileName);
		// console.log(sourceFile.usedImpliedGlobals);

		//MDG edges for the definition/use/modification of implied globals
		//are introduced before the introduction of outgoing edges for each module
		//since their definition module is not revealed during the code analysis phase
		
		// console.log(sourceFile.fileName);
		// console.log(edgeObjects);
		
		return edgeObjects;
	};

	/**
	 * Updates the out-going edges of the mdg node (edges representing global object property uses/modifications).
	 */
	this.retrieveGlobalObjectPropertyEdges = function() {
		
		var edgeObjects = [];
		
		//mdgNode: an ES6 module of the system after the application of the refactoring
		var sourceFile = this.representedModule;

		// introduce MDG edges representing uses of global object properties
		sourceFile.globalObjectProperties.forEach(function(globalObjectProperty) {

			//initialize outgoing MDG edge (GlobalObjectPropertyUse in the case that the global object property is read,
			//GlobalObjectPropertyModification in the case that the global object property is modified)
			var outgoingEdge;
			if(globalObjectProperty.isAssigned === false) {

				//global object property is not modified
				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyUse, globalObjectProperty, []);
			}
			else {

				//global object property is modified
				outgoingEdge = new mdgEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification, globalObjectProperty, []);
			}

			var edgeObject = {

				"outgoingEdge": outgoingEdge
			};

			//push edgeObject to array and proceed with the next outgoing edge
			edgeObjects.push(edgeObject);
		});
		
		return edgeObjects;
	};

	/**
	 * Does MDG node contain is connected with an MDG node
	 * due to a GOPD dependency introduced by statementNode specified in mdgEdge?
	 */
	this.doesStatementIntroduceAGOPDDependency = function(mdgEdge) {

		let propertyDefinitionNode = mdgEdge.accessedElement.propertyDefinitionNode;

		// console.log(this.representedModule.fileName + " " + this.adjacencyList.length);

		//is propertyDefinitionNode a statement that represents the definition of a global property?
		//(search propertyDefinitionNode in the mdg node's adjacency list, and retrieve if it's
		//specified in a GOPD dependency
		for(let adjacentNodeIndex = 0; adjacentNodeIndex < this.adjacencyList.length; adjacentNodeIndex++) {

			let adjacentNode = this.adjacencyList[adjacentNodeIndex];
			let moduleDependency = adjacentNode.moduleDependency;
			// console.log(moduleDependency);
			if(moduleDependency.edgeType !== moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition) {

				//mdgNode is connected to adjacentNode due to a module dependency that is not a GOPD dependency
				//proceed to the next module dependency/adjacent node
				continue;
			}

			//moduleDependency is a GOPD dependency
			//is it introduced due to the statement specified in mdgEdge
			//(if yes, mdgEdge should not be considered as a GOPM dependency)
			let dependencyPropertyDefinitionNode = moduleDependency.accessedElement.propertyDefinitionNode;
			// console.log(dependencyPropertyDefinitionNode.value === propertyDefinitionNode.value);
			// console.log(propertyDefinitionNode.value);
			// console.log(dependencyPropertyDefinitionNode.value);
			if(dependencyPropertyDefinitionNode === propertyDefinitionNode) {

				//propertyDefinitionNode is specified by a GOPD dependency
				//propertyDefinitionNode should not be considered in a GOPM dependency
				return true;
			}

		}

		//mdgNode is not connected with another mdg node due to a GOPD dependency
		//mdgEdge does not specifies a statement that introduces a GOPD dependency
		return false;
	};
	
	/**
	 * Prints the MDGNode (debug helper function)
	 */
	this.dumpMDGNode = function() {
		
		// console.log(this);
		var result = "mdgNode: " + this.representedModule.fileName + "\n";
		result += "isEntryFile: " + this.representedModule.isEntryFile + "\n";
		result += 'number of adjacentNodes: ' + this.adjacencyList.length + "\n";
		this.adjacencyList.forEach(function(adjacentNode) {
			
			result += adjacentNode.printAdjacentNode() + "\n";
		});
		
		return result;
	};


	this.getModuleType = function() {

		let isUtilityModule = false;
	
		let isClassModule = false;
	
		let exportedVariables = this.representedModule.explicitGlobals.filter(function(explicitGlobal) {
	
			return explicitGlobal.isExported === true;
		});
	
		let exportedProperties = this.representedModule.exportedProperties;
	
		// console.log(inputFile.fileName);
		// console.log(inputFile.definedFunctions);
		let exportedFunctions = this.representedModule.definedFunctions.filter(function(definedFunction) {
	
			return definedFunction.isExported === true;
		});
	
		// if (this.representedModule.fileName.includes("is.js")){
		// 	console.dir(this.representedModule)
		// }
		//console.log(this.representedModule.fileName + "******" + exportedFunctions.length + "-" + exportedProperties.length + "-" + exportedVariables.length)

		if(exportedFunctions.length > 0) {
	
			// console.log(exportedFunctions);
			//in AMD modules, exportedFunctions are the callback functions provided in define()
			//an AMD module is a classModule if the returned element is a constructor function
			if(this.representedModule.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {
	
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
	
					let retrievedFunction = this.representedModule.retrieveDefinedFunctionByNode(returnedElementNode);
	
					// console.log(retrievedFunction);
					if(retrievedFunction !== null && retrievedFunction.isConstructor === true) {
	
						isClassModule = true;
					}
					else {
						// FIXME: It is not necessarily a UtilityModule. A utility module must export
						// two or more named exports after refactoring. 
	
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
				else if (exportedFunctions.length > 1) {
					console.log("*****" + this.representedModule.fileName + " " + exportedFunctions.length)
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
			else if (exportedVariables.length > 1){
	
				isUtilityModule = true;
			}
	
			return {
	
				isClassModule: isClassModule,
				isUtilityModule: isUtilityModule
			};
		}
	
		if(exportedProperties.length > 1) {
			
	
			//applies to CommonJS modules
			//module exports object literals with sets of properties
			isUtilityModule = true;
	
		}
	
		return {
			isClassModule: isClassModule,
			isUtilityModule: isUtilityModule
		};
	}

	
}

exports.MDGNode = MDGNode;