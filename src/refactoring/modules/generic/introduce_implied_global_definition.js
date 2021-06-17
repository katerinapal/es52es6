/**
 * Introduce_implied_global_definition.js. Codemod that introduces the definition of an implied global right 
 * before its creation statement.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    let impliedGlobalName = transformationInfo.exportedElement;
    let creationStatementObj = transformationInfo.creationStatement;
    let isAssigned = transformationInfo.isAssigned;
    let isDefined = transformationInfo.isDefined;

    let impliedGlobalIdentifier;
    let variableDeclarator;
    let variableDeclaration;

    let createStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, creationStatementObj);

    if(createStmts.length === 0) {

        return;
    }

    let creationStatement = createStmts.at(0).get().value;

    //add a variable declaration for implied global
    //only in the case that it (a) is defined in the module
    //or (b) is assigned in a block statement (iteration loop)
    if(isDefined === false &&
        (isAssigned === true && creationStatement.type === 'ExpressionStatement')) {

        return;
    }

    //for each implied global, introduce 1 variable declaration in top-level scope of the module
    let variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
    {
        type: "VariableDeclarator",
        id: { name: impliedGlobalName }
    }]}).filter(varDec => {

        let closestScopes = jscodeshiftAPI(varDec).closestScope();
        closestScopes = closestScopes.filter(closestScope => {

            // console.log(closestScope.value);
            return closestScope.value.type === 'Program';
        });

        return closestScopes.length > 0;
    });

    //add variable declaration in the case that it is not already introduced
    //in the module's top-level scope
    // console.log(variableDeclarations.length)
    if(variableDeclarations.length !== 0) {

        //there already exists a variable definition with the same name
        return;
    }

    //insert an AST node representing the variable declaration
    impliedGlobalIdentifier = jscodeshiftAPI.identifier(impliedGlobalName);
    variableDeclarator = jscodeshiftAPI.variableDeclarator(impliedGlobalIdentifier, null);
    variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

    //add variableDeclaration right after the last ES6 import
    //1 variable is introduced for each set of implied globals with the same name
    //all these are references of 1 global property
    let importStmts = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);
    if(importStmts.length > 0) {

        jscodeshiftAPI(importStmts.at(-1).get()).insertAfter(variableDeclaration);
        return;
    }

    //ES6 imports do not exist
    //add variable declaration at the top of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);

    // console.log(astRootCollection.toSource());
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