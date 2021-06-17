/**
 * Replace_global_property_reference_with_module_variable_reference.js. Codemod that replaces a usage of a global property
 * with a reference to the module variable that replaced it (the module variable is exported by default).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    let propertyName = transformationInfo.importedElement.elementName;
    let moduleVariableName = 'global' + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);

    // let propertyAccessStatementNode = transformationInfo.importedElement.propertyAccessStatementNode;

    let propAccStmtNode = transformationInfo.importedElement.propertyAccessStatementNode;
    let propAccStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propAccStmtNode);

    if(propAccStmts.length === 0) {

        return;
    }

    let propertyAccessStatementNode = propAccStmts.at(0).get().value;
    if(propertyAccessStatementNode instanceof Array === true) {

        propertyAccessStatementNode = propertyAccessStatementNode[0];
    }
    // console.log(propertyAccessStatementNode);
    // let accessStatementLocStart = propertyAccessStatementNode.loc.start;
    // let accessStatementLocEnd = propertyAccessStatementNode.loc.end;

    let moduleVariableIdentifier = jscodeshiftAPI.identifier(moduleVariableName);

    //replace use of global property with a call site of the respective module variable
    propAccStmts.replaceWith(path => {

        return moduleVariableIdentifier;
    });

    // let memberExpressionCollection = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(path => {

    //     return path.value.loc.start.line === accessStatementLocStart.line && path.value.loc.start.column === accessStatementLocStart.column &&
    //            path.value.loc.end.line === accessStatementLocEnd.line && path.value.loc.end.column === accessStatementLocEnd.column;
    // }). replaceWith(path => {

    //     return moduleVariableIdentifier;
    // });

    if(transformationInfo.importedElement.importFile === undefined) {

        return;
    }

    //import global variable from the variable's definition module
    //create identifier for importedElementName
    importIdentifier = moduleVariableIdentifier;

    //create import specifier (the element that is going to be imported)
    importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier);

    // console.log(jscodeshiftAPI(importSpecifier).toSource());

    //create the literal representing the module including the declaration of the element that is going to be imported
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