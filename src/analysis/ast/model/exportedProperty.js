/**
 * ExportedProperty function. Representing anonymus object literals that are exported through their assignment to exports/module.exports.
 */

var jscodeshift = require('../../../../node_modules/jscodeshift');

var ObjectProperty = require('./objectProperty.js');

 function ExportedProperty(exportStatementASTNode) {

    this.exportedPropertyName = null;

    //AST node representing exportedProperty value
    this.exportedPropertyASTNode = null;

    //AST node representing export statement of exportedProperty
    //syntax: exports.<identifier> = <objectExpression> or module.exports = <objectExpression>
    this.exportStatementASTNode = exportStatementASTNode;

    this.initializationValueASTNode = (exportStatementASTNode.value.type === 'ExpressionStatement' ?
                                        exportStatementASTNode.value.expression.right :
                                        exportStatementASTNode.value.right);

    this.propertyExportedThroughModuleExports = false;
    this.updatePropertyExportedThroughModuleExports = function(propertyExportedThroughModuleExports) {

        this.propertyExportedThroughModuleExports = propertyExportedThroughModuleExports;
    };

    this.exportedPropertyReferences = [];

    /**
     * Updates references of exported property (within its definition module).
     */
    this.updateExportedPropertyReferences = function(astRootCollection) {

        let exportedPropDefStmtAST = jscodeshift(this.exportStatementASTNode);

        let propertyReferences = astRootCollection.find(jscodeshift.MemberExpression).filter(node => {

            //retrieve references of exported property
            //(syntax: exports.<exportedPropertyName> || module.exports.<exportedPropertyName>)

            //exclude references inside the property's definition
            let propRefsWithinDef = exportedPropDefStmtAST.find(jscodeshift.MemberExpression).filter(propRefInDef => {

                return propRefInDef.value === node.value;
            });

            if(propRefsWithinDef.length > 0) {

                return false;
            }

            return ((node.value.object.type === 'Identifier' && node.value.object.name === 'exports' ||
                    (node.value.object.type === 'MemberExpression' && node.value.object.object.type === 'Identifier' && node.value.object.object.name === 'module' &&
                    node.value.object.property.type === 'Identifier' && node.value.object.property.name === 'exports')) && 
                    node.value.property.type === 'Identifier' && node.value.property.name === this.exportedPropertyName);
        });

        // console.log(this.exportedPropertyName);
        if(propertyReferences.length === 0) {

            return;
        }

        propertyReferences.forEach(propertyReference => {

            let propertyReferenceLoc = propertyReference.value.loc;
            let existingReferences = this.exportedPropertyReferences.filter(existingReference => {

                let existingReferenceLoc = existingReference.loc;
                return propertyReferenceLoc.start.line === existingReferenceLoc.start.line && propertyReferenceLoc.start.column === existingReferenceLoc.start.column &&
                       propertyReferenceLoc.end.line === existingReferenceLoc.end.line && propertyReferenceLoc.end.column === existingReferenceLoc.end.column;
            });

            if(existingReferences.length !== 0) {

                //propertyReference already introduced in the set of the references of exportedProperty
                return;
            }

            this.exportedPropertyReferences.push(propertyReference.value);
        });

        // console.log(this.exportedPropertyReferences.map(propRef => propRef.loc));
        //update: 
    };

    this.isCohesive = false;
    this.updateIsCohesive = function(isCohesive) {

        this.isCohesive = isCohesive;
    };

    this.objectProperties = [];
    this.updateObjectProperties = function(exportsStatements, astRootCollection) {

        /**
         * object properties are defined through: 
         * (a) explicit definition within an object (property of an object), 
         * (b) binding to an object
         */
        let objectProperty;
        let objectProperties = [];
        let propertyName;
        let propertyNode;
        let propertyDefNode = this.exportedPropertyASTNode.value != null ?
                                this.exportedPropertyASTNode.value :
                                this.exportedPropertyASTNode;

        // console.log(this.exportedPropertyASTNode);

        //(a)
        let propertyNodes = propertyDefNode.properties;
        if(propertyNodes !== undefined) {

            propertyNodes.forEach(propertyNode => {

                // console.log(propertyNode);
                let propertyName = propertyNode.key.type === 'Identifier' ? propertyNode.key.name : propertyNode.key.value;
                if(isNaN(propertyName) === false || propertyNode.key.type === 'Literal') {

                    //propertyName is a number or the property's definition name is a literal 
                    //(do not destructure object, since it may be used in array expressions)
                    this.updateIsCohesive(true);
                }
                
                let objectProperty = new ObjectProperty.ObjectProperty(propertyName, propertyNode);
                objectProperties.push(objectProperty);
            });
        }

        if(exportsStatements === undefined) {

            return;
        }

        // console.log(exportsStatements.length);

        //do not consider the statement that defines the exported property specified by 'this'
        exportsStatements = exportsStatements.filter(exportStatement => {

            let propertyDefNode = this.exportStatementASTNode.value != null ?
                                    this.exportStatementASTNode.value :
                                    this.exportStatementASTNode;

            return propertyDefNode !== exportStatement.value;
        });

        // console.log(exportsStatements.length);
        
        //(b) ternjs cannot soundly retrieve a property's references (e.g. due to polymorphism)
        //iterate over the definition module's export statements, in order to retrieve bindings to exportedProperty
        if(exportsStatements.length > 0) {

            exportsStatements.forEach(exportStatement => {

                // console.log(exportStatement)
    
                let leftOperand = exportStatement.value.left;
                let rightOperand = exportStatement.value.right;
    
                let accessedObject;
                let accessedProperty;
                let memberExpression = leftOperand;
    
                // console.log(leftOperand);
    
                while(leftOperand.type === 'MemberExpression') {
    
                    //syntax: exports.<identifier>.[...].<identifier> = <rightOperand> || module.exports[.<identifier>] = <rightOperand>
                    accessedObject = leftOperand.object;
                    accessedProperty = leftOperand.property;
    
                    if((accessedObject.type === 'Identifier' && accessedObject.name === 'exports') ||
                       (accessedObject.type === 'MemberExpression' && accessedObject.object.type === 'Identifier' && accessedObject.object.name === 'module' && 
                        accessedObject.property.type === 'Identifier' && accessedObject.property.name === 'exports')) {
    
                        //found 'exports' or 'module.exports' within member expression
                        //do not proceed (the property bound to exports/module.exports is specified by accessedProperty)
                        break;
                    }
    
                    memberExpression = leftOperand;
                    leftOperand = leftOperand.object;
                }
    
                // console.log(accessedProperty);
                // console.log(this.exportStatementASTNode);
                // console.log(exportStatement.value);
                if(accessedProperty.type !== 'Identifier') {
    
                    //accessedProperty: property bound to the export object
                    //we consider finding the exported property's inner properties
                    return;
                }
    
                //accessedObject: exports || module.exports (its parentPath is a member expression whose property is identical to exportedProperty - its grandParent node is a member expression whose property is the exportedProperty's property)
                //accessedProperty: property bound to export object
                //memberExpression: <accessedObject>.<accessedProperty>.[<accessedProperty>]
                if(this.propertyExportedThroughModuleExports === false &&
                    accessedProperty.name !== this.exportedPropertyName) {

                    //exportedProperty not assigned to the export object (i.e. bound to it)
                    //and property bound to the export object (accessedProperty) not identical to property specified by 'this'
                    //property not an inner property of 'this'
                    return;
                }

                //property is accessed statically and its accessed outside its definition
                // propertyName = memberExpression.property.name;
                propertyName = accessedProperty.type === 'Identifier' ? accessedProperty.name : (accessedProperty.type === 'Literal' ? accessedProperty.value : null);
                if(isNaN(propertyName) === false || accessedProperty.type === 'Literal') {

                    //propertyName is a number
                    //or the property's name is a literal (do not destructure object)
                    this.updateIsCohesive(true);
                }

                propertyNode = exportStatement.value;
    
                let existingProperties = objectProperties.filter(existingObjectProperty => {
    
                    return existingObjectProperty.propertyName === propertyName;
                });

                // console.log(this.exportedPropertyName);
                // console.log(accessedProperty);
                // console.log(memberExpression);
    
                if(existingProperties.length === 0) {
    
                    //what if accessedProperty specifies the surrounding exportedProperty?
                    //export statement contains a reference of exportedProperty
                    // if(this.exportedPropertyName === propertyName) {
    
                    //     this.exportedPropertyReferences.push(leftOperand);
                    //     return;
                    // }
    
                    //property with name propertyName is not defined within object (and not identical to its surrounding object [exportedProperty])
                    // objectProperty = new ObjectProperty.ObjectProperty(propertyName, propertyNode);
                    objectProperty = new ObjectProperty.ObjectProperty(memberExpression.property.name, propertyNode);
                    objectProperties.push(objectProperty);
                }
                else {
    
                    //a property with name propertyName already exists
                    //export statement contains a reference of this property
                    //update: if accessedProperty's grand parent node is not an assignment (it is a member expression),
                    //we should talk about an exportedProperty's inner property
                    //(e.g. exports.<identifier>.<identifier>.[<identifier] = <value>)
                    let existingProperty = existingProperties[0];
                    existingProperty.pushUsageToObjectPropertyUsages(leftOperand);

                    // console.log(accessedProperty);
                }
    
                
            });
        }

        //also, if exportedProperty is initialized with an array,
        //it is a cohesive object (do not decompose)
        if(propertyDefNode !== null && 
           propertyDefNode.type === 'ArrayExpression') {

            this.updateIsCohesive(true);
        }

        this.objectProperties = objectProperties;

        // console.log(this.exportedPropertyName);
        // console.log(this.objectProperties.map(objectProperty => objectProperty.propertyName));
    };

    //updates exported property information (name and AST node)
    this.updateExportedProperty = function(exportsStatements, astRootCollection) {

        // console.log(this.exportStatementASTNode);

        var leftOperand = this.exportStatementASTNode.value.expression != null ? 
                            this.exportStatementASTNode.value.expression.left : 
                            this.exportStatementASTNode.value.left;

        var rightOperand = this.exportStatementASTNode.value.expression != null ? 
                            this.exportStatementASTNode.value.expression.right :
                            this.exportStatementASTNode.value.right;

        //update: rightOperand might be an assignment (the property is represented by the right-most AST node)
        while(rightOperand.type === 'AssignmentExpression') {

            rightOperand = rightOperand.right;
        }

        var accessedObject;
        var accessedProperty;

        //the AST node representing the value of exportedProperty is the right operand of the assignment
        this.exportedPropertyASTNode = rightOperand;

        //the name of exportedProperty is the property of the left operand
        //what if the left operand represents a property bound to a property of exports/module.exports?
        if(leftOperand.type === 'MemberExpression') {

            accessedObject = leftOperand.object;
            accessedProperty = leftOperand.property;

            // console.log(accessedObject);
            // console.log(accessedProperty);

            if(accessedObject.type === 'Identifier' && accessedObject.name === 'exports' && 
                (accessedProperty.type === 'Identifier' || accessedProperty.type === 'Literal')) {

                //exportStatement syntax: exports.<identifier> = <objectExpression>
                //retrieve identifier's name
                this.exportedPropertyName = (accessedProperty.type === 'Identifier' ? accessedProperty.name : accessedProperty.value);
            }
            else if(accessedObject.type === 'Identifier' && accessedObject.name === 'module' && 
                    accessedProperty.type === 'Identifier' && accessedProperty.name === 'exports') {

                //exportStatement syntax: module.exports = <objectExpression>
                //the objectExpression is anonymus (its name will be resolved during its import)
                this.exportedPropertyName = 'anonymus';
            }
            else if(accessedObject.type === 'MemberExpression') {

                //syntax: exports[.identifier] = <property> || module.exports[.identifier] = <property>
                let parentNode = leftOperand;
                while(accessedObject.type === 'MemberExpression') {

                    let innerObject = accessedObject.object;
                    let innerProperty = accessedObject.property;

                    // console.log(innerObject);
                    // console.log(innerProperty);

                    if(innerObject.type === 'Identifier' && innerObject.name === 'exports' &&
                       innerProperty.type === 'Identifier') {

                        //syntax: exports[.identifier] = <property>
                        this.exportedPropertyName = innerProperty.name;
                        break;
                    }
                    else if(innerObject.type === 'Identifier' && innerObject.name === 'module' &&
                            innerProperty.type === 'Identifier' && innerProperty.name === 'exports' &&
                            parentNode.property.type === 'Identifier') {

                        //syntax: module.exports[.identifier] = <property>
                        this.exportedPropertyName = parentNode.property.name;
                        break;
                    }

                    parentNode = accessedObject;
                    accessedObject = accessedObject.object;
                }

            }
        }
        else if(leftOperand.type === 'Identifier' && leftOperand.name === 'exports') {

            //syntax: exports = <property>
            this.exportedPropertyName = 'anonymus';
        }

        //retrieve the object's inner properties
        //update: also, retrieve their uses
        this.updateObjectProperties(exportsStatements, astRootCollection);

        // console.log(this);

        //update: retrieve exported property's references
        //(an exported property may be used in statements other than exports)
        this.updateExportedPropertyReferences(astRootCollection);

        this.updateDoesExportedPropertyHandleThis();

        // console.log(this);
    };

    this.doesExportedPropertyHandleThis = false;
    this.updateDoesExportedPropertyHandleThis = function() {

        this.doesExportedPropertyHandleThis = (jscodeshift(this.exportedPropertyASTNode).find(jscodeshift.ThisExpression).length > 0);
    };

    //is the object's hierarchy enriched with properties
	//outside the object's definition module?
	//(resolved during MDG construction)
    this.isObjectHierarchyModifiedInMultipleModules = false;
    
    //>= 1 usage inside a property definition is needed in order to be true
	this.updateIsObjectHierarchyModifiedInMultipleModules = function(isObjectHierarchyModifiedInMultipleModules) {

		this.isObjectHierarchyModifiedInMultipleModules = 
			(this.isObjectHierarchyModifiedInMultipleModules === true ? 
			 true : isObjectHierarchyModifiedInMultipleModules);
	};

	//external modules enriching the prototype 
	//of object with new properties (absolute paths)
	this.modulesEnrichingHierarchy = [];
	this.pushModuleToModulesEnrichingHierarchy = function(inputFile) {

		//add inputFile in array once (prevent duplicates)
		if(this.modulesEnrichingHierarchy.some(currModule => {

			return currModule === inputFile;

		}) === false) {

			this.modulesEnrichingHierarchy.push(inputFile);
		}
	};

    this.isIncludedInAModifiedImportedNamespace = false;
	this.updateIsIncludedInAModifiedImportedNamespace = function(isIncludedInAModifiedImportedNamespace) {

		// this.isIncludedInAModifiedImportedNamespace = isIncludedInAModifiedImportedNamespace;

        //if set to true, don't modify it
        //iteration over the modules and their deps is non-deterministic
        //a property might be included in a modified namespace in one of the modules
        //where it's imported
        this.isIncludedInAModifiedImportedNamespace = this.isIncludedInAModifiedImportedNamespace === false ?
                                                        isIncludedInAModifiedImportedNamespace :
                                                        this.isIncludedInAModifiedImportedNamespace;
    };
    
    //is exportedProperty imported and re-exported from its definition module
    //(the module that is specified to import exportedProperty)?
    this.isImportedAndReexported = false;
	this.updateIsImportedAndReexported = function(isImportedAndReexported) {

		// this.isImportedAndReexported = isImportedAndReexported;

        //if set to true, don't modify it
        //iteration over the modules and their deps is non-deterministic
        //a property might be imported and re-exported in one of the modules
        //where it's imported
        this.isImportedAndReexported = this.isImportedAndReexported === false ?
                                        isImportedAndReexported :
                                        this.isImportedAndReexported;
	};

    //returns the exported property's (object's) property
    //with the name specified by objectPropertyName
    this.retrieveObjectPropertyByName = function(objectPropertyName) {

        return this.objectProperties.find(objectProperty => {

            return objectProperty.propertyName === objectPropertyName;
        });
    };

    //returns the object properties defined in exported property (object exported by the user)
    //which are actually used in other modules (and, thus, need to be exported)
    this.retrieveAccessedObjectProperties = function() {

        return this.objectProperties.filter(function(objectProperty) {

            return objectProperty.isExported === true;

        }).map(function(usedProperty) {

            //create 'updated' properties (propertyDefinitionNode) of each used property,
            //in order to avoid circular structures in the json file
            // console.log(usedProperty);
            return {

                propertyName: usedProperty.propertyName,
                propertyDefinitionNode: usedProperty.propertyDefinitionNode
            };
        });
    };

    this.isExportedPropertyInitializedWithInvocationOfRequire = function() {

        if(this.exportStatementASTNode.type !== 'AssignmentExpression') {

            return false;
        }

        let rightOperand = this.exportStatementASTNode.right;
        if(rightOperand.type !== 'CallExpression') {

            return false;
        }

        if(rightOperand.callee.type === 'Identifier' && rightOperand.callee.name === 'require') {

            return true;
        }

        return false;
    };

    //is exportedProperty referenced outside member expressions (maybe iterated)?
    this.isObjectReferenced = false;
    this.updateIsObjectReferenced = function(isObjectReferenced) {

        //if set to true, don't modify it
        //iteration over the modules and their deps is non-deterministic
        this.isObjectReferenced = isObjectReferenced;
    };

    //is exportedProperty used besides its statically-known properties?
    this.usedBesidesProperties = false;
    this.updateUsedBesidesProperties = function(usedBesidesProperties) {

        //in the case the exported property is used besides its statically-known
        //properties at least once, keep information
		//else, update field (all references are used in order to determine the fact)
        this.usedBesidesProperties = (this.usedBesidesProperties === false ? 
                                        usedBesidesProperties : 
                                        this.usedBesidesProperties);
    };

    //is exportedProperty mapped to a variable/function definition?
    //(is it initialized with a reference to a definition?)
    this.moduleDefinition = null;
    this.updateModuleDefinition = function(moduleDefinition) {

        this.moduleDefinition = moduleDefinition;
    };
 }

 exports.ExportedProperty = ExportedProperty;