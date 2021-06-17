/**
 * ImportedNamespace function. Representing an ES6 import statement of a module
 * (syntax: import * as <variable> from <modulePath>).
 */

let AccessedProperty = require('./accessedProperty.js');
let ExportedProperty = require('./exportedProperty.js');
let ObjectLiteral = require('./objectLiteral.js');

const util = require('../util/util.js');

 function ImportedNamespace(namespaceName, importedSource) {

    //aliasName: the name of the variable assigned with the result of require()
    this.elementName = namespaceName;
    this.aliasName = namespaceName;
    this.declaredSource = importedSource;
    this.elementDeclarationNode = null;

    this.updateAliasName = function(aliasName) {

        this.aliasName = aliasName;
    };

    this.updateElementDeclarationNode = function(elementDeclarationNode) {

        this.elementDeclarationNode = elementDeclarationNode;
    };

    //importedElementNode: AST node representing import of the imported namespace
    this.importedElementNodes = [];
    this.updateImportedElementNodes = function(importedElementNode) {

        this.importedElementNodes.push(importedElementNode);
    };

    //elementUsages: AST nodes representing usages of importedNamespace
    this.elementUsages = [];

    //updates usages of imported element
	//also, determines whether the prototype of importedElement is accessed
	//(and, thus, importedElement is a cohesive object that should not be destructured during refactoring)
	this.updateElementUsages = function(elementUsages) {
		
		this.elementUsages = elementUsages;
		this.updateIsElementPrototypeAccessed();
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
	}

    //is importedNamespace a property of the feature modelling (assigned with) the module object?
	//useful for specifying whether imported element is a property that
	//(a) is bound to the feature assigned with the module object (and thus might be exported through this feature)
	//(b) is bound to the module object only (and thus might be exported itself)
	//(applies to CJS and imported elements that are of property type)
	this.impElBoundToFeatAssignedWithModObj = false;
	this.updateIsImportedElementBoundToFeatureAssignedWithModuleObject = function(isImportedElementBoundToFeatureAssignedWithModuleObject) {

		this.impElBoundToFeatAssignedWithModObj = isImportedElementBoundToFeatureAssignedWithModuleObject;
	};

    // this.isImportedElementExportedViaModuleExports = false;
	// this.updateImportedElementExportStatementType = function(isImportedElementExportedViaModuleExports) {

	// 	this.isImportedElementExportedViaModuleExports = isImportedElementExportedViaModuleExports;
    // };

    // this.dataType = null;
    // this.updateIsExportedObjectOfPrimitiveType = function(exportedObject) {

    //     // console.log(exportedObject);

    //     if(exportedObject.type === 'property') {

    //         //in the case that exported property has no object properties,
    //         //import exported property instead
    //         this.dataType = (exportedObject.objectProperties > 0) ? exportedObject.type : 'variable';
    //     }
    //     else {

    //         this.dataType = exportedObject.type;
    //     }

    //     if(exportedObject.type === 'variable' || exportedObject.type === 'function') {

    //         this.elementName = exportedObject.elementName;
    //     }
    // };

    this.isAccessedDynamically = false;
	this.updateIsAccessedDynamically = function() {

        // console.log(this);
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
        
        // console.log(this.elementName + ' ' + this.isAccessedDynamically);
    };

    /**
	 * An importedNamespace with properties initialized with imports (require())
	 * is not destructured during refactoring. Thus, since its properties are
	 * not imported, no renamings are performed.
	 */
    this.mappedToObjectWithPropertiesInitializedWithImportedDefs = function() {

        if(this.isMappedToExportedDefinitions() === false) {

            return false;
        }

        let variablesWithPropertiesInitializedWithImportDefs = this.moduleDefinitions.exportedVariables.filter(exportedVar => {

            return exportedVar.hasBoundPropertiesInitializedWithImportDefs === true;
        });

        let functionsWithPropertiesInitializedWithImportDefs = this.moduleDefinitions.exportedFunctions.filter(exportedFunc => {

            return exportedFunc.hasBoundPropertiesInitializedWithImportDefs === true;
        });

        if(variablesWithPropertiesInitializedWithImportDefs.length > 0 ||
            functionsWithPropertiesInitializedWithImportDefs.length > 0) {

            return true;
        }

        return false;

	};
    
    this.referencesImpliedGlobal = false;

    // /**
	//  * Determines whether importedElement is included in export object
	//  * (needed for its assessment, in the case that it has no references).
	//  */
	// this.isImportedElementIncludedInExportObject = function(jscodeshiftAPI, astRootCollection) {

	// 	//is importedElement assigned/bound to the module's export object?
	// 	for(let nodeIndex = 0; nodeIndex < this.importedElementNodes.length; nodeIndex++) {
	
    //         let importedElementNode = this.importedElementNodes[nodeIndex];
    //         // console.log(importedElementNode);
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

    /**
     * Function that compares two namespaces.
     * Needed in cases when the same module is imported multiple times (within multiple function definitions).
     * (This function prevents introducing the same namespace twice.)
     */
    this.compare = function(namespace) {

        //two namespaces are identical if they have the same elementName and declaredSource
        //in the case that a namespace is imported multiple times,
        //after refactoring it is imported once (ES6 spec does not allow multiple imports of
        //an object)
        //the other import is replaced with the imported definition
        if(this.elementName === namespace.elementName &&
        //    this.aliasName === namespace.aliasName &&
           this.declaredSource === namespace.declaredSource) {

            return true;
        }

        return false;
    };

    //pointer to the module definitions that are imported
    //(type: variable assigned to the export object | functionDeclaration assigned to the export object | definition bound to the export object)
    //notice: they are 1..n, since the exported object might have [1,n] properties
    /**
     * this.moduleDefinitions: {
        exportedVariables: Variable[],
        exportedFunctions: FunctionDeclaration[],
        exportedProperties: ExportedProperty[] (CommonJS) | ObjectLiteral[] (AMD)
    }
     */
    this.moduleDefinitions = {

        exportedVariables: [],
        exportedFunctions: [],
        exportedProperties: []
    };
    this.updateModuleDefinitions = function(moduleDefinitions) {

        // console.log(moduleDefinitions);

        // moduleDefinitions.exportedVariables.map(exportedVar => {

        //     console.log(exportedVar.variableName + ' ' + exportedVar.isObjectReferenced);
        // })

        // this.moduleDefinitions = moduleDefinitions;

        //do not update with null or empty objects
        this.moduleDefinitions = moduleDefinitions == null || 
                                 Object.keys(moduleDefinitions).length === 0 ?
                                 this.moduleDefinitions :
                                 moduleDefinitions;
    };

    /**
     * Is imported namespace specifying a feature (property) named propertyName?
     * @param {*} propertyName the property's name
     */
    this.importedFeatureSpecifiesFeature = function(propertyName) {

        /**
         * (Search at module feature level)
         * Imported namespace specifies a feature/object shared/function shared property named propertyName if:
         * //(a) it is named propertyName (applied mainly in AMD and in some cases of CJS)
         * //(b) it points to a feature (variable/function/object) named propertyName
         * //(c) it points to a feature containing an object shared/function shared property named propertyName 
         *      (applies based on cases of feature, see below)
        */

        // console.log(this.elementName + ' ' + propertyName);

        //(a)
        if(this.elementName === propertyName) {

			return true;
        }

        //(b)
        let moduleVar = this.moduleDefinitions.exportedVariables.find(moduleDef => {

            return moduleDef.variableName === propertyName;
        });

        if(moduleVar != null) {

            return true;
        }

        let moduleFunc = this.moduleDefinitions.exportedFunctions.find(moduleFunc => {

            return moduleFunc.functionName === propertyName;
        });

        if(moduleFunc != null) {

            return true;
        }

        let moduleObjProp = this.moduleDefinitions.exportedProperties.find(moduleProp => {

            //objectLiterals (AMD) do not have names
            return moduleProp.exportedPropertyName != undefined &&
                    moduleProp.exportedPropertyName === propertyName;
        });

        if(moduleObjProp != null) {

            return true;
        }

        /** (Search at module feature static property level)
		* is imported namespace pointing to a module definition which
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

        //(a) specified in importedNamespace itself (no cascades to the other modules)
        if(this.isAccessedDynamically === true ||
            this.boundToExportedDefinition === true ||
            this.mappedToObjectWithPropertiesInitializedWithImportedDefs() === true ||
            this.isNested === true) {

            return false;
        }
        
        //(b-d)
        let moduleFeatProp = this.moduleDefinitions.exportedVariables.find(expVar => {

            if(expVar.isObjectReferenced === true ||
                expVar.isImportedAndReexported === true) {

                return false;
            }

            return expVar.retrieveObjectPropertyByName(propertyName) != null;
        });

        if(moduleFeatProp != null) {

            return true;
        }

        moduleFeatProp = this.moduleDefinitions.exportedFunctions.find(expFunc => {

            if(expFunc.isObjectReferenced === true ||
                expFunc.isImportedAndReexported === true) {

                return false;
            }

            return expFunc.retrieveFunctionPropertyByName(propertyName) != null;
        });

        if(moduleFeatProp != null) {

            return true;
        }

        moduleFeatProp = this.moduleDefinitions.exportedProperties.find(expProp => {

            // if((expProp.isObjectReferenced === undefined ||
            //     expProp.isObjectReferenced === true) ||
            //     (expProp.isImportedAndReexported === undefined ||
            //     expProp.isImportedAndReexported === true)) {

            //     return false;
            // }

            if((expProp.isObjectReferenced === undefined ||
                expProp.isObjectReferenced === true) ||
                expProp.isImportedAndReexported === true) {

                return false;
            }

            return expProp.retrieveObjectPropertyByName(propertyName) != null;
        });

        if(moduleFeatProp != null) {

            return true;
        }

        return false;
    };

    this.isMappedToImportedAndReexportedDefinitions = function() {

        if(Object.keys(this.moduleDefinitions).length === 0) {

            return false;
        }

        let importedAndReexportedDef = this.moduleDefinitions.exportedVariables.find(exportedVar => {

            return exportedVar.isImportedAndReexported === true;
        });

        if(importedAndReexportedDef !== undefined) {

            return true;
        }

        importedAndReexportedDef = this.moduleDefinitions.exportedFunctions.find(exportedFunc => {

            return exportedFunc.isImportedAndReexported === true;
        });

        if(importedAndReexportedDef !== undefined) {

            return true;
        }

        importedAndReexportedDef = this.moduleDefinitions.exportedProperties.find(exportedProp => {

            return exportedProp.isImportedAndReexported === true;
        });

        if(importedAndReexportedDef !== undefined) {

            return true;
        }

        return false;
    };

    this.isReexportedDefinitionBoundToTheExportObject = false;
    this.updateIsReexportedDefinitionBoundToTheExportObject = function(isReexportedDefinitionBoundToTheExportObject) {

        this.isReexportedDefinitionBoundToTheExportObject = isReexportedDefinitionBoundToTheExportObject;
    }

    /**
     *  update the module definitions of importedNamespace to be included in a namespace that is modified in at least 1 imported module
        NOTICE: each sourceFile has DIFFERENT objects modelling its imported namespaces
        HOWEVER: each imported namespace objects is mapped to the SAME objects modelling the imported module's exported definitions
        RESULT: update the imported module's exported definitions (aka imported namespace's mapped module definitions) with the fact that
        they are included in a namespace that might be modified (in the case that it is modified, they should NOT be destructured after refactoring,
        since a bug due to modification of the imported module's object)
     */
    this.updateNamespaceUsageInModuleDefinitions = function(isNamespaceModified) {

        // console.log(this.elementName)
        // console.log(this.moduleDefinitions);

        //do not update imported namespaces referencing
        //external npm packages
        if(this.isMappedToExportedDefinitions() === false) {

            return;
        }

        this.moduleDefinitions.exportedVariables.forEach(exportedVariable => {

            exportedVariable.updateIsIncludedInAModifiedImportedNamespace(isNamespaceModified);
        });

        this.moduleDefinitions.exportedFunctions.forEach(exportedFunction => {

            exportedFunction.updateIsIncludedInAModifiedImportedNamespace(isNamespaceModified);
        });

        this.moduleDefinitions.exportedProperties.forEach(exportedProperty => {

            exportedProperty.updateIsIncludedInAModifiedImportedNamespace(isNamespaceModified);
        });
    };

    this.isModifiedThroughoutSystem = false;

    /**
     * Is namespace modified throughout the whose analysed system?
     */
    this.updateIsModifiedThroughoutSystem = function() {

        if(Object.keys(this.moduleDefinitions).length === 0) {

            this.isModifiedThroughoutSystem = false;
            return false;
        }

        let defsIncludedInModifiedNamespace = this.moduleDefinitions.exportedVariables.filter(expVar => {

            return expVar.isIncludedInAModifiedImportedNamespace === true;
        });

        if(defsIncludedInModifiedNamespace.length > 0) {

            this.isModifiedThroughoutSystem = true;
            return true;
        }

        defsIncludedInModifiedNamespace = this.moduleDefinitions.exportedFunctions.filter(expFunc => {

            return expFunc.isIncludedInAModifiedImportedNamespace === true;
        });

        if(defsIncludedInModifiedNamespace.length > 0) {

            this.isModifiedThroughoutSystem = true;
            return true;
        }

        defsIncludedInModifiedNamespace = this.moduleDefinitions.exportedProperties.filter(expProp => {

            return expProp.isIncludedInAModifiedImportedNamespace === true;
        });

        if(defsIncludedInModifiedNamespace.length > 0) {

            this.isModifiedThroughoutSystem = true;
            return true;
        }

        this.isModifiedThroughoutSystem = false;
        return false;
    };

    /**
     * Is namespace mapped to a set of exported definitions?
     */
    this.isMappedToExportedDefinitions = function() {

        if(Object.keys(this.moduleDefinitions).length === 0) {

            //imported namespace's moduleDefinitions object is empty
            return false;
        }

        if(this.moduleDefinitions.exportedVariables.length > 0 ||
           this.moduleDefinitions.exportedFunctions.length > 0 ||
           this.moduleDefinitions.exportedProperties.length > 0) {

            return true;
        }

        return false;
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

        let exportedVariables = this.moduleDefinitions.exportedVariables;
        let exportedFunctions = this.moduleDefinitions.exportedFunctions;
        let exportedProperties = this.moduleDefinitions.exportedProperties;

		this.elementUsages.forEach(namespaceUse => {

			//usage is actually a reference to the namespace object
			// console.log(importedElementUsage.value.loc);

			//in order to retrieve the accessed property, visit parent AST node (member expression whose object is importedElementUsage)
            let usageParentNode = namespaceUse.parentPath;
            
            // console.log(usageParentNode.value);

            if(usageParentNode.value.type !== 'MemberExpression') {

                //namespace accessed, not its property
                exportedVariables.forEach(expVar => {

                    expVar.updateUsedBesidesProperties(true);
                });

                exportedFunctions.forEach(expFunc => {

                    expFunc.updateUsedBesidesProperties(true);
                });

                exportedProperties.forEach(expProp => {

                    expProp.updateUsedBesidesProperties(true);
                });


                return;
            }

            let accessedPropertyIdentifier = usageParentNode.value.property;
            
            //exclude properties with the same name with importedNamespace
            if(namespaceUse.value !== accessedPropertyIdentifier &&
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
        exportedVariables.forEach(exportedVar => {

            //exportedVar is considered as a cohesive object only depending on its definition module
			//what if the variable's prototype is referenced outside its definition module
			if(exportedVar.isInitializedWithFunctionConstructor === false && this.isElementPrototypeAccessed === true) {

				//a explictGlobal is cohesive (e.g. a constructor function)
				//in the case that its prototype is referenced at least once
				exportedVar.updateIsInitializedWithFunctionConstructor(true);
			}
	
			//retrieve the object properties that are actually used (and, thus, need to get exported)
			//try to export only the minimum number of properties
			//for each accessed property, retrieve the referenced property
			accessedProperties.forEach(accessedProperty => {
    
                // console.log(accessedProperty);
                
				//access property of any type by its name
				let objectProperty = exportedVar.retrievePropertyByName(accessedProperty.propertyName);
	
				if(objectProperty === null) {
	
                    //object property not found - do not proceed
                    //also: exportedVar is used apart from its properties
                    exportedVar.updateUsedBesidesProperties(true);
                    
					return;
				}
	
				//object property that is used is found, mark it as exported
				objectProperty.updateIsExported(true);
			});
        });

        exportedFunctions.forEach(exportedFunc => {

            //exportedFunc is considered as a constructor only depending on its definition module
            //what if the function's prototype is referenced outside its definition module
            if(exportedFunc.isConstructor === false && this.isElementPrototypeAccessed === true) {

                //exportedFunc is cohesive (e.g. a constructor function)
                //in the case that its prototype is referenced at least once
                exportedFunc.updateIsConstructor(true);
            }

            //retrieve the properties that are actually used 
            //(and, thus, need to get exported)
            //try to export only the minimum number of properties
            accessedProperties.forEach(accessedProperty => {

                // console.log(accessedProperty);
                //access property by its name (regardless of its type)
                let functionProperty = exportedFunc.retrievePropertyByName(accessedProperty.propertyName);

                // console.log(functionProperty);

                if(functionProperty === null) {

                    //object property not found - do not proceed
                    //also: exportedFunc used besides its properties
                    exportedFunc.updateUsedBesidesProperties(true);

                    return;
                }

                //object property that is used is found, mark it as exported
                functionProperty.updateIsExported(true);

                // console.log(objectProperty);
            });
        });

        exportedProperties.forEach(exportedProp => {

            accessedProperties.forEach(accessedProperty => {

                let referencedObjProps = exportedProp.objectProperties.filter(objectProp => {

                    return objectProp.propertyName === accessedProperty.propertyName;
                });

                if(referencedObjProps.length === 0) {

                    //accessedProperty not in the exported property's object properties
                    exportedProp.updateUsedBesidesProperties(true);
                }
    
                referencedObjProps.forEach(objectProp => {
    
                    objectProp.updateIsExported(true);
                });
            });
            
        });
        
        this.accessedProperties = accessedProperties;

        // console.log(this.elementName);
        // console.log(this.accessedProperties);
    };

    this.isCohesive = false;
    this.isNamespaceCohesive = function() {

        let exportedVariables = this.moduleDefinitions.exportedVariables;
        let exportedFunctions = this.moduleDefinitions.exportedFunctions;
        let exportedProperties = this.moduleDefinitions.exportedProperties;

        let cohesiveVars = exportedVariables.filter(exportedVar => {

            return exportedVar.isInitializedWithFunctionConstructor === true;
        });

        if(cohesiveVars.length > 0) {

            return true;
        }

        let cohesiveFuncs = exportedFunctions.filter(exportedFunc => {

            return exportedFunc.isConstructor === true;
        });

        if(cohesiveFuncs.length > 0) {

            return true;
        }

        let cohesiveProps = exportedProperties.filter(exportedProp => {

            return exportedProp.isCohesive === true;
        });

        if(cohesiveProps.length > 0) {

            return true;
        }

        return false;
    };

    //TODO: move to sourceFile (contains exported definitions)
    /**
     * Is imported namespace bound to an exported definition?
     * Needed to determine whether the namespace is imported after the refactoring,
     * regardless of its references.
     */
    this.boundToExportedDefinition = false;
    this.updateIsBountToExportedDefinition = function(boundToExportedDefinition) {

        this.boundToExportedDefinition = boundToExportedDefinition;
    };

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

    /**
     * Is importedNamespace mapped to module features that are used besides their properties
     * (e.g. as function invocation args?)
     */
    this.isMappedToReferencedObjects = function() {

        let expVars = this.moduleDefinitions.exportedVariables;
        let expFuncs = this.moduleDefinitions.exportedFunctions;
        let expProps = this.moduleDefinitions.exportedProperties;

        if(expVars.find(expVar => {

            return expVar.isObjectReferenced === true;

        }) !== undefined) {

            return true;
        }

        if(expFuncs.find(expFunc => {

            return expFunc.isObjectReferenced === true;

        }) !== undefined) {

            return true;
        }

        if(expProps.find(expProp => {

            return expProp.isObjectReferenced === true;

        }) !== undefined) {

            return true;
        }

        return false;
    };

    /**
	 * Generates an object containing analysis information for the imported element.
	 * Needed for debugging purposes.
     * @param inputFile the file importing the namespace
     * @param importFile the namespace's definition module
	 */
    this.getImportedNamespaceObject = function(inputFile, importFile) {

        let obj = {};
        obj.elementName = this.elementName;
        obj.aliasName = this.aliasName;
        obj.declaredSource = this.declaredSource;
        // obj.isObjectReferenced = this.isObjectReferenced;

        obj.importedElementNodes = this.importedElementNodes.map(importedElementNode => util.minimizeNode(importedElementNode));
        // obj.importedElementNodes = this.importedElementNodes.map(importedElementNode => importedElementNode.value);
        obj.moduleDefinitions = {};
        obj.elementUsages = this.elementUsages.map(elementUsage => util.minimizeNode(elementUsage));
        // obj.elementUsages = this.elementUsages.map(elementUsage => elementUsage.value);

        //applies to CommonJS/AMD
        // form:
        // {
        //   exportedVariables : [variable],
        //   exportedFunctions : [functionDeclaration],
        //   exportedProperties : [exportedProperty | objectLiteral]
        // }
        let moduleDefinitions = this.moduleDefinitions;

        if(Object.keys(moduleDefinitions).length === 0) {

            return obj;
        }

        obj.moduleDefinitions.exportedVariables = moduleDefinitions.exportedVariables.map(exportedVariable => {

            // console.log(exportedVariable.prototypeProperties);
            // console.log(exportedVariable.objectProperties);

            return {

                name: exportedVariable.variableName,
                definitionNode: util.minimizeNode(exportedVariable.variableDeclarationNode),

                // definitionNode: exportedVariable.variableDeclarationNode.value,

                //a variable is cohesive when (a) it is a function constructor or (b) it is referenced outside member expressions (e.g. it is iterated)
                isCohesive: exportedVariable.isInitializedWithFunctionConstructor === true ? 
                            exportedVariable.isInitializedWithFunctionConstructor : 
                            exportedVariable.isObjectReferenced,

                //properties bound to the object's prototype
                prototypeProperties: exportedVariable.prototypeProperties.map(prototypeProperty => {

                    // console.log(prototypeProperty)

                    // ObjectProperty
                    let protProp = prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(protProp);

                    // return prototypeProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                }),

                //properties bound to the object (these may be detached from the object during refactoring)
                objectProperties: exportedVariable.objectProperties.map(objectProperty => {

                    // ObjectProperty
                    let objProp = objectProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(objProp);

                    // return objectProperty.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                })
            };
        });

        obj.moduleDefinitions.exportedFunctions = moduleDefinitions.exportedFunctions.map(exportedFunction => {

            return {

                name: exportedFunction.functionName,
                // definitionNode: exportedFunction.functionNode.value,
                definitionNode: util.minimizeNode(exportedFunction.functionNode),

                //an function is cohesive when (a) it is a function constructor or (b) it is referenced outside member expressions (e.g. it is iterated)
                isCohesive: exportedFunction.isConstructor === true ? 
                            exportedFunction.isConstructor : 
                            exportedFunction.isObjectReferenced,
            
                //properties bound to the object's prototype
                prototypeProperties: exportedFunction.prototypeProperties.map(prototypeProperty => {

                    // FunctionProperty
                    let protProp = prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(protProp);

                    // return prototypeProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                }),

                //properties bound to the object's instances
                functionConstructorProperties: exportedFunction.functionConstructorProperties.map(constructorProperty => {

                    // FunctionProperty
                    let funcConstProp = constructorProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(funcConstProp);

                    // return constructorProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                }),

                //properties bound to the object (these may be detached from the object during refactoring)
                //renamed to objectProperties for name compliance
                objectProperties: exportedFunction.functionProperties.map(functionProperty => {

                    // FunctionProperty
                    let funcProp = functionProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(funcProp);

                    // return functionProperty.mapFunctionPropertyToImportedDefJSONObj(inputFile, importFile);
                })
            };
        });

        obj.moduleDefinitions.exportedProperties = moduleDefinitions.exportedProperties.map(exportedProperty => {

            return {

                name: exportedProperty instanceof ExportedProperty.ExportedProperty === true ? 
                        exportedProperty.exportedPropertyName :
                        (exportedProperty instanceof ObjectLiteral.ObjectLiteral === true ? 
                            exportedProperty.variableName : 
                            null),

                definitionNode: exportedProperty instanceof ExportedProperty.ExportedProperty === true ? 
                                util.minimizeNode(exportedProperty.exportStatementASTNode) : 
                                (exportedProperty instanceof ObjectLiteral.ObjectLiteral === true ? 
                                 util.minimizeNode(exportedProperty.objectExpressionASTNode) : 
                                    null),

                // definitionNode: exportedProperty instanceof ExportedProperty.ExportedProperty === true ? 
                //                 exportedProperty.exportStatementASTNode.value : 
                //                 (exportedProperty instanceof ObjectLiteral.ObjectLiteral === true ? exportedProperty.objectExpressionASTNode : null),
                
                objectProperties : exportedProperty.objectProperties.map(objectProp => {

                    // ObjectProperty
                    let objProp = objectProp.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                    return util.minimizeProperty(objProp);

                    // return objectProp.mapObjectPropertyToImportedDefJSONObj(inputFile, importFile);
                }),
                
                isCohesive: exportedProperty.isCohesive,
                isObjectReferenced: exportedProperty.isObjectReferenced
            };
        });

        return obj;
    };
 }

 exports.ImportedNamespace = ImportedNamespace;