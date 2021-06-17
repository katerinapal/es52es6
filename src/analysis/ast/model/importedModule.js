/**
 * ImportedModule function. Representing an ES6 import statement of type: import <moduleName>.
 * Needed in cases when an AMD module imports a module created without using the AMD framework (i.e. an IIFE).
 */

const util = require('../util/util.js');

function ImportedModule(assignedVariableName, declaredSource) {

    //imported module might module the import of a library
    //in client code (in CommonJS it's null)
    this.elementName = assignedVariableName;
    this.declaredSource = declaredSource;
    this.aliasName = null;

    this.elementDeclarationNode = null;
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
    this.updateElementUsages = function(elementUsages) {

        this.elementUsages = elementUsages;
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
    
    //a module is imported for its side-effects, no definitions are imported
    this.isMappedToExportedDefinitions = function() {

        return false;
    };

    //similarly to isMappedToExportedDefinitions()
    this.isMappedToImportedAndReexportedDefinitions = function() {

        return false;
    };

    this.mappedToObjectWithPropertiesInitializedWithImportedDefs = function() {

        return false;
    };

    this.isNested = false;
    this.updateIsNested = function() {

        this.isNested = false;
    };

    this.getImportedModuleObject = function() {

        return {

            'elementName': this.elementName,
            'declaredSource': this.declaredSource,
            'importedElementNodes': this.importedElementNodes.map(importedElementNode => util.minimizeNode(importedElementNode))
        };
    };

    this.compare = function(importedModule) {

        if(this.declaredSource === importedModule.declaredSource) {

            return true;
        }

        return false;
    };
}

exports.ImportedModule = ImportedModule;