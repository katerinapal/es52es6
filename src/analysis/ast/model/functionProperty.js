/**
 * http://usejsdoc.org/
 */

const path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');

//used for def-use algorithm
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

let reservedWords = require('../util/reservedWords');

const ImpliedGlobalVariable = require('./impliedGlobalVariable.js');
const ImportedModule = require('./importedModule.js');
const GlobalObjectProperty = require('./globalObjectProperty.js');

function FunctionProperty(propertyDefinitionNode) {
	
	this.propertyType = null;
    this.propertyName = null;
    this.propertyAlias = this.propertyName;
	this.propertyDefinitionNode = propertyDefinitionNode;
	this.propertyValue = null;
	
	this.updatePropertyType = function(propertyType) {
		this.propertyType = propertyType;
	};
	
	this.updatePropertyDefinitionNode = function(propertyDefinitionNode) {
		this.propertyDefinitionNode = propertyDefinitionNode;
	};

	this.updatePropertyValue = function(propertyValue) {

		this.propertyValue = propertyValue;
    };
    
    this.isPrototypeProperty = false;
    this.updateIsPrototypeProperty = function(isPrototypeProperty) {

        this.isPrototypeProperty = isPrototypeProperty;
    };

	//determines whether function property is used and, thus, needs to get exported during object destructuring
	//(in order to achieve better encapsulation)
	this.isExported = false;
	this.updateIsExported = function(isExported) {

		this.isExported = isExported;
	};
	
	this.enclosingScope = null;
	this.updateEnclosingScope = function(enclosingScope) {
		this.enclosingScope = enclosingScope;
	};

	this.functionPropertyUsages = [];
	this.updateFunctionPropertyUsages = function(functionPropertyUsages) {

		this.functionPropertyUsages = functionPropertyUsages;
	};

	this.updateFunctionProperty = function() {

		let isPrototypeProperty = false;
        let propertyName;
        
        //property's full definition node (AssignmentExpression/Property)
        let propertyDefinitionNode = this.propertyDefinitionNode.value != null ? this.propertyDefinitionNode.value : this.propertyDefinitionNode;
        let leftOperand = propertyDefinitionNode.left;

        let propertyDefAST = jscodeshift(leftOperand);

        this.updatePropertyValue(propertyDefinitionNode.right);

        //is property a prototype property?
        let prototypeReferences = propertyDefAST.find(jscodeshift.Identifier).filter(identifier => {

            return identifier.value.name === 'prototype';
        });

        isPrototypeProperty = (prototypeReferences.length > 0);
        this.updateIsPrototypeProperty(isPrototypeProperty);

        //retrieve the property's name
        //(a) is property bound to exports?
        let exportObjectRefs = propertyDefAST.find(jscodeshift.Identifier).filter(path => {

            return path.value.name === 'exports' && 
				   path.parentPath.value.type === 'MemberExpression' && 
				   path.parentPath.value.object === path.value;
        });

        if(exportObjectRefs.length > 0) {

            propertyName = exportObjectRefs.at(0).get().parentPath.value.property.name;
        }
        else {

            //(b) is property bound to module.exports?
            exportObjectRefs = propertyDefAST.find(jscodeshift.MemberExpression).filter(path => {

				return path.value.object.type === 'Identifier' && path.value.object.name === 'module' &&
					   path.value.property.type === 'Identifier' && path.value.property.name === 'exports';
            });
            
            if(exportObjectRefs.length > 0) {

                propertyName = exportObjectRefs.at(0).get().parentPath.value.property.name;
            }
            else {

                //(c) is property bound to another object?
                while(leftOperand.type === 'MemberExpression') {

                    if(leftOperand.property.type === 'Identifier') {
    
                        propertyName = leftOperand.property.name;                 
                    }
                    else if(leftOperand.property.type === 'Literal') {
    
                        propertyName = leftOperand.property.value;
                    }
    
                    leftOperand = leftOperand.object;
                }
            }
        }

        // if(propertyDefinitionNode.type === 'AssignmentExpression') {

        //     let leftOperand = propertyDefinitionNode.left;
            
        //     while(leftOperand.type === 'MemberExpression') {

        //         if(leftOperand.property.type === 'Identifier') {

        //             propertyName = leftOperand.property.name;                 
        //         }
        //         else if(leftOperand.property.type === 'Literal') {

        //             propertyName = leftOperand.property.value;
        //         }

        //         leftOperand = leftOperand.object;
        //     }
        // }
        
        // console.log(propertyName);
        this.propertyName = propertyName;

        // console.log(propertyDefinitionNode);

		//property is defined through assignment - find its initialization value
		let propertyInitializationValueNode = propertyDefinitionNode.right;

		//property initialized with another assignment - 
		//the actual initialization value is the rightmost operand
		while(propertyInitializationValueNode.type === 'AssignmentExpression') {

			propertyInitializationValueNode = propertyInitializationValueNode.right;
		}
	
        this.updatePropertyType(propertyInitializationValueNode);

        // console.log(this);
	}

	/**
     * Retrieves the uses of the property (specified in property)
     * that is defined in the module specified in sourceFile.
     * Update: Ternjs cannot soundly resolve all property reference
     * (combine Ternjs results with the object definition's references)
     * @param {*} property 
     */
    this.updateFunctionPropertyReferences = function(sourceFile, functionReferenceIdentifiers) {

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

        //the member expression representing a reference to the property within its initialization statement
        //(syntax: <property_expression>)
        let propertyDefinitionMemberExpressionNode = propertyDefinitionStatementNode.left;

        // console.log(propertyDefinitionMemberExpressionNode);

        let propertyDefinitionStart = propertyDefinitionMemberExpressionNode.range[0];
        let propertyDefinitionEnd = propertyDefinitionMemberExpressionNode.range[1];

        let propertyReferenceMemberExpressions = [];
        if(propertyDefinitionStart == null || propertyDefinitionEnd == null) {

            //property location is null/undefined
            this.updateFunctionPropertyUsages([]);
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

        // console.log('p: ' + this.propertyName);
        // console.log(referenceRanges.length);

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

            //add the full property reference to the array of the references of functionProperty
            propertyReferenceMemberExpressions.push(propertyReferenceMemberExpression);
        });

        // console.log(propertyReferenceMemberExpressions);

        // console.log(functionReferenceIdentifiers.length);

        //(b) consider query results with respect to the surrounding object (with respect to the specific property)
        //(ternjs cannot soundly resolve a property's references)
        let propertyReferences = functionReferenceIdentifiers.filter(functionReference => {
            
            return functionReference.parentPath.value.type === 'MemberExpression' &&
                (functionReference.parentPath.value.property.type === 'Identifier' && functionReference.parentPath.value.property.name === propertyName) &&
                functionReference.parentPath.value !== propertyDefinitionMemberExpressionNode;
        }).map(propertyReference => {

            return propertyReference.parentPath.value;
        });

        // console.log(propertyReferences.length);

        propertyReferences.forEach(propertyReference => {

            if(propertyReferenceMemberExpressions.indexOf(propertyReference) < 0) {

                //consider property reference in the case that it is not returned as a result
                //of the ternjs query with respect to the property
                propertyReferenceMemberExpressions.push(propertyReference);
            }
        });

        // console.log(propertyReferenceMemberExpressions.length);

        this.updateFunctionPropertyUsages(propertyReferenceMemberExpressions);

        ternServer.delFile(sourceFile.fileName);
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

    /**
     * Maps an object property to an object w.r.t its import
     *(Exported feature's only influenced by reserved words and the definition module's features,
     * imported features influenced by name conflicts with other imported features, as well.
     * @param inputFile the file importing the object property
     * @param importFile the imported property's definition module
     */
    this.mapFunctionPropertyToImportedDefJSONObj = function(inputFile, importFile) {

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
        this.isPropertyConflictingWithModuleFeature(inputFile) === true ||
        inputFile.isObjectPropertyDefinedInSourcefile(this.propertyName) === true ||
        inputFile.importedElements.some(importedEl => {

            if(importedEl instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === true ||
                importedEl instanceof ImportedModule.ImportedModule === true ||
                importedEl instanceof GlobalObjectProperty.GlobalObjectProperty === true) {

                    return false;
            }

            return importedEl.importedFeatureSpecifiesFeature(this.propertyName) === true;
        }) === true ? 
        `${path.basename(importFile.fileName, '.js')}_${this.propertyName}`:
        this.propertyName;

        let propertyObj =  {

            propertyName: this.propertyName,

            propertyAlias: propertyName,

            propertyDefinitionNode: this.propertyDefinitionNode.value != null ?
                                    this.propertyDefinitionNode.value :
                                    this.propertyDefinitionNode,

            propertyValue: this.propertyValue,
            isExported: this.isExported,
            functionPropertyUsages: this.functionPropertyUsages.map(objRef => {

                return objRef.value != null ? objRef.value : objRef;
            })
        };

        //NOTICE: checking for name conflicts in properties leads in memory crash at 8gb (goojs)
        // let propertyObj =  {

        //     propertyName: this.propertyName,

        //     propertyAlias: `${path.basename(importFile.fileName, '.js')}_${this.propertyName}`,

        //     propertyDefinitionNode: this.propertyDefinitionNode.value != null ?
        //                             this.propertyDefinitionNode.value :
        //                             this.propertyDefinitionNode,

        //     propertyValue: this.propertyValue,
        //     isExported: this.isExported,
        //     functionPropertyUsages: this.functionPropertyUsages.map(objRef => {

        //         return objRef.value != null ? objRef.value : objRef;
        //     })
        // };

        propertyObj.propertyType = this.propertyType;
        propertyObj.isPrototypeProperty = this.isPrototypeProperty;

        return propertyObj;
    };

    this.mapFunctionPropertyToRefJSONObj = function(inputFile) {

        //in case of name conflict the property is renamed to <filename>_<propertyname>
        let propertyName = reservedWords.isReservedWord(this.propertyName) === true ||
        inputFile.retrieveExplicitGlobal(this.propertyName) !== null ||
        inputFile.retrieveDefinedFunctionByName(this.propertyName) !== null ?
        `${path.basename(inputFile.fileName, '.js')}_${this.propertyName}`:
        this.propertyName;

        // let propertyName = reservedWords.isReservedWord(this.propertyAlias) === true ||
        // inputFile.retrieveExplicitGlobal(this.propertyAlias) !== null ||
        // inputFile.retrieveDefinedFunctionByName(this.propertyAlias) !== null ?
        // `${path.basename(inputFile.fileName, '.js')}_${this.propertyAlias}`:
        // this.propertyAlias;

        // this.propertyName = propertyName;

        return {

            // propertyName: this.propertyName,

            propertyName: propertyName,

            propertyAlias: this.propertyName,
			propertyDefinitionNode: this.propertyDefinitionNode.value != undefined ?
                                    this.propertyDefinitionNode.value :
                                    this.propertyDefinitionNode,

			propertyValue: this.propertyValue,
            isExported: this.isExported,
            functionPropertyUsages: this.functionPropertyUsages.map(propertyRef => {

                return propertyRef.value != null ? propertyRef.value : propertyRef;
            })
        }
    };
}

exports.FunctionProperty = FunctionProperty;