/**
 * Encapsulate_exported_definition.js. Codemod for encapsulating definitions returned from
 * the callbacks of define() that are not used in other modules. Applies to AMD modules.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    //map the definition returned from the callback to a module variable
    let returnStatementNodeLoc = returnStatementNode.loc;
    let returnStmts = astRootCollection.find(jscodeshiftAPI.ReturnStatement).filter(returnStmt => {

        if(returnStmt.value.loc == null) {

            return false;
        }

        let returnStmtLoc = returnStmt.value.loc;
        return returnStmtLoc.start.line === returnStatementNodeLoc.start.line &&
                returnStmtLoc.start.column === returnStatementNodeLoc.start.column &&
                returnStmtLoc.end.line === returnStatementNodeLoc.end.line &&
                returnStmtLoc.end.column === returnStatementNodeLoc.end.column;
    });

    if(returnStmts.length === 0) {

        return;
    }

    let returnStmt = returnStmts.at(0).get();
    let returnArg = returnStmt.value.argument;

    let variableIdentifier = jscodeshiftAPI.identifier('returnedValue');
    let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, returnArg);
    let variableDeclaration = jscodeshiftAPI.variableDeclaration('var', [variableDeclarator]);

    jscodeshiftAPI(returnStmt).replaceWith(variableDeclaration);
    return;
};