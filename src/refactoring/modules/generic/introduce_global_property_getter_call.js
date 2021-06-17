/**
 * Introduce_global_property_getter_call.js. Codemod that replaces a usage of a global property
 * with a callsite of the respective getter function (the getter function is exported by default).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    let propertyName = transformationInfo.importedElement.elementName;
    let getterFunctionName = 'getGlobal' + 
                            propertyName.charAt(0).toUpperCase() + 
                            propertyName.slice(1);

    let propAccessStatementNode = transformationInfo.importedElement.propertyAccessStatementNode;
    let propAccessNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propAccessStatementNode);
    if(propAccessNodes.length === 0) {

        return;
    }

    //1-1 mapping between node and its location
    let propertyAccessStatementNode = propAccessNodes.at(0).get().value;
    if(propertyAccessStatementNode instanceof Array === true) {

        propertyAccessStatementNode = propertyAccessStatementNode[0];
    }
    // console.log(propertyAccessStatementNode);

    let getterFunctionIdentifier = jscodeshiftAPI.identifier(getterFunctionName);

    //replace use of global property with a call site of the respective getter function
    let memberExpressionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyAccessStatementNode);
    if(memberExpressionCollection.length === 0) {

        return;
    }
    
    let getterInvoc = jscodeshiftAPI.callExpression(getterFunctionIdentifier, [])
    memberExpressionCollection.replaceWith(path => {

        return getterInvoc;
    });
    
    // let memberExpressionCollection = astRootCollection.find(jscodeshiftAPI[accessedStatementType]).filter(path => {

    //     return path.value.loc.start.line === accessStatementLocStart.line && path.value.loc.start.column === accessStatementLocStart.column &&
    //            path.value.loc.end.line === accessStatementLocEnd.line && path.value.loc.end.column === accessStatementLocEnd.column;
    // }). replaceWith(path => {

    //     return jscodeshiftAPI.callExpression(getterFunctionIdentifier, []);
    // });

    // let memberExpressionCollection = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(path => {

    //     return path.value.loc.start.line === accessStatementLocStart.line && path.value.loc.start.column === accessStatementLocStart.column &&
    //            path.value.loc.end.line === accessStatementLocEnd.line && path.value.loc.end.column === accessStatementLocEnd.column;
    // }). replaceWith(path => {

    //     return jscodeshiftAPI.callExpression(getterFunctionIdentifier, []);
    // });

    if(transformationInfo.importedElement.importFile === undefined) {

        return;
    }

    //import getter function from the variable's definition module
    //create identifier for importedElementName
    importIdentifier = getterFunctionIdentifier;

    //create import specifier (the element that is going to be imported)
    importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier);

    // console.log(jscodeshiftAPI(importSpecifier).toSource());

    //create the literal representing the module including the declaration of the element that is going to be imported
    //TODO: add the definition module's name in transformationInfo
    importSourceLiteral = jscodeshiftAPI.literal(transformationInfo.importedElement.importFile);

    //create import declaration
    importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

    //insert the newly created AST node (node representing the ES6 import statement) at the top of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
};

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