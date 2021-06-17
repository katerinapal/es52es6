/**
 * http://usejsdoc.org/
 */

var fs = require('fs');
var path = require('path');

var graphviz = require('../../../node_modules/graphviz');

var ImportedElement = require('../ast/model/importedElement.js');

var MDGNode = require('./MDGNode.js');
var AdjacentNode = require('./AdjacentNode.js');
var MDGEdge = require('./MDGEdge.js');
var moduleDependencyEnum = require('./ModuleDependency.js');

var fileUtilities = require('../../io/fileUtilities.js');

function ModuleDependenceGraph(directory) {
	
	this.modelledProject = path.basename(directory);

	this.nodeList = [];
	
	this.updateNodeList = function(nodeList) {
		
		this.nodeList = nodeList;
	};
	
	/**
	 * Initializes nodes of MDG.
	 * @param inputFiles
	 * @returns
	 */
	this.initializeNodeListOfMDG = function(inputFiles) {
		
		var nodeList = [];
		
		//for each input file, create a MDG node and insert it to nodeList
		inputFiles.buckets.forEach(function(fileList) {

			fileList.forEach(function(inputFile) {
			
				// console.log(inputFile[1].fileName);
				var mdgNode = new MDGNode.MDGNode(inputFile[1]);
				nodeList.push(mdgNode);
				console.log('MDG node modelling ' + inputFile[1].fileName + ' inserted.');
			});
		});
		
		this.updateNodeList(nodeList);
	};
	
	/**
	 * Updates the edges of the MDG (both edges representing imports of variables/functions/modules/namespaces
	 * and edges representing uses/modifications of global object properties).
	 * Update: the insertion of an MDG edge is followed by the insertion of the reverse MDG edge
	 * (needed for performing DFS in the reverse MDG, in order to update the cohesion of the imported definitions).
	 */
	this.updateMDGEdges = function(inputFiles) {
		
		//MDG edge: (t_j, d_j, U_j)
		//t_j: edge type (module dependency type)
		//d_j: function/variable definition imported
		//U_j: usage set of d_j (used identifiers)
		console.log(`Updating MDG edges.`);

		//introduce edges representing global object property definitions/uses/modifications
		//(these properties may be introduced in one of modules represented by the module's  adjacent nodes)
		this.retrieveMDGEdgesRepresentingGlobalPropertyManagement();

		this.introduceImpliedGlobalDefinitionEdges();

		//for each module represented by mdgNode,
		//update out-going edges representing variable/function/namespace/module imports
		this.nodeList.forEach(mdgNode => {
			
			//update the mdgNode's out-going edges and
			//proceed to the next mdgNode (ES6 module)
			var outgoingEdgeObjects = mdgNode.retrieveOutGoingEdgesOfMDGNode();

			// console.log(mdgNode.representedModule.fileName + " " + outgoingEdgeObjects.length);
			
			//retrieve mdgNode's adjacent nodes and update mdgNode's adjacency list 
			//(use wrapper nodes containing information about the adjacent mdg node
			//and the module dependency (MDGEdge)
			
			var adjacentNodeList = [];
			
			outgoingEdgeObjects.forEach(outgoingEdgeObject => {
				
				var importedSource = outgoingEdgeObject.importedSource;
				var outgoingEdge = outgoingEdgeObject.outgoingEdge;

				// console.log(importedSource);
				// console.log(outgoingEdgeObject);
				
				if(importedSource.startsWith('.') === false) {

					//imported module is not defined locally in the system (e.g. it is a npm package)
					//create adjacentNode (wrapper around outgoingMDGNode), where the importFile is null (it is an external module)
					//prevent searching in the input file hashmap (and resolving the wrong imported module)
					var adjacentNode = new AdjacentNode.AdjacentNode(null, outgoingEdge);
					
					//add adjacentNode to adjacentNodeList
					adjacentNodeList.push(adjacentNode);

					//proceed to the next outgoing MDG edge of mdgNode
					return;
				}

				var specifiedModulePath = path.resolve(path.dirname(mdgNode.representedModule.fileName) + path.sep + importedSource);
				
				//retrieve importedSource in inputFiles' list
				var importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
				
				// console.log(mdgNode.representedModule.fileName + " " + specifiedModulePath);
				// console.log(importFile != null ? importFile.fileName : null);

				//if(importFile !== null) {
					
				//find mdgNode representing importFile
				var outgoingMDGNode = this.retrieveMDGNodeRepresentingModule(importFile);

				// console.log(outgoingMDGNode != null ? outgoingMDGNode.representedModule.fileName : null);
					
				//create adjacentNode (wrapper around outgoingMDGNode) (mdgNode ---> outgoingMDGNode)
				var adjacentNode = new AdjacentNode.AdjacentNode(outgoingMDGNode, outgoingEdge);
					
				// console.log(adjacentNode.node != null ? adjacentNode.node.representedModule.fileName : null);

				//add adjacentNode to adjacentNodeList
				adjacentNodeList.push(adjacentNode);

				if(importFile === null) {

					//importFile not found in the input file hash map
					//a module in an external npm package
					//proceed to the next outgoing MDG edge (import dependency)
					return;
				}

				//for each MDG edge introduce the reverse edge (outgoingMDGNode ---> mdgNode)
				//needed for performing a DFS in the reverse graph in order to update the cohesion of imported definitions
				let predecessorNode = new AdjacentNode.AdjacentNode(mdgNode, outgoingEdge);
				outgoingMDGNode.addMDGNodeToPredecessors(predecessorNode);
				
			});
			
			//update adjancent node list of mdgNode and proceed to the next mdgNode
			mdgNode.updateAdjacencyList(adjacentNodeList);
			return;
		});
		
		// //edges representing variable/function/namespace/module imports
		// //are already introduced in the MDG (adjacent lists of MDG nodes are updated)
		// //introduce edges representing global object property definitions/uses/modifications
		// //(these properties may be introduced in one of modules represented by the module's  adjacent nodes)
		// this.retrieveMDGEdgesRepresentingGlobalPropertyManagement();

		// this.introduceImpliedGlobalDefinitionEdges();
	};

	this.retrieveMDGEdgesRepresentingGlobalPropertyManagement = function() {

		//(i) introduce a global object property definition MDG edge in the MDG node
		//representing the module where each global property is introduced
		this.introduceGlobalObjectPropertyDefinitionEdges();

		//(ii) introduce global object property use/modification MDG edges that exit from the input files
		//that use/modify them and enter into the input files that define these properties
		// this.introduceGlobalObjectPropertyHandlingEdges();
	}

	/**
	 * Updates the MDG nodes with GlobalObjectPropertyDefinition edges
	 * (edges representing the definition of global object properties).
	 * Also, updates the MDG nodes modelling modules that reference
	 * implied globals with GlobalObjectPropertyUse/GlobalObjectPropertyModification edges.
	 */
	this.introduceGlobalObjectPropertyDefinitionEdges = function() {

		//push global properties that are introduced in all input files in an array
		//map() returns an array of arrays (the arrays are the globalObjectProperties defined in each module)
		let introducedGlobalPropertySets = this.nodeList.map(mdgNode => {

			return mdgNode.representedModule.globalObjectProperties;
		});

		//collapse all arrays in a single array
		let introducedGlobalProperties = introducedGlobalPropertySets.reduce((introducedGlobalProperties, globalPropertySet) => {

			return introducedGlobalProperties.concat(globalPropertySet);
		}, []);

		let definedGlobalProperties = introducedGlobalProperties.filter(definedGlobalProp => {

			return definedGlobalProp.propertyDefinitionNode.value.type === 'AssignmentExpression';
		});

		//find each property's definition module
		definedGlobalProperties.forEach(property => {

			// console.log(property);

			let definitionModuleMDGNode = this.retrieveGlobalObjectPropertyDefinitionModule(property);
			if(definitionModuleMDGNode === null) {

				//the definition module of property is not retrieved (case: jugglingdb, railway) - do not consider property for transformation
				//proceed to the next global object property
				return;
			}

			// console.log(property.elementName + " " + definitionModuleMDGNode.representedModule.fileName);

			//(a) create an MDG edge that models the definition of a global object property (the adjacent node
			//is the definitionModuleMDGNode itself)
			let outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition, property, []);
			let adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
					
			//add adjacentNode to adjacentNodeList
			definitionModuleMDGNode.addAdjacentNodeToList(adjacentNode);

			//(b) create MDG edges that model the use/modification of a global object property
			//for the other modules
			// let refModuleMDGNodes = this.nodeList.filter(mdgNode => {

			// 	if()
			// 	return mdgNode !== definitionModuleMDGNode;
			// });




		// 	var that = this;

		// //for each MDG node (representing a module)...
		// this.nodeList.forEach(function(mdgNode) {

		// 	var representedModule = mdgNode.representedModule;

		// 	//...retrieve MDG edges involving the management (read/write) of global object properties
		// 	var outgoingEdgeObjects = mdgNode.retrieveGlobalObjectPropertyEdges();

		// 	// console.log(mdgNode.representedModule.fileName + " " + outgoingEdgeObjects.length);

		// 	outgoingEdgeObjects.forEach(function(outgoingEdgeObject) {

		// 		let outgoingEdge = outgoingEdgeObject.outgoingEdge;

		// 		//retrieve the global property that is referenced by outgoingEdge
		// 		let accessedElement = outgoingEdge.accessedElement;

		// 		//retrieve the definition module of accessedElement
		// 		//(the definition module is represented by an MDG node that has itself as an adjacent node
		// 		//due to the existence of a GlobalObjectPropertyDefinition)
		// 		let definitionModuleMDGNode = that.retrieveMDGNodeWithGlobalObjectPropertyDefinitionEdge(accessedElement);

		// 		// console.log(accessedElement.elementName + " " + definitionModuleMDGNode.representedModule.fileName);

		// 		//(i) do not consider edges that represent dependencies due to GOP that are not defined explicitly in the system
		// 		//(ii) do not consider GOPM edges that actually represent GOP definitions
		// 		//(case: a module that defines a global property, modifies it [check is the statement introduces a GOPD dependency
		// 		//by its 'coordinates' (start/end line/column)])
		// 		if(definitionModuleMDGNode === null || 
		// 		   (outgoingEdgeObject.outgoingEdge.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification && 
		// 			mdgNode.representedModule.fileName === definitionModuleMDGNode.representedModule.fileName && 
		// 			definitionModuleMDGNode.doesStatementIntroduceAGOPDDependency(outgoingEdgeObject.outgoingEdge) === true)) {

		// 			//accessedElement is not defined in any module
		// 			//proceed to the next MDG edge
		// 			return;
		// 		}

		// 		// console.log(outgoingEdgeObject);
		// 		// console.log(definitionModuleMDGNode.adjacencyList);

		// 		//definitionModuleMDGNode is the adjacent node of mdgNode
		// 		//(the module represented by mdgNode uses/modifies the global object property 
		// 		//defined in the module represented by definitionModuleMDGNode)
		// 		var adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
					
		// 		//add adjacentNode to adjacentNodeList
		// 		mdgNode.addAdjacentNodeToList(adjacentNode);
		// 	});
		// });

		});
	};

	/**
	 * Updates the MDG nodes with ImpliedGlobalDefinition edges
	 * (edges representing the definition of implied globals).
	 * Also, updates the MDG nodes modelling modules that reference
	 * implied globals with ImpliedGlobalImport/ImpliedGlobalModification edges.
	 */
	this.introduceImpliedGlobalDefinitionEdges = function() {

		//push implied globals that are introduced in all input files in an array
		let impliedGlobalSets = this.nodeList.map(mdgNode => {

			return mdgNode.representedModule.impliedGlobals;
		});

		//collapse all arrays in a single array
		let impliedGlobals = impliedGlobalSets.reduce((impliedGlobals, impliedGlobalSet) => {

			return impliedGlobals.concat(impliedGlobalSet);
		}, []);

		// console.log(impliedGlobals.length);

		//find each property's definition module
		//exclude implied globals that are not assigned a value 
		//(jshint will report the implied global references, not only definitions)
		impliedGlobals = impliedGlobals.filter(impliedGlobal => {

			// console.log(impliedGlobal.variableName + ' ' + impliedGlobal.isAssigned)
			return impliedGlobal.isAssigned === true;
		});

		//remove duplicates
		impliedGlobals = impliedGlobals.filter((element, position) => {

			// console.log(element.variableName)
			let firstOccurenceIndex = impliedGlobals.findIndex(impGlob => {

				return impGlob.variableName === element.variableName;
			});
			return firstOccurenceIndex === position;
		});

		impliedGlobals.forEach(impliedGlobal => {

			// console.log(impliedGlobal);

			let definitionModuleMDGNode = this.retrieveImpliedGlobalDefinitionModule(impliedGlobal);

			if(definitionModuleMDGNode === null) {

				//the definition module of impliedGlobal is not retrieved (case: jugglingdb, railway) - 
				//do not consider impliedGlobal for transformation
				return;
			}

			console.log(`Definition for ${impliedGlobal.variableName} is introduced in ${definitionModuleMDGNode.representedModule.fileName}`);

			//create an MDG edge that models the definition of impliedGlobal (the adjacent node
			//is the definitionModuleMDGNode itself)
			let outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ImpliedGlobalDefinition, impliedGlobal, []);

			let adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
					
			//add adjacentNode to adjacentNodeList
			definitionModuleMDGNode.addAdjacentNodeToList(adjacentNode);

			// console.log(definitionModuleMDGNode.representedModule.fileName);

			//insert implied global import MDG edges for the modules referencing impliedGlobal
			//(exclude definitionModuleMDGNode)
			let refModuleMDGNodes = this.nodeList.filter(mdgNode => {

				// return mdgNode !== definitionModuleMDGNode;

				return mdgNode.representedModule.fileName !== 
						definitionModuleMDGNode.representedModule.fileName;
			});

			// console.log(refModuleMDGNodes.length + '\n');

			refModuleMDGNodes.forEach(mdgNode => {

				// console.log(mdgNode.representedModule.fileName + ' ' + impliedGlobal.variableName);
				// let impliedImportEdgeObjects = [];
				let usedImpliedGlobal;

				// let refImplieds = mdgNode.representedModule.impliedGlobals.filter(impliedGlob => {

				// 	return impliedGlob.variableName === impliedGlobal.variableName &&
				// 			impliedGlob.isDefined === false;
				// });

				//does module reference impliedGlobal?
				let refImplieds = mdgNode.representedModule.usedImpliedGlobals.filter(usedImplied => {

					// console.log(usedImplied)
					return usedImplied.moduleDefinition.variableName === impliedGlobal.variableName;
				});

				let relativePath = path.relative(path.dirname(mdgNode.representedModule.fileName) + "\\", definitionModuleMDGNode.representedModule.fileName);
	
				if(relativePath.startsWith('.') === false) {
			
					//the modules specified by mdgNode and definitionModuleMDGNode are in the same directory
					relativePath = '.\\' + relativePath;
				}

				// console.log(refImplieds.length)
				if(refImplieds.length > 0) {

					//create an MDG edge modelling the reference
					refImplieds.forEach(refImplied => {
		
						if(refImplied.elementUsages.length === 0) {
			
							return;
						}

						//module references implied global 
						//(thus, impliedGlobal's refs are actually uses of impliedGlobal)
						//create an ImportedElement object for that fact
						//(the definition module of an implied global is determined
						//after the MDG construction)
						usedImpliedGlobal = new ImportedElement.ImportedElement(impliedGlobal.variableName, relativePath);
						usedImpliedGlobal.updateModuleDefinition(impliedGlobal);
						usedImpliedGlobal.updateElementDeclarationNode(impliedGlobal.creationStatement);
						usedImpliedGlobal.updateElementUsages(refImplied.elementUsages);
						usedImpliedGlobal.updateReferencesImpliedGlobal(true);

						// console.log(mdgNode.representedModule.fileName + ' ' + usedImpliedGlobal.elementUsages.length);
						// console.log(usedImpliedGlobal.elementUsages);

						//initialize outgoing MDG edge (implied global use/modification)
						let outgoingEdge;
						if(refImplied.isAssigned === true) {

							outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ImpliedGlobalModification, usedImpliedGlobal, usedImpliedGlobal.elementUsages);
						}
						else {

							outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ImpliedGlobalImport, usedImpliedGlobal, usedImpliedGlobal.elementUsages);
						}

						// console.log(outgoingEdge);
						// console.log(outgoingEdge.usageSet);

						adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
						
						//add adjacentNode to adjacentNodeList
						mdgNode.addAdjacentNodeToList(adjacentNode);
					});
				}

				//does module define impliedGlobal? (till now, 
				//I didn't specify the definition module of impliedGlobal, 
				//since the MDG is needed for determining the module with the minimum fan-out)
				let defImplieds = mdgNode.representedModule.impliedGlobals.filter(impliedGlob => {

					// console.log(usedImplied)
					return impliedGlob.variableName === impliedGlobal.variableName;
				});
				
				if(defImplieds.length === 0) {

					return;
				}

				//create an MDG edge modelling the reference
				defImplieds.forEach(defImplied => {
	
					if(defImplied.elementUsages.length === 0) {
		
						return;
					}

					//module references implied global 
					//(thus, impliedGlobal's refs are actually uses of impliedGlobal)
					//create an ImportedElement object for that fact
					//(the definition module of an implied global is determined
					//after the MDG construction)
					usedImpliedGlobal = new ImportedElement.ImportedElement(impliedGlobal.variableName, relativePath);
					usedImpliedGlobal.updateModuleDefinition(impliedGlobal);
					usedImpliedGlobal.updateElementDeclarationNode(impliedGlobal.creationStatement);
					usedImpliedGlobal.updateElementUsages(defImplied.elementUsages);
					usedImpliedGlobal.updateReferencesImpliedGlobal(true);

					// console.log(mdgNode.representedModule.fileName + ' ' + usedImpliedGlobal.elementUsages.length);
					// console.log(usedImpliedGlobal.elementUsages);

					//initialize outgoing MDG edge (implied global use/modification)
					let outgoingEdge;
					if(defImplied.isAssigned === true) {

						outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ImpliedGlobalModification, usedImpliedGlobal, usedImpliedGlobal.elementUsages);
					}
					else {

						outgoingEdge = new MDGEdge.MDGEdge(moduleDependencyEnum.ModuleDependency.ImpliedGlobalImport, usedImpliedGlobal, usedImpliedGlobal.elementUsages);
					}

					// console.log(outgoingEdge);
					// console.log(outgoingEdge.usageSet);

					adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
					
					//add adjacentNode to adjacentNodeList
					mdgNode.addAdjacentNodeToList(adjacentNode);
				});

			});

		});
	};

	/**
	 * Updates the MDG nodes with GlobalObjectPropertyUse/GlobalObjectPropertyModification edges
	 * (edges representing uses/modifications of global object properties).
	 */
	this.introduceGlobalObjectPropertyHandlingEdges = function() {

		var that = this;

		//for each MDG node (representing a module)...
		this.nodeList.forEach(function(mdgNode) {

			var representedModule = mdgNode.representedModule;

			//...retrieve MDG edges involving the management (read/write) of global object properties
			var outgoingEdgeObjects = mdgNode.retrieveGlobalObjectPropertyEdges();

			// console.log(mdgNode.representedModule.fileName + " " + outgoingEdgeObjects.length);

			outgoingEdgeObjects.forEach(function(outgoingEdgeObject) {

				let outgoingEdge = outgoingEdgeObject.outgoingEdge;

				//retrieve the global property that is referenced by outgoingEdge
				let accessedElement = outgoingEdge.accessedElement;

				//retrieve the definition module of accessedElement
				//(the definition module is represented by an MDG node that has itself as an adjacent node
				//due to the existence of a GlobalObjectPropertyDefinition)
				let definitionModuleMDGNode = that.retrieveMDGNodeWithGlobalObjectPropertyDefinitionEdge(accessedElement);

				// console.log(accessedElement.elementName + " " + definitionModuleMDGNode.representedModule.fileName);

				//(i) do not consider edges that represent dependencies due to GOP that are not defined explicitly in the system
				//(ii) do not consider GOPM edges that actually represent GOP definitions
				//(case: a module that defines a global property, modifies it [check is the statement introduces a GOPD dependency
				//by its 'coordinates' (start/end line/column)])
				if(definitionModuleMDGNode === null || 
				   (outgoingEdgeObject.outgoingEdge.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyModification && 
					mdgNode.representedModule.fileName === definitionModuleMDGNode.representedModule.fileName && 
					definitionModuleMDGNode.doesStatementIntroduceAGOPDDependency(outgoingEdgeObject.outgoingEdge) === true)) {

					//accessedElement is not defined in any module
					//proceed to the next MDG edge
					return;
				}

				// console.log(outgoingEdgeObject);
				// console.log(definitionModuleMDGNode.adjacencyList);

				//definitionModuleMDGNode is the adjacent node of mdgNode
				//(the module represented by mdgNode uses/modifies the global object property 
				//defined in the module represented by definitionModuleMDGNode)
				var adjacentNode = new AdjacentNode.AdjacentNode(definitionModuleMDGNode, outgoingEdge);
					
				//add adjacentNode to adjacentNodeList
				mdgNode.addAdjacentNodeToList(adjacentNode);
			});
		});
	}

	/**
	 * Retrieves the definition module of the global object property specified by property
	 * and returns the MDG node that represents it.
	 */
	this.retrieveGlobalObjectPropertyDefinitionModule = function(property) {

		//filter MDG node list by modifications of globalProperty
		var globalPropertyModificationModules = this.nodeList.filter(function(mdgNode) {

			//filter global object properties by name and if they are modified
			//(return the set of the properties that have the same name with property and are modified)
			var modifiedGlobalObjectProperties = mdgNode.representedModule.globalObjectProperties.filter(function(globalProperty) {

				return globalProperty.elementName === property.elementName && globalProperty.isAssigned === true;
			});

			// console.log(modifiedGlobalObjectProperties.length > 0);
			
			//return mdgNode in the case that it modified a global property with the same name with property
			return modifiedGlobalObjectProperties.length > 0;
		});

		if(globalPropertyModificationModules.length === 0) {

			return null;
		}

		// console.log(globalPropertyModificationModules);
		
		//from the modules (MDG nodes) that modify property, retrieve the module that has the min fan-out
		//(the minimum number of adjacent nodes => import statements (calls to require()) - 
		//this module will keep the variable definition after the application of the refactoring)
		var globalPropertyDefinitionModuleMDGNode = globalPropertyModificationModules.reduce(function(mdgNodeWithMinFanOut, mdgNode) {

			// return (mdgNodeWithMinFanOut.adjacencyList.length >= mdgNode.adjacencyList.length ? mdgNode : mdgNodeWithMinFanOut)

			return (mdgNodeWithMinFanOut.representedModule.importStatements.length > mdgNode.representedModule.importStatements.length ? 
						mdgNode : mdgNodeWithMinFanOut);

		}, globalPropertyModificationModules[0]);

		return globalPropertyDefinitionModuleMDGNode;
	};

	/**
	 * Retrieves the definition module of the global object property specified by property
	 * and returns the MDG node that represents it.
	 */
	this.retrieveImpliedGlobalDefinitionModule = function(impliedGlobal) {

		//the definition module of impliedGlobal is the module with
		//the minimum fan-out (the minimum import statements)

		//retrieve the modules assigning a value to impliedGlobal
		let modulesModifyingImpliedGlobal = this.nodeList.filter(mdgNode => {

			let representedModule = mdgNode.representedModule;

			if(representedModule == undefined) {

				return false;
			}

			let modImplieds = representedModule.impliedGlobals.filter(modImplied => {

				return modImplied.isAssigned === true &&
						modImplied.variableName === impliedGlobal.variableName;
			});

			if(modImplieds.length > 0) {

				return true;
			}

			return false;
		});

		// console.log(impliedGlobal.variableName + " " +modulesModifyingImpliedGlobal.length)

		//sort the modules according to their imported element's (statements) number
		//(ascending order)
		modulesModifyingImpliedGlobal.sort((mdgNodeA, mdgNodeB) => {

			let moduleA = mdgNodeA.representedModule;
			let moduleB = mdgNodeB.representedModule;

			return moduleA.importedElements.length > moduleB.importedElements.length;
		});

		let definitionModule = modulesModifyingImpliedGlobal.length === 0 ? null : modulesModifyingImpliedGlobal[0];
		if(definitionModule === null) {

			return null;
		}

		// console.log(definitionModule);

		//update definitionModule with the fact that it will define implied global
		//after the refactoring
		let defModimpliedGlobals = definitionModule.representedModule.impliedGlobals.filter(defImplied => {

			return defImplied.variableName === impliedGlobal.variableName;
		});

		if(defModimpliedGlobals.length === 0) {

			return null;
		}

		defModimpliedGlobals[0].updateIsDefined(true);

		return definitionModule;

		// return modulesModifyingImpliedGlobal.length === 0 ? null : modulesModifyingImpliedGlobal[0];
	};

	/**
	 * Detects the GlobalObjectPropertyDefinition edge that references the global
	 * property specified by property and returns the incoming MDG node.
	 */
	this.retrieveMDGNodeWithGlobalObjectPropertyDefinitionEdge = function(property) {

		var definitionModuleMDGNodes = this.nodeList.filter(function(mdgNode) {

			//retrieve adjacency list of mdgNode
			let adjacencyList = mdgNode.adjacencyList;

			//filter adjacencyList by MDG edge type and specified property
			let definitionModuleMDGNodes = adjacencyList.filter(function(adjacentNode) {

				//return the MDG nodes representing modules that contain a GlobalObjectPropertyDefinition edge
				//that specifies property
				// console.log(adjacentNode);
				return adjacentNode.moduleDependency.edgeType === moduleDependencyEnum.ModuleDependency.GlobalObjectPropertyDefinition &&
					   adjacentNode.moduleDependency.accessedElement.elementName === property.elementName;
			});

			// console.log(definitionModuleMDGNodes.length);
			if(definitionModuleMDGNodes.length === 0) {

				//mdgNode has not an adjacentNode that gets connected with a GlobalObjectPropertyDefinition edge
				//do not append mdgNode in the property's definition module set
				return false;
			}

			//mdgNode has an adjacentNode that gets connected with a GlobalObjectPropertyDefinition edge
			//append mdgNode in the property's definition module set
			return true;
		});

		if(definitionModuleMDGNodes.length === 0) {

			return null;
		}

		//GlobalObjectPropertyDefinition edges have the same incoming and outgoing nodes
		//(they form MDG circles) - return the incoming node
		return definitionModuleMDGNodes[0];
	};
	
	/**
	 * retrieves MDG node representing sourceFile.
	 */
	this.retrieveMDGNodeRepresentingModule = function(sourceFile) {
		
		var mdgNode;
		for(var nodeIndex = 0; nodeIndex < this.nodeList.length; nodeIndex++) {
			
			mdgNode = this.nodeList[nodeIndex];
			if(mdgNode.representedModule === sourceFile) {
				
				//mdgNode represents sourceFile
				//return mdgNode
				return mdgNode;
			}
		}
		
	};
	
	/**
	 * Prints the MDG (debug helper function)
	 */
	this.printMDGToFile = function() {
		
		console.log('Printing MDG of system to file...');
		var result = "";
		this.nodeList.forEach(function(mdgNode) {
			
			// console.log(mdgNode);
			result += mdgNode.dumpMDGNode();
		});
		
		// fs.writeFileSync('./resultFiles/mdg', result, 'utf-8');

		fs.writeFileSync('./resultFiles/' + this.modelledProject + '_mdg', result, 'utf-8');

		console.log('Printed MDG to file.');
	};
	

	function extractNodeName(projectName, fileName){
		let nodeName = fileName
		let segs = nodeName.split(projectName)
		nodeName = segs[segs.length - 1]
		nodeName = nodeName.slice(1)
		nodeName = nodeName.replace(/\\/g, "|")
		return nodeName
	}

	/**
	 * Updates the cohesion of imported definitions throughout the analysed project
	 * (needed in order to determine whether imported and re-exported object should be destructured
	 * during export or not).
	 */
	this.updateCohesionOfImportedDefinitions = function() {

		let exploredNodes = [];

		this.nodeList.forEach(mdgNode => {

			let mdgNodeStack = [];

			//push mdgNode to stack
			mdgNodeStack.push(mdgNode);

			exploredNodes.push(mdgNode);
			
			// console.log(mdgNode);

			// let adjacencyList = mdgNode.adjacencyList;

			// console.log(adjacencyList);

			let isImportedObjectCohesive = false;
			let exploredNode;

			while(mdgNodeStack.length !== 0) {

				//remove the first element of stack (MDG node to explore)
				exploredNode = mdgNodeStack.pop();

				//add its adjacent nodes to stack for explore
				let namespaceImportadjacentNodes = exploredNode.adjacencyList.filter(adjacentNode => {

					return adjacentNode.moduleDependency.edgeType === 'NamespaceImport';
				});

				if(namespaceImportadjacentNodes.length > 0) {

					//add the adjacent nodes (modules) of exploredNode in the stack for further exploration
					//do not consider external modules (e.g. npm packages)
					namespaceImportadjacentNodes.filter(namespaceImportadjacentNode => {

						return namespaceImportadjacentNode.node !== 'externalModule' && 
							   exploredNodes.indexOf(namespaceImportadjacentNode.node) === -1;

					}).forEach(namespaceImportadjacentNode => {

						// console.log(namespaceImportadjacentNode);
						mdgNodeStack.push(namespaceImportadjacentNode.node);

						exploredNodes.push(namespaceImportadjacentNode.node);
					});
				}

				//exploredNode has no namespace imports
				//is mdgNode exporting a cohesive object/variable/function?
				// let exportedProperties = exploredNode.representedModule.exportedProperties;
				let exportedFunctions = exploredNode.representedModule.definedFunctions.filter(definedFunction => {

					// console.log(definedFunction.functionName + ' ' + definedFunction.isExported + ' ' + definedFunction.isConstructor);
					return definedFunction.isExported === true && definedFunction.isConstructor === true;
				});

				// console.log(exploredNode.representedModule.fileName);
				// console.log(exportedFunctions)
				if(exportedFunctions.length > 0) {

					//exploredNode exports a cohesive object
					isImportedObjectCohesive = true;
					break;
				}

				let exportedVariables = exploredNode.representedModule.explicitGlobals.filter(explicitGlobal => {

					return explicitGlobal.isExported === true && explicitGlobal.isInitializedWithFunctionConstructor === true;
				});

				if(exportedVariables.length > 0) {

					isImportedObjectCohesive = true;
					break;
				}
				
			}

			if(isImportedObjectCohesive === true) {

				//exploredNode is a module that exports a cohesive object
				//update its predecessors that they export a cohesive object, in the case the imported element is exported
				// console.log(exploredNode);
				let predecessors = exploredNode.predecessors;
				// console.log(predecessors);

				updateImportedDefinitionCohesionInPredecessorsOfExploredNode(predecessors, isImportedObjectCohesive);

			}

			// console.log(isImportedObjectCohesive);

		});
	};

	/**
	 * Updates an MDG node's predecessors with the cohesion result (cohesive/non-cohesive) of the exported object,
	 * resolved through processing its definition module.
	 * @param {*} nodePredecessors 
	 * @param {*} isImportedObjectCohesive 
	 */
	function updateImportedDefinitionCohesionInPredecessorsOfExploredNode(nodePredecessors, isImportedObjectCohesive) {

		nodePredecessors.forEach(predecessor => {

			// console.log(predecessor.node.representedModule.fileName);
			// console.log(predecessor.node.predecessors.map(pred => pred.node.representedModule.fileName));

			if(predecessor.isUpdated !== undefined && predecessor.isUpdated === true) {

				return;
			}

			// console.log(predecessor.node.representedModule.fileName + ' ' + predecessor.moduleDependency.edgeType + ' ' + predecessor.moduleDependency.accessedElement.elementName);

			predecessor.moduleDependency.accessedElement.isCohesive = isImportedObjectCohesive;

			//once predecessor with respect to a specific imported namespace is updated
			//do not update it again
			predecessor.isUpdated = true;

			//also, update each predecessor's predecessors recursively
			updateImportedDefinitionCohesionInPredecessorsOfExploredNode(predecessor.node.predecessors, isImportedObjectCohesive);

			// console.log(predecessor);
		});
	}

	/**
	 * Visualizes the MDG to an image
	 * notion: graphviz needs its msi to be installed
	 * and its bin folder to be included in the path environment variable
	 */
	this.visualizeGraph = function() {

		var nodeProperties = {"shape": "box"};
		var g = graphviz.digraph("G");

		var projectPath = directory.endsWith("\\") ? directory.slice(0, directory.length - 1) : directory;
		var directoryPathSegs = projectPath.split("\\");
		var projectName = directoryPathSegs[directoryPathSegs.length - 1];
		
		//projectName = projectName.replace(".", "\\.")
		//console.log("****" + projectName + " " + directoryPathSegs.length + " " + directory)

		this.nodeList.forEach(mdgNode => {

			let nodeName = extractNodeName(projectName, mdgNode.representedModule.fileName);
			let moduleType = mdgNode.getModuleType();
			if (moduleType.isUtilityModule){

				console.log("-->" + nodeName);
			}
			
			let vslgNode = g.addNode(nodeName, nodeProperties);
	
			let localAdjacentNodes = mdgNode.adjacencyList.filter(adjacentNode => {
	
				return adjacentNode.node !== 'externalModule';
			});

			localAdjacentNodes.forEach(adjacentNode => {

				// console.log(adjacentNode.moduleDependency.accessedElement);
				// console.log(adjacentNode.moduleDependency.accessedElement);

				let numOfElRefs = adjacentNode.moduleDependency.usageSet.length;

				let accessedElement = adjacentNode.moduleDependency.accessedElement.elementName != null ? 
									  adjacentNode.moduleDependency.accessedElement.elementName : 
									  (adjacentNode.moduleDependency.accessedElement.variableName != null ?
										adjacentNode.moduleDependency.accessedElement.variableName :
										adjacentNode.moduleDependency.accessedElement.declaredSource.replace(/\\/g, "|")
										);

				accessedElement = adjacentNode.moduleDependency.edgeType + ': ' + accessedElement;
				accessedElement = '[' + accessedElement + (adjacentNode.moduleDependency.accessedElement.isCohesive === true ? ' (cohesive)' : ' (non-cohesive)') + ', ' + numOfElRefs + ']';

				let adjacentNodeName = extractNodeName(projectName, adjacentNode.node.representedModule.fileName);
				let vsldAdjNode = g.addNode(adjacentNodeName, nodeProperties);

				//visualise the edge mdgNode ---> outgoingMDGNode
				let vsldEdge = g.addEdge(vslgNode, vsldAdjNode);
				vsldEdge.set('color', 'blue');
				vsldEdge.set('label', accessedElement);

				//visualise the reverse edge (outgoingMDGNode ---> mdgNode)
				//let vsldRevEdge = g.addEdge(vsldAdjNode, vslgNode);
				//vsldRevEdge.set('color', 'blue');
			});

		});

		// Print the dot script
		// console.log(g.to_dot());

		// Set GraphViz path (if not in your path)
		g.setGraphVizPath("./");

		let imageName = this.modelledProject + '.png';

		// Generate a PNG output
		g.output("png", imageName);
		
		console.log('Visualised MDG in ' + path.resolve('./' + imageName));
	}
}

exports.ModuleDependenceGraph = ModuleDependenceGraph;