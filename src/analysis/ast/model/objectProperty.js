/**
 * ObjectProperty.js. Constructor function for creating objects representing object properties.
 */

const path = require('path');

//used for def-use algorithm
var jscodeshift = require('../../../../node_modules/jscodeshift');
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

let reservedWords = require('../util/reservedWords.js');
const GlobalObjectProperty = require('./globalObjectProperty.js');
const ImpliedGlobalVariable = require('./impliedGlobalVariable.js');
const ImportedElement = require('./importedElement.js');
const ImportedModule = require('./importedModule.js');

function ObjectProperty(propertyName, propertyDefinitionNode) {

    this.propertyName = propertyName;
    this.propertyAlias = propertyName;

    //AST node representing property definition (value assignment to property)
    this.propertyDefinitionNode = propertyDefinitionNode;

    //if the specific property is referenced in the modules that import its container object
    //the property should be exported (avoid exporting large objects,
    //export object with referenced properties instead, in order to achieve better encapsulation)
    this.isExported = false;
    this.updateIsExported = function(isExported) {

        this.isExported = isExported;
    };

    this.objectPropertyUsages = [];
    this.updateObjectPropertyUsages = function(objectPropertyUsages) {

        this.objectPropertyUsages = objectPropertyUsages;
    };

    //updates the array of the property's references
    //(in the case that an object property is reference through binding
    //applies only to properties defined through binding-
    //since ternjs cannot retrieve their references soundly (e.g. due to polymorphism))
    this.pushUsageToObjectPropertyUsages = function(propertyUsage) {

        this.objectPropertyUsages.push(propertyUsage);
    }

    /**
     * Retrieves the uses of the property (specified in property)
     * that is defined in the module specified in sourceFile.
     * Update: Ternjs cannot soundly resolve all property reference
     * (combine Ternjs results with the object definition's references)
     * @param {*} property 
     */
    this.updateObjectPropertyReferences = function(sourceFile, objectReferenceIdentifiers) {

        let astRootCollection = sourceFile.astRootCollection;
        let propertyName = this.propertyName;

        //property references:
        //(a) the results returned from ternjs (perform a query for the property's references)
        //(b) the query results with respect to the object's references (tern cannot soundly determine a property's references)

        //(a)
        //the assignment comprising the statement where the property is initialized (defined)
        //(syntax: <property_expression> = <initialization_value>)
        let propertyDefinitionStatementNode = (this.propertyDefinitionNode.value === undefined ? this.propertyDefinitionNode : this.propertyDefinitionNode.value);
        if(propertyDefinitionStatementNode.type !== 'AssignmentExpression') {

            return;
        }

        let objectName = objectReferenceIdentifiers.length > 0 ?
                            objectReferenceIdentifiers[0].value.name :
                            null;

        //the member expression representing a reference to the property within its initialization statement
        //(syntax: <property_expression>)
        let propertyDefinitionMemberExpressionNode = propertyDefinitionStatementNode.left;

        // console.log(propertyDefinitionMemberExpressionNode);

        let propertyDefinitionStart = propertyDefinitionMemberExpressionNode.range[0];
        let propertyDefinitionEnd = propertyDefinitionMemberExpressionNode.range[1];

        let propertyReferenceMemberExpressions = [];
        if(propertyDefinitionStart == null || propertyDefinitionEnd == null) {

            //property location is null/undefined
            this.updateObjectPropertyUsages([]);
            return;
        }

        ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

        //find usages (refs) of property
        //retrieve: (a) property references through the function object (syntax: <definedFunction>.<propertyName>)
        //			 (b) property references through referencing 'this' (only inside method properties, syntax: this.<propertyName>)
        let requestDetails = {
            query: {
                type: "refs",
                file: sourceFile.fileName,
                end: propertyDefinitionEnd,
                start: propertyDefinitionStart
            }
        };

        let referenceRanges = [];
        ternServer.request(requestDetails, function(error, success){
            
            // console.log(error);
            // console.log(success);

            if(error != null) {

                return;
            }

            //retrieve the ranges of the usages (references) of functionProperty
            referenceRanges = success.refs.map(reference => {

                return {

                    start: reference.start,
                    end: reference.end
                };
            });
        });

        // console.log(propertyName)
        // console.log(referenceRanges.length);
        // console.log(referenceRanges);

        //exclude the reference within the definition of functionProperty
        referenceRanges = referenceRanges.filter(referenceRange => {

            return referenceRange.start !== propertyDefinitionStart && referenceRange.end !== propertyDefinitionEnd;
        });

        //for each reference, retrieve the member expression containing it 
        //(the complete reference to the property: ternjs returns the reference to the property without the object)
        //find identifier represented by reference and then retrieve its parent (prevent confusion in cases when multiple property references are used)
        let propertyReference;
        referenceRanges.forEach(function(referenceRange) {

            let referenceIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(identifier => {

                return identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end;
            });

            // console.log(referenceIdentifiers.length);

            if(referenceIdentifiers.length === 0) {

                //no references found - abort
                return;
            }

            let propertyReferenceMemberExpression = referenceIdentifiers.at(0).get().parentPath.value;

            if(propertyReferenceMemberExpression.type !== 'MemberExpression' ||
                propertyReferenceMemberExpression.object.type !== 'Identifier' ||
                propertyReferenceMemberExpression.object.name !== objectName) {

                return;
            }

            //add the full property reference to the array of the references of functionProperty
            propertyReferenceMemberExpressions.push(propertyReferenceMemberExpression);
        });

        // console.log(propertyReferenceMemberExpressions);

        //(b) consider query results with respect to the surrounding object (with respect to the specific property)
        //(ternjs cannot soundly resolve a property's references)
        let objectPropertyReferences = objectReferenceIdentifiers.filter(objectReference => {

            return objectReference.parentPath.value.type === 'MemberExpression' &&
                (objectReference.parentPath.value.property.type === 'Identifier' && objectReference.parentPath.value.property.name === propertyName &&
                objectReference.parentPath.value.object.type === 'Identifier' && objectReference.parentPath.value.object.name === objectName) &&
                objectReference.parentPath.value !== propertyDefinitionMemberExpressionNode;
        }).map(propertyReference => {

            return propertyReference.parentPath.value;
        });

        objectPropertyReferences.forEach(objectPropertyReference => {

            if(propertyReferenceMemberExpressions.indexOf(objectPropertyReference) < 0) {

                //consider property reference in the case that it is not returned as a result
                //of the ternjs query with respect to the property
                propertyReferenceMemberExpressions.push(objectPropertyReference);
            }
        });

        // console.log(propertyReferenceMemberExpressions.length);

        this.updateObjectPropertyUsages(propertyReferenceMemberExpressions);

        ternServer.delFile(sourceFile.fileName);
    };

    /**
     * Maps an object property to an object w.r.t its import
     *(Exported feature's only influenced by reserved words and the definition module's features,
     * imported features influenced by name conflicts with other imported features, as well.
     * @param inputFile the file importing the object property
     * @param importFile the imported property's definition module
     */
    this.mapObjectPropertyToImportedDefJSONObj = function(inputFile, importFile) {

        //alt1
        // let propertyName = reservedWords.isReservedWord(this.propertyName) === true ||
        // inputFile.retrieveExplicitGlobal(this.propertyName) !== null ||
        // inputFile.retrieveDefinedFunctionByName(this.propertyName) !== null ?
        // `${path.basename(inputFile.fileName, '.js')}_${this.propertyName}`:
        // this.propertyName;

        //alt2
        //in case of name conflict the property's alias is renamed to <filename>_<propertyname>
        //(properties are exported from the definition module with their initial names
        //but they're aliased to prevent name conflicts)
        /**
         * Name conflicts happen in cases that the file importing the property (inputFile):
         * (a) contains a module feature with the same name
         * (b) contains an object shared property bound to a module feature (object destructuring conflicts)
         * (c) imports another feature with the same name
         * (d) imports another feature with an object shared property with the same name
         */
        let propertyName = reservedWords.isReservedWord(this.propertyName) === true ||
        inputFile.retrieveExplicitGlobal(this.propertyName) !== null ||
        inputFile.retrieveDefinedFunctionByName(this.propertyName) !== null ||
        inputFile.isObjectPropertyDefinedInSourcefile(this.propertyName) === true ||
        inputFile.importedElements.some(importedEl => {

            if(importedEl instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true ||
                importedEl instanceof ImportedModule.ImportedModule === true ||
                importedEl instanceof GlobalObjectProperty.GlobalObjectProperty === true) {

                    return false;
            }

            return importedEl.importedFeatureSpecifiesFeature(this.propertyName);
        }) === true ? 
        `${path.basename(importFile.fileName, '.js')}_${this.propertyName}`:
        this.propertyName;

        return {

            propertyName: this.propertyName,

            propertyAlias: propertyName,

            propertyDefinitionNode: this.propertyDefinitionNode.value != null ?
                                    this.propertyDefinitionNode.value :
                                    this.propertyDefinitionNode,

            isExported: this.isExported,
            objectPropertyUsages: this.objectPropertyUsages.map(objRef => {

                return objRef.value != null ? objRef.value : objRef;
            })
        };

        // //NOTICE: checking for name conflicts in properties leads in memory crash at 8gb (goojs)
        // return {

        //     propertyName: this.propertyName,

        //     propertyAlias: `${path.basename(importFile.fileName, '.js')}_${this.propertyName}`,

        //     propertyDefinitionNode: this.propertyDefinitionNode.value != null ?
        //                             this.propertyDefinitionNode.value :
        //                             this.propertyDefinitionNode,

        //     isExported: this.isExported,
        //     objectPropertyUsages: this.objectPropertyUsages.map(objRef => {

        //         return objRef.value != null ? objRef.value : objRef;
        //     })
        // };
    };

    /**
     * Is object property conflicting with another module feature?
     * @param {*} inputFile 
     */
    this.isPropertyConflictingWithModuleFeature = function(inputFile) {

        let defFunc = inputFile.retrieveDefinedFunctionByName(this.propertyName);

        if(defFunc == null) {

            return false;
        }
        
        let defFuncNodeStmt = null;
        let defFuncNode = defFunc.functionNode;
        if(defFuncNode.value.type === 'FunctionDeclaration') {

            defFuncNodeStmt = defFuncNode.value;
        }
        else {

            let defFuncNodeStmts = jscodeshift(defFuncNode).closest(jscodeshift.Statement);
            if(defFuncNodeStmts.length === 0) {

                return false;
            }

            defFuncNodeStmt = defFuncNodeStmts.at(0).get().value;
        }
        
        let propDefNodeStmts = jscodeshift(this.propertyDefinitionNode).closest(jscodeshift.Statement);

        if(propDefNodeStmts.length === 0) {

            return false;
        }

        return defFuncNodeStmt === propDefNodeStmts.at(0).get().value;
    };

    this.mapObjectPropertyToRefJSONObj = function(inputFile) {

        //in case of name conflict the property is renamed to <filename>_<propertyname>
        //(compare for name collisions in different features)
        let propertyName = reservedWords.isReservedWord(this.propertyName) === true ||
        inputFile.retrieveExplicitGlobal(this.propertyName) !== null ||
        this.isPropertyConflictingWithModuleFeature(inputFile) === true ?
        `${path.basename(inputFile.fileName, '.js')}_${this.propertyName}`:
        this.propertyName;
        

        // let propertyName = reservedWords.isReservedWord(this.propertyAlias) === true ||
        // inputFile.retrieveExplicitGlobal(this.propertyAlias) !== null ||
        // inputFile.retrieveDefinedFunctionByName(this.propertyAlias) !== null ?
        // `${path.basename(inputFile.fileName, '.js')}_${this.propertyAlias}`:
        // this.propertyAlias;

        // this.propertyName = propertyName;
        // console.log(this.propertyName);

        return {

            // propertyName: this.propertyName,
            propertyName: propertyName,

            propertyAlias: this.propertyName,

            propertyDefinitionNode: this.propertyDefinitionNode.value != null ?
                                    this.propertyDefinitionNode.value :
                                    this.propertyDefinitionNode,

            isExported: this.isExported,
            objectPropertyUsages: this.objectPropertyUsages.map(objRef => {

                return objRef.value != null ? objRef.value : objRef;
            })
        };
    }
};

exports.ObjectProperty = ObjectProperty;