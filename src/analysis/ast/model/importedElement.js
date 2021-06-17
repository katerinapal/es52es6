/**
 * http://usejsdoc.org/
 */

var FunctionDeclaration = require('./functionDeclaration.js');
var Variable = require('./variable.js');
var AccessedProperty = require('./accessedProperty.js');
const ImpliedGlobalVariable = require('./impliedGlobalVariable.js');
const ObjectLiteral = require('./objectLiteral.js');
const ExportedProperty = require('./exportedProperty.js');
const GlobalObjectProperty = require('./globalObjectProperty.js');

const util = require('../util/util.js');

function ImportedElement(elementName, declaredSource) {
	
	this.elementName = elementName;
	this.updateElementName = function(elementName) {

		this.elementName = elementName;
	};

	this.declaredSource = declaredSource;
	
	//aliasName: variable assigned the result of the import of an element
	//(case: what if the result of require() is assigned to a variable with name different
	//to the exported element?)
	this.aliasName = null;
	this.updateAliasName = function(aliasName) {
		
		this.aliasName = aliasName;
	};

	//AST node representing the imported element's declaration (needed to resolve efferent coupling,
	//which is based on function definitions)
	this.elementDeclarationNode = null;
	this.updateElementDeclarationNode = function(elementDeclarationNode) {

		this.elementDeclarationNode = elementDeclarationNode;
	};
	
	//importedElementNode: node representing statement that imports
	//the specific imported element
	// this.importedElementNode = null;
	// this.updateImportedElementNode = function(importedElementNode) {
	
	// 	this.importedElementNode = importedElementNode;
	// };

	this.importedElementNodes = [];
	this.updateImportedElementNode = function(importedElementNode) {
	
		this.importedElementNodes.push(importedElementNode);
	};
	
	//elementUsages: AST nodes (identifiers) representing usages
	//of imported element
	this.elementUsages = [];

	//updates usages of imported element
	//also, determines whether the prototype of importedElement is accessed
	//(and, thus, importedElement is a cohesive object that should not be destructured during refactoring)
	this.updateElementUsages = function(elementUsages) {
		
		this.elementUsages = elementUsages;
		this.updateIsElementPrototypeAccessed();
	};

	this.accessedProperties = [];
	this.updateAccessedProperties = function() {

        let builtinFunctionObjectProperties = ['arguments', 'caller', 'displayName', 'length', 'name', 'prototype',
                                            'apply', 'bind', 'call', 'toSource', 'toString'];

        // console.log(this)
        let accessedProperties = [];
        let accessedProperty;

        if(this.isMappedToExportedDefinitions() === false) {

            return;
        }

		let moduleDefinition = this.moduleDefinition;
		
		// console.log(moduleDefinition);

		//for each referenced property, initialize an accessed property object
		this.elementUsages.forEach(elementUse => {

			//usage is actually a reference to the namespace object
			// console.log(importedElementUsage.value.loc);

			//in order to retrieve the accessed property, visit parent AST node (member expression whose object is importedElementUsage)
            let usageParentNode = elementUse.parentPath;
            
            // console.log(usageParentNode.value);

            if(usageParentNode.value.type !== 'MemberExpression') {

                //element accessed, not its property
				moduleDefinition.updateUsedBesidesProperties(true);
                return;
			}

			let accessedPropertyIdentifier = usageParentNode.value.property;
			// console.log(elementUse.value);
			// console.log(accessedPropertyIdentifier);

			//exclude properties with the same name with importedElement
			if(elementUse.value !== accessedPropertyIdentifier &&
				usageParentNode.value.computed === false) {

				//property is not resolved dynamically
				//if yes, any property could be referenced
                // console.log(accessedPropertyIdentifier);

                let accessedPropertyName = (accessedPropertyIdentifier.type === 'Literal') ? accessedPropertyIdentifier.value : accessedPropertyIdentifier.name;
                
                accessedProperty = new AccessedProperty.AccessedProperty(accessedPropertyName, usageParentNode.value);
                
                if(accessedProperties.some(accessedProp => {

                    return accessedProp.propertyName === accessedProperty.propertyName;
                }) === false) {

                    accessedProperties.push(accessedProperty);
                };

                // accessedProperties.push(accessedProperty);
			}
				
        });

        //update the moduleDefinitions' properties with the fact that
        //they're referenced
        if(moduleDefinition instanceof Variable.Variable === true) {

			//exportedVar is considered as a cohesive object only depending on its definition module
			//what if the variable's prototype is referenced outside its definition module
			if(moduleDefinition.isInitializedWithFunctionConstructor === false && 
				this.isElementPrototypeAccessed === true) {

				//a explictGlobal is cohesive (e.g. a constructor function)
				//in the case that its prototype is referenced at least once
				moduleDefinition.updateIsInitializedWithFunctionConstructor(true);
			}

			// console.log(moduleDefinition.variableName)
	
			//retrieve the object properties that are actually used (and, thus, need to get exported)
			//try to export only the minimum number of properties
			//for each accessed property, retrieve the referenced property
			accessedProperties.forEach(accessedProperty => {
	
				// console.log(accessedProperty)

				//access property of any type by its name
				let objectProperty = moduleDefinition.retrievePropertyByName(accessedProperty.propertyName);
	
				if(objectProperty === null) {
	
                    //object property not found - do not proceed
                    //also: moduleDefinition is used apart from its properties
                    moduleDefinition.updateUsedBesidesProperties(true);
                    
					return;
				}
	
				//object property that is used is found, mark it as exported
				objectProperty.updateIsExported(true);
			});

			return;
		}

		if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

			//moduleDefinition is considered as a constructor only depending on its definition module
            //what if the function's prototype is referenced outside its definition module
			if(moduleDefinition.isConstructor === false && 
				this.isElementPrototypeAccessed === true) {

                //exportedFunc is cohesive (e.g. a constructor function)
                //in the case that its prototype is referenced at least once
                moduleDefinition.updateIsConstructor(true);
            }

            //retrieve the properties that are actually used 
            //(and, thus, need to get exported)
            //try to export only the minimum number of properties
            accessedProperties.forEach(accessedProperty => {

                // console.log(accessedProperty);
                //access property by its name (regardless of its type)
                let functionProperty = moduleDefinition.retrievePropertyByName(accessedProperty.propertyName);

                // console.log(functionProperty);

                if(functionProperty === null) {

                    //object property not found - do not proceed
                    //also: moduleDefinition used besides its properties
                    moduleDefinition.updateUsedBesidesProperties(true);

                    return;
                }

                //object property that is used is found, mark it as exported
                functionProperty.updateIsExported(true);

                // console.log(objectProperty);
            });
		}
        
        this.accessedProperties = accessedProperties;

        // console.log(this.elementName);
        // console.log(this.accessedProperties);
    };

	this.isCohesive = false;
	this.updateIsCohesive = function(isCohesive) {

		this.isCohesive = isCohesive;
	};

	this.isElementPrototypeAccessed = false;
	this.updateIsElementPrototypeAccessed = function() {

		let elementPrototypeReferences = this.elementUsages.filter(elementUsage => {

			return elementUsage.parentPath.value.type === 'MemberExpression' &&
				   elementUsage.parentPath.value.property.type === 'Identifier' && elementUsage.parentPath.value.property.name === 'prototype';
		});

		//at least 1 reference accesses the element's prototype
		//importedElement is a cohesive object
		this.isElementPrototypeAccessed = (elementPrototypeReferences.length > 0) ? true : false;
	};
	
	this.isImportedElementExportedViaModuleExports = false;
	this.updateIsImportedElementExportedViaModuleExports = function(isImportedElementExportedViaModuleExports) {

		this.isImportedElementExportedViaModuleExports = isImportedElementExportedViaModuleExports;
	};

	//is importedElement a property of the feature modelling (assigned with) the module object?
	//useful for specifying whether imported element is a property that
	//(a) is bound to the feature assigned with the module object (and thus might be exported through this feature)
	//(b) is bound to the module object only (and thus might be exported itself)
	//(applies to CJS and imported elements that are of property type)
	this.impElBoundToFeatAssignedWithModObj = false;
	this.updateIsImportedElementBoundToFeatureAssignedWithModuleObject = function(isImportedElementBoundToFeatureAssignedWithModuleObject) {

		this.impElBoundToFeatAssignedWithModObj = isImportedElementBoundToFeatureAssignedWithModuleObject;
	};

	this.isModifiedThroughoutSystem = false;
	this.updateIsModifiedThroughoutSystem = function() {

		// if(this.moduleDefinition === null) {

		// 	this.isModifiedThroughoutSystem = false;
		// 	return false;
		// }

        return false;
    };

	this.dataType = null;
	this.updateIsExportedObjectOfPrimitiveType = function(dataType) {

		this.dataType = dataType;
	};

	this.isAccessedDynamically = false;
	this.updateIsAccessedDynamically = function() {

		for(let usgIndex = 0; usgIndex < this.elementUsages.length; usgIndex++) {

			let elementUsage = this.elementUsages[usgIndex];
			// console.log(elementUsage);
			if(elementUsage.parentPath.value.type === 'MemberExpression' && elementUsage.parentPath.value.computed === true) {

				//imported element is accessed dynamically (bracket notation)
				//overapproximation: consider that all properties of importedElement are used
				this.isAccessedDynamically = true;
				return;
			}
		}
	};

	this.referencesImpliedGlobal = false;
	this.updateReferencesImpliedGlobal = function(referencesImpliedGlobal) {

		this.referencesImpliedGlobal = referencesImpliedGlobal;
	};

	//pointer to the module definition that is imported
	//(type: Variable | 
	// FunctionDeclaration | 
	// ImpliedGlobalVariable | 
	// ExportedProperty | 
	// GlobalObjectProperty)
	this.moduleDefinition = null;
	this.updateModuleDefinition = function(moduleDefinition) {

		this.moduleDefinition = moduleDefinition;
	};

	/**
     * Is imported element specifying a feature (property) named propertyName?
     * @param {*} propertyName the property's name
     */
    this.importedFeatureSpecifiesFeature = function(propertyName) {

		/**
         * (Search at module feature level)
         * Imported element specifies a feature/object shared/function shared property named propertyName if:
         * //(a) it is named propertyName (applied mainly in AMD and in some cases of CJS)
         * //(b) it points to a feature (variable/function/object) named propertyName
         * //(c) it points to a feature containing an object shared/function shared property named propertyName 
         *      (applies based on cases of feature, see below)
        */

		// console.log(this.elementName + ' ' + propertyName);

		//is importedELement pointing to a module feature named propertyName?
		if(this.elementName === propertyName) {

			return true;
		}

		//importedElement not mapped in a module feature (an import of external module/library)
		if(this.moduleDefinition === null) {

			return false;
		}

		if(this.moduleDefinition instanceof ExportedProperty.ExportedProperty === true) {

			return this.exportedPropertyName === propertyName;
		}

		if(this.moduleDefinition instanceof GlobalObjectProperty.GlobalObjectProperty === true) {

			return this.elementName === propertyName;
		}

		if(this.moduleDefinition instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true) {

			return this.moduleDefinition.variableName === propertyName;
		}

		/** (Search at module feature static property level)
		* is imported element pointing to a module definition which
        (a) is not dynamically accessed, 
            is bound/assigned to the export object of inputFile, 
            is mapped to an object with properties that contain results of other imports,
            it's definition (import stmt) is located in a nested scope and
		(b) is not fully referenced (function parameter) and
		(c) is not imported/re-exported and
		(d) is a function constructor with object properties (specified differently in variable/functionDeclaration), 
		(may be destructured after ref), check also propertyName against its properties
        (otherwise: prevent checking if at least one of the above conditions do not apply)
        (b-d specified in the imported feature's mapped definition: information that should be
        accessed by all the system's modules. If they apply at 1 module, 
        the other modules need to know it for not breaking the transformed system)
        */

		//(a) specified in imported element itself (no cascades to the other modules)
        if(this.isAccessedDynamically === true ||
            this.boundToExportedDefinition === true ||
            this.mappedToObjectWithPropertiesInitializedWithImportedDefs() === true ||
            this.isNested === true) {

            return false;
        }

		//b-c
		// if(this.moduleDefinition.isObjectReferenced === true ||
		// 	(this.moduleDefinition.isImportedAndReexported === undefined ||
		// 	 this.moduleDefinition.isImportedAndReexported === true)) {

		// 	return false;
		// }

		if(this.moduleDefinition.isObjectReferenced === true ||
			 this.moduleDefinition.isImportedAndReexported === true) {

			return false;
		}

		if((this.moduleDefinition instanceof Variable.Variable === true &&
			this.moduleDefinition.objectProperties.length > 0) ||
			this.moduleDefinition instanceof ObjectLiteral.ObjectLiteral === true) {

			return this.moduleDefinition.retrieveObjectPropertyByName(propertyName) != null;
		}

		//moduleDefinition is a FunctionDeclaration
		// console.log(this.moduleDefinition)
		if(this.moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true &&
			this.moduleDefinition.functionProperties.length > 0) {

			return this.moduleDefinition.retrieveFunctionPropertyByName(propertyName) != null;
		}

		return false;
		// return this.moduleDefinition.retrieveFunctionPropertyByName(propertyName) != null;
    };

	this.isMappedToImportedAndReexportedDefinitions = function() {

		if(this.moduleDefinition === null) {

			return false;
		}

		return this.moduleDefinition.isImportedAndReexported;
	};

	/**
     * Is element mapped to a set of exported definitions?
     */
    this.isMappedToExportedDefinitions = function() {

        return this.moduleDefinition !== null;
    };

	/**
	 * Generates an object containing analysis information for the imported element.
	 * Needed for debugging purposes.
	 * @param inputFile the file importing the feature
	 * @param importFile the imported feature's definition module
	 */
	this.getImportedElementObject = function(inputFile, importFile) {

		//minimize nodes explicitly (imported element mapped to the actual feature)
		let obj = {};
		obj.elementName = this.elementName;
        obj.aliasName = this.aliasName;
		obj.declaredSource = this.declaredSource;
		obj.isObjectReferenced = this.moduleDefinition.isObjectReferenced;
		obj.importedElementNodes = this.importedElementNodes.map(importedElementNode => util.minimizeNode(importedElementNode));
		// obj.importedElementNodes = this.importedElementNodes.map(importedElementNode => importedElementNode.value);
		obj.moduleDefinition = {};
		obj.elementUsages = this.elementUsages.map(elementUsage => util.minimizeNode(elementUsage));
		// obj.elementUsages = this.elementUsages.map(elementUsage => elementUsage.value);

		let moduleDefinition = this.moduleDefinition;
		
		//an imported element might be either a function or a variable
		if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

			obj.moduleDefinition.type = 'function';
			obj.moduleDefinition.name = moduleDefinition.functionName;
			obj.moduleDefinition.definitionNode = util.minimizeNode(moduleDefinition.functionNode);
			// obj.moduleDefinition.definitionNode = moduleDefinition.functionNode.value;

			//an function is cohesive when (a) it is a function constructor or (b) it is referenced outside member expressions (e.g. it is iterated)
			obj.moduleDefinition.isCohesive = moduleDefinition.isConstructor === true ? 
												moduleDefinition.isConstructor : 
												moduleDefinition.isObjectReferenced;
		
			//properties bound to the object's prototype

			// FunctionProperty
			obj.moduleDefinition.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				let protProp = prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
				return util.minimizeProperty(protProp);

				// return prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
			});

			//properties bound to the object's instances

			// FunctionProperty
			obj.moduleDefinition.functionConstructorProperties = moduleDefinition.functionConstructorProperties.map(constructorProperty => {

				let constrProp = constructorProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
				return util.minimizeProperty(constrProp);

				// return constructorProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
			});

			//properties bound to the object (these may be detached from the object during refactoring)
			//renamed to objectProperties for name compliance

			// FunctionProperty
			obj.moduleDefinition.objectProperties = moduleDefinition.functionProperties.map(functionProperty => {

				let funcProp = functionProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
				return util.minimizeProperty(funcProp);

				// return functionProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
			});

		}
		else if(moduleDefinition instanceof Variable.Variable === true) {

			obj.moduleDefinition.type = 'variable';
			obj.moduleDefinition.name = moduleDefinition.variableName;
			obj.moduleDefinition.definitionNode = util.minimizeNode(moduleDefinition.variableDeclarationNode);
			// obj.moduleDefinition.definitionNode = moduleDefinition.variableDeclarationNode.value;

			//a variable is cohesive when (a) it is a function constructor or (b) it is referenced outside member expressions (e.g. it is iterated)
			obj.moduleDefinition.isCohesive = moduleDefinition.isInitializedWithFunctionConstructor === true ? 
												moduleDefinition.isInitializedWithFunctionConstructor : 
												moduleDefinition.isObjectReferenced;

			//properties bound to the object's prototype

			// ObjectProperty
			obj.moduleDefinition.prototypeProperties = moduleDefinition.prototypeProperties.map(prototypeProperty => {

				// console.log(prototypeProperty);
				let protProp = prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
				return util.minimizeProperty(protProp);

				// return prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
			});

			//properties bound to the object (these may be detached from the object during refactoring)
			
			// ObjectProperty
			obj.moduleDefinition.objectProperties = moduleDefinition.objectProperties.map(objectProperty => {

				let objProp = objectProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
				return util.minimizeProperty(objProp);

				// return objectProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
			});
		}

		return obj;
	};

	//is importedElement (result of import) bound to the export object
	//of the module importing importedElement?
	this.boundToExportedDefinition = false;
    this.updateIsBountToExportedDefinition = function(boundToExportedDefinition) {

        this.boundToExportedDefinition = boundToExportedDefinition;
	};
	
	/**
	 * An importedElement with properties initialized with imports (require())
	 * is not destructured during refactoring. Thus, since its properties are
	 * not imported, no renamings are performed.
	 */
	this.mappedToObjectWithPropertiesInitializedWithImportedDefs = function() {

		if(this.moduleDefinition === null) {

			return false;
		}

		return this.moduleDefinition.hasBoundPropertiesInitializedWithImportDefs;
	};

	//is importedElement's definition (import statement) located in a nested scope?
	this.isNested = false;
    this.updateIsNested = function() {

        for(let nodeIndex = 0; nodeIndex < this.importedElementNodes.length; nodeIndex++) {

			let elNode = this.importedElementNodes[nodeIndex];
            let parentNode = elNode.parentPath;
            while(parentNode !== null) {
                
                // console.log(parentNode.value instanceof Array);
                // console.log(parentNode);
                if(parentNode.value.type === 'BlockStatement' ||
                parentNode.value.type === 'ArrayExpression' ||
				parentNode.value.type === 'ObjectExpression' ||
				parentNode.value.type === 'CallExpression' ||
				parentNode.value.type === 'LogicalExpression') {

                    //import statement nested inside block statement
                    this.isNested = true;
                    return;
                }
                else if(parentNode.value instanceof Array && parentNode.parentPath.value.type === 'VariableDeclaration') {

                    //import statement inside a variable declaration
                    this.isNested = false;
                    return;
                }
                parentNode = parentNode.parentPath;
            }

        };

        this.isNested = false;
    };


	// /**
	//  * Determines whether importedElement is included in export object
	//  * (needed for its assessment, in the case that it has no references).
	//  */
	// this.isImportedElementIncludedInExportObject = function(jscodeshiftAPI, astRootCollection) {

	// 	//is importedElement assigned/bound to the module's export object?
	// 	//TODO update: is imported element included (assigned/bound) to an exported definition?
	// 	//thus, move to sourceFile
	// 	for(let nodeIndex = 0; nodeIndex < this.importedElementNodes.length; nodeIndex++) {
	
	// 		let importedElementNode = this.importedElementNodes[nodeIndex];
	// 		let nodeLoc = importedElementNode.value.loc;
	// 		let requireCalls = astRootCollection.find(jscodeshiftAPI.CallExpression).filter(callExp => {
	
	// 			let callExpLoc = callExp.value.loc;
	// 			if(callExpLoc === null) {
	
	// 				return false;
	// 			}
	
	// 			return callExpLoc.start.line === nodeLoc.start.line && callExpLoc.start.column === nodeLoc.start.column &&
	// 					callExpLoc.end.line === nodeLoc.end.line && callExpLoc.end.column === nodeLoc.end.column;
	// 		});
	
	// 		if(requireCalls.length > 0) {
	
	// 			let requireCall = requireCalls.at(0).get();
	// 			let expressionStatement = requireCall;
	// 			while(expressionStatement !== null) {
	
	// 				if(expressionStatement.value.type === 'ExpressionStatement') {
	
	// 					break;
	// 				}
						
	// 				expressionStatement = expressionStatement.parentPath;
	// 			}
	
	// 			if(expressionStatement !== null) {
	
	// 				//requireCall inside an expression statement
	// 				//does this expression statement contain a reference to the module's export object?
	// 				let exportObjRefs = jscodeshiftAPI(expressionStatement).find(jscodeshiftAPI.Identifier).filter(node => {
	
	// 					return node.value.name === 'exports';
	// 				});
	
	// 				if(exportObjRefs.length > 0) {
	
	// 					//importedElement assinged/bound to exports
	// 					return true;
	// 				}
	
	// 				exportObjRefs = jscodeshiftAPI(expressionStatement).find(jscodeshiftAPI.MemberExpression).filter(node => {
	
	// 					return node.value.object.type === 'Identifier' && node.value.object.name === 'module' &&
	// 							node.value.property.type === 'Identifier' && node.value.property.name === 'exports';
	// 				});
	
	// 				if(exportObjRefs.length > 0) {
	
	// 					//importedElement assigned/bound to module.exports
	// 					return true;
	// 				}
	
	// 				return false;
	// 			}
	// 		}
	// 	}
		
	// 	return false;
	// }

	this.compare = function(importedElement) {

		if(this.elementName === importedElement.elementName &&
		   this.declaredSource === importedElement.declaredSource) {

			return true;
		}

		return false;
	};
}

exports.ImportedElement = ImportedElement;