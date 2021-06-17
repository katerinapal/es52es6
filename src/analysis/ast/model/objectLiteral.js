/**
 * ObjectLiteral.js. Models object expressions with properties
 * that are returned from functions, but are not necessarily exported from a module.
 * Applies only to AMD modules (in CommonJS modules, 
 * such expressions are modelled as exportedProperties or variables, 
 * since they are assigned/bound to the exported object).
 */

var ObjectProperty = require('./objectProperty.js');

function ObjectLiteral(objectExpressionASTNode) {

    this.objectExpressionASTNode = objectExpressionASTNode;

    this.objectProperties = [];
    this.updateObjectProperties = function(objectProperties) {

        this.objectProperties = objectProperties;
    };

    this.retrieveObjectPropertyByName = function(propertyName) {

        return this.objectProperties.find(objectProperty => {

            return objectProperty.propertyName === propertyName;
        });
    };

    /**
     * Retrieves properties defined within object specified in objectLiteral, 
     * through analyzing the statement that returns it (specified in objectExpressionASTNode)
     * (Applies to AMD modules).
     * @param {*} objectLiteral 
     * @param {*} returnStatementArgumentNode 
     */
    this.retrievePropertiesOfObjectLiteral = function() {

        let objectProperties = [];
        let objectExpressionProperties = this.objectExpressionASTNode.properties;
        objectExpressionProperties.forEach(objectExpressionProperty => {

            let propertyKey = objectExpressionProperty.key;
            let propertyName = propertyKey.type === 'Identifier' ? propertyKey.name : propertyKey.value;

            //initialize object property
            let objectProperty = new ObjectProperty.ObjectProperty(propertyName, objectExpressionProperty);
            objectProperties.push(objectProperty);
        });

        // console.log(objectProperties);
        this.updateObjectProperties(objectProperties);
    };

    this.isExported = false;
    this.updateIsExported = function(isExported) {

        this.isExported = isExported;
    };

    this.isCohesive = false;
    this.updateIsCohesive = function(isCohesive) {

        this.isCohesive = isCohesive;
    };

    //is object literal itself referenced in the system (e.g. iterated?)
    this.isObjectReferenced = false;
    this.updateIsObjectReferenced = function(isObjectReferenced) {

        this.isObjectReferenced = this.isObjectReferenced === false ? isObjectReferenced : this.isObjectReferenced;
    };

    //is objectLiteral used besides its statically-known properties?
    this.usedBesidesProperties = false;
    this.updateUsedBesidesProperties = function(usedBesidesProperties) {

        //in the case the object literal is used besides its statically-known
        //properties at least once, keep information
		//else, update field (all references are used in order to determine the fact)
        this.usedBesidesProperties = (this.usedBesidesProperties === false ? 
                                        usedBesidesProperties : 
                                        this.usedBesidesProperties);
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
}

exports.ObjectLiteral = ObjectLiteral;