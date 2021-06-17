/**
 * Export_variable.js. Codemod that adds an export statement in an AMD module. Codemod specific to AMD 
 * (AMD does not use export statements explicitly
 * like CommonJS, but exported modules are the values returned from the callback of define()).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let exportedElement = transformationInfo.exportedElement;
    let elementName = exportedElement.elementName.replace(/[^\w\s]/gi, '').replace(/-/g, '');
    let elementAlias = exportedElement.elementAlias.replace(/[^\w\s]/gi, '').replace(/-/g, '');
    
    //(a) map returned variable to the variable that is going to be exported
    //(b) replace return statement with the introduced variable definition
    // let mappedVarName = 'exported_' + elementName;

    //element's name and alias resolved during analysis
    let mappedVarName = elementName;
    let mappedVarIdentifier = jscodeshiftAPI.identifier(mappedVarName);
    // let exportAliasName = elementName;
    let exportAliasName = elementAlias;
    let exportAliasIdentifier = jscodeshiftAPI.identifier(exportAliasName);

    // console.log(jscodeshiftAPI(mappedVarIdentifier).toSource())
    // console.log(jscodeshiftAPI(exportAliasIdentifier).toSource())

    //exportedElement is an object which is not fully referenced (e.g. provided as a parameter)
    if(exportedElement.isInitializedWithObjectExpression === true &&
        exportedElement.isObjectReferenced === false) {

        //map each of the element's properties to variables
        let propertyObjs = mapObjectPropertiesToVariables(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarName);
        exportObjectProperties(jscodeshiftAPI, astRootCollection, propertyObjs);

        //remove return statement
        let returnStmts = locateReturnStatement(jscodeshiftAPI, astRootCollection, exportedElement);
        if(returnStmts.length === 0) {

            return;
        }

        returnStmts.remove();

        return;
    }

    //exportedElement is a cohesive object or is fully referenced
    //export as-is
    let mappedVarDeclaration = mapReturnedVariableToVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarIdentifier);
    if(mappedVarDeclaration === null) {

        return;
    }

    //(c) add an ES6 named export for the introduced variable right after its definition
    introduceES6NamedExportForVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarDeclaration, mappedVarIdentifier, exportAliasIdentifier);
};

/**
 * Maps the returned variable to a variable that is going to be exported from the module.
 * Replaces the return statement (if exists) with the respective variable definition in the AST.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 * @param {*} mappedVarIdentifier 
 */
function mapReturnedVariableToVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarIdentifier) {

    let elementName = exportedElement.elementName;
    let elementAlias = exportedElement.elementAlias;
    let returnNode = exportedElement.returnStatementNode;

    let mappedVarDeclarator;
    let mappedVarDeclaration;

    //variable to be mapped to an exported variable is not returned
    //(e.g. a top-level definition)
    //assign the variable's value to the mapped variable
    //and add variable definition in the end of the AST
    if(returnNode == null) {

        // mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, jscodeshiftAPI.identifier(elementName));

        //renamings due to name conflicts might happen,
        //but features are exported under their initial names
        mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, jscodeshiftAPI.identifier(elementAlias));
        mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

        astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);
        return mappedVarDeclaration;
    }

    let returnStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, returnNode);

    if(returnStmts.length === 0) {

        return null;
    }

    let returnStatementNode = returnStmts.at(0).get().value;
    let returnArgument = returnStatementNode.argument;

    //map returned value of the callback function
    //(variable/function reference/function expression)
    //to a variable (assign argument of return statement to the new variable)
    mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, returnArgument);
    mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

    // let returnStmts = locateReturnStatement(jscodeshiftAPI, astRootCollection, exportedElement);

    // if(returnStmts.length === 0) {

    //     return null;
    // }

    returnStmts.replaceWith(mappedVarDeclaration);

    return mappedVarDeclaration;
}

/**
 * Returns the return statement of the module's callback function.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function locateReturnStatement(jscodeshiftAPI, astRootCollection, exportedElement) {

    let returnStatementNode = exportedElement.returnStatementNode;

    if(returnStatementNode == null) {

        return null;
    }

    return searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, returnStatementNode);

    // let returnLoc = returnStatementNode.loc;

    // let returnStmts = astRootCollection.find(jscodeshiftAPI.ReturnStatement).filter(returnStmt => {

    //     if(returnStmt.value.loc == null) {

    //         return false;
    //     }

    //     let returnStmtLoc = returnStmt.value.loc;
    //     return returnStmtLoc.start.line === returnLoc.start.line && returnStmtLoc.start.column === returnLoc.start.column &&
    //             returnStmtLoc.end.line === returnLoc.end.line && returnStmtLoc.end.column === returnLoc.end.column;
    // });

    // return returnStmts;
}

/**
 * Adds an ES6 named export for the variable specified in mappedVarDeclaration
 * right after its definition in the AST.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} mappedVarDeclaration 
 * @param {*} mappedVarIdentifier 
 * @param {*} exportAliasIdentifier 
 */
function introduceES6NamedExportForVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarDeclaration, mappedVarIdentifier, exportAliasIdentifier) {

    // if(exportedElement.isCohesive === false && 
    //     exportedElement.objectProperties.length > 0 && 
    //     exportedElement.isObjectReferenced === false) {

    //     return;
    // }

    let exportSpecifier = jscodeshiftAPI.exportSpecifier(mappedVarIdentifier, exportAliasIdentifier);
    let exportSpecifiers = [exportSpecifier];
    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);
    
    // console.log(jscodeshiftAPI(exportStatement).toSource())
    // console.log(jscodeshiftAPI(mappedVarDeclaration).toSource())
    // console.log(mappedVarDeclaration);

    let mappedVarDefs = astRootCollection.find(jscodeshiftAPI[mappedVarDeclaration.type]).filter(mappedVarDef => {

        return mappedVarDef.value === mappedVarDeclaration;
    });

    if(mappedVarDefs.length === 0) {

        return;
    }

    mappedVarDefs.insertAfter(exportStatement);
}

