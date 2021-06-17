let path = require('path');

/**
 * Remove_returnStatement.js. Codemod that removes the return statement given. AMD-specific codemod 
 * (AMD does not use explicit export statements, but exports module through return statements in the
 * callback functions given as third parameters to define() calls).
 * Applies when the callback returns an object literal.
 */

 exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let filePath = transformationInfo.filePath;
    let exportedElement = transformationInfo.exportedElement;

    // let aliasName = (path.basename(filePath)).replace(/[^\w\s]/gi, '').replace(/-/g, '');

    let aliasName = exportedElement.exportAlias.replace(/-/g, '');
    let elementName = exportedElement.exportedElementName != null ? 
                        exportedElement.exportedElementName : 
                        'exported_' + aliasName; 

    let elementIdentifier = jscodeshiftAPI.identifier(elementName);

    // let elementNode = exportedElement.elementNode;
    // let returnStatementNode = exportedElement.returnStatementNode;
    // let objectProperties = exportedElement.objectProperties;

    //exportedElement not cohesive
    //(a) encapsulate object (replace return statement with a variable declaration)
    encapsulateObject(jscodeshiftAPI, astRootCollection, exportedElement, elementIdentifier);

    if(exportedElement.isExported === false) {

        return;
    }

    //exportedElement is not cohesive (it is decomposed to its properties)
    //and is not referenced itself in the analyzed project:
    //(b) map object properties to variables
    //(c) export the object's properties used in other modules
    if(exportedElement.isCohesive === false && exportedElement.isObjectReferenced === false) {

        //(b)
        let propertyObjs = mapObjectPropertiesToVariables(jscodeshiftAPI, astRootCollection, exportedElement, elementName);

        // console.log(astRootCollection.toSource());

        //(c)
        exportObjectProperties(jscodeshiftAPI, astRootCollection, exportedElement, propertyObjs);

        return;
    }

    //exportedElement is cohesive (not decomposed to its properties)
    //or not cohesive, but it is referenced itself in the analyzed project
    //export as-is
    // let exportSpecifier = jscodeshiftAPI.exportSpecifier(elementIdentifier, elementIdentifier);
    let exportAliasIdentifier = jscodeshiftAPI.identifier(aliasName);
    let exportSpecifier = jscodeshiftAPI.exportSpecifier(elementIdentifier, exportAliasIdentifier);
    let exportSpecifiers = [exportSpecifier];
    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);

    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
 };

 /**
  * Encapsulates object specified by exportedElement.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} exportedElement 
  * @param {*} elementName 
  */
function encapsulateObject(jscodeshiftAPI, astRootCollection, exportedElement, elementIdentifier) {

    //definition of object literal (identical to its initialization value)
    let elementNode = exportedElement.elementNode;
    let elemNodeLoc = elementNode.loc;

    //retrieve the object's initial value in the AST 
    //(in the case that it is provided as a parameter in define())
    let elementNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementNode);

    // let elementNodes = astRootCollection.find(jscodeshiftAPI[elementNode.type]).filter(initNode => {

    //     if(initNode.value.loc == null) {

    //         return false;
    //     }

    //     let initNodeLoc = initNode.value.loc;
    //     return initNodeLoc.start.line === elemNodeLoc.start.line && 
    //             initNodeLoc.start.column === elemNodeLoc.start.column &&
    //             initNodeLoc.end.line === elemNodeLoc.end.line &&
    //             initNodeLoc.end.column === elemNodeLoc.end.column;
    // });

    if(elementNodes.length === 0) {

        return;
    }

    //introduce a variable initialized with the object's value
    let initValueNode = elementNodes.at(0).get();
    let elementDeclarator = jscodeshiftAPI.variableDeclarator(elementIdentifier, initValueNode.value);
    let elementDeclaration = jscodeshiftAPI.variableDeclaration('var', [elementDeclarator]);

    let returnStatementNode = exportedElement.returnStatementNode;

    // console.log(returnStatementNode)

    //object provided as a parameter to define()
    if(returnStatementNode == null) {

        //add variable declaration at the end of the AST
        astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(elementDeclaration);
        return;
    }

    //object returned from callback function
    let returnStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, returnStatementNode);

    // let returnStatementLoc = returnStatementNode.loc;

    // //replace returnStatementNode with a variable declaration
    // //(a variable initialized with the encapsulated object)
    // let returnStmts = astRootCollection.find(jscodeshiftAPI.ReturnStatement).filter(returnStmt => {

    //     if(returnStmt.value.loc == null) {

    //         return false;
    //     }

    //     let returnStmtLoc = returnStmt.value.loc;
    //     return returnStmtLoc.start.line === returnStatementLoc.start.line && returnStmtLoc.start.column === returnStatementLoc.start.column &&
    //             returnStmtLoc.end.line === returnStatementLoc.end.line && returnStmtLoc.end.column === returnStatementLoc.end.column;
    // });

    if(returnStmts.length === 0) {

        return;
    }

    returnStmts.forEach(returnStmt => {

        jscodeshiftAPI(returnStmt).replaceWith(elementDeclaration);
    });
    
    // returnStmts.replaceWith(elementDeclaration);
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
        let inLoc = propertyDefinitionNode.loc;

        // let mappedVarName = elementName + '_' + propertyName;

        //element's name and alias resolved during analysis
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
        let mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, initializationNode);
        let mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

        astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);

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
function exportObjectProperties(jscodeshiftAPI, astRootCollection, exportedElement, propertyObjs) {

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