/**
 * Maps each object property of exportedElement to a variable definition.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 * @param {*} elementIdentifier 
 */
function mapObjectPropertiesToVariables(jscodeshiftAPI, astRootCollection, exportedElement, elementName) {

    let objectProperties = exportedElement.objectProperties;
    let propertyObjs = [];

    objectProperties.forEach(objectProp => {

        let propertyName = objectProp.propertyName;
        let propertyDefinitionNode = objectProp.propertyDefinitionNode;
        let propUses = objectProp.objectPropertyUsages;
        let inLoc = propertyDefinitionNode.loc;

        // let mappedVarName = elementName + '_' + propertyName;

        //element's name resolved during analysis
        let mappedVarName = propertyName;
        let propertyAlias = objectProp.propertyAlias;

        let initializationNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyDefinitionNode);

        // let initializationNodes = astRootCollection.find(jscodeshiftAPI[propertyDefinitionNode.type]).filter(propertyDefNode => {

        //     if(propertyDefNode.value.loc == null) {

        //         return false;
        //     }

        //     let propDefLoc = propertyDefNode.value.loc;
        //     return propDefLoc.start.line === inLoc.start.line && propDefLoc.start.column === inLoc.start.column &&
        //             propDefLoc.end.line === inLoc.end.line && propDefLoc.end.column === inLoc.end.column;
        // });

        if(initializationNodes.length === 0) {

            return;
        }

        let initializationNode = initializationNodes.at(0).get().value;

        let mappedVarIdentifier = jscodeshiftAPI.identifier(mappedVarName);

        if(propertyDefinitionNode.type !== 'AssignmentExpression') {

            //property initialized with key-value pair
            //add the variable at the end of the AST
            let mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, initializationNode);
            let mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

            astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);
        }
        else {

            //property initialized with assignment
            //add variable (uninitialized) at the top of the AST
            //and replace member expression inside property definition with a variable reference
            let mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, null);
            let mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

            astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(mappedVarDeclaration);
        
            // console.log(initializationNode)
            let mbExps = jscodeshiftAPI(initializationNode).find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

                // return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === exportedElement.elementName &&
                //         mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyName;

                //properties/features are exported through its initial names
                //(updates might happen due to name conflicts)
                return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === exportedElement.elementAlias &&
                        mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === propertyAlias;
            });

            // console.log(mbExps.length)
            if(mbExps.length === 0) {

                return;
            }

            mbExps.replaceWith(mappedVarIdentifier);
        }

        //replace object property uses with variable uses
        propUses.forEach(objectPropUse => {

            let propRefs = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, objectPropUse);

            // let objectPropUseLoc = objectPropUse.loc;
            // let propUses = astRootCollection.find(jscodeshiftAPI[objectPropUse.type]).filter(objPropUse => {

            //     if(objPropUse.value.loc == null) {

            //         return false;
            //     }

            //     let objPropUseLoc = objPropUse.value.loc;
            //     return objPropUseLoc.start.line === objectPropUseLoc.start.line &&
            //             objPropUseLoc.start.column === objectPropUseLoc.start.column &&
            //             objPropUseLoc.end.line === objectPropUseLoc.end.line &&
            //             objPropUseLoc.end.column === objectPropUseLoc.end.column;
            // });

            if(propRefs.length === 0) {

                return;
            }

            propRefs.replaceWith(mappedVarIdentifier);
        });

        //also, keep the export specifier in the case objectProp is exported
        if(objectProp.isExported === true) {

            propertyObjs.push({

                exportedElName : mappedVarName,
                exportedElAlias: propertyAlias
                // exportedElAlias : propertyName
            });
        }
    });

    return propertyObjs;
}

/**
 * Introduces an ES6 named export statement for the exported object properties of exportedElement.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 * @param {*} propertyObjs 
 */
function exportObjectProperties(jscodeshiftAPI, astRootCollection, propertyObjs) {

    let exportSpecifiers = [];

    propertyObjs.forEach(propertyObj => {

        let mappedVarIdentifier = jscodeshiftAPI.identifier(propertyObj.exportedElName);
        let exportAliasIdentifier = jscodeshiftAPI.identifier(propertyObj.exportedElAlias);
        let exportSpecifier = jscodeshiftAPI.exportSpecifier(mappedVarIdentifier, exportAliasIdentifier);
        exportSpecifiers.push(exportSpecifier);
    });

    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);

    //insert ES6 export at the end of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
}

/**
 * Maps an object specifying a statement to the actual statement.
 * @param stmtObj the object specifying the statement
 */
function searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, stmtObj) {

	//stmtObj an object with the statement's type and location
	//(compliance with jscodeshift: also actual AST nodes can be searched
	//using the same function)
    let stmtType = stmtObj.type;
    let stmtLoc = stmtObj.loc;

    //search the statement in the AST
    return astRootCollection.find(jscodeshiftAPI[stmtType]).filter(resStmt => {

        if(resStmt.value.loc == null) {

            return false;
        }

        let resStmtLoc = resStmt.value.loc;
        return resStmtLoc.start.line === stmtLoc.start.line &&
                resStmtLoc.start.column === stmtLoc.start.column &&
                resStmtLoc.end.line === stmtLoc.end.line &&
                resStmtLoc.end.column === stmtLoc.end.column;
    });
}