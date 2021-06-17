
exports.description = 'remove_redundant_import';

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let importNode = transformationInfo.importNode;
    let importNodeLoc = importNode.loc;

    // console.log(importNode);

    //find the statement containing importNode
    let statementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, importNode);

    // let statementCollection = astRootCollection.find(importNode['type']).filter(stmt => {

    //     if(stmt.value.loc === null) {

    //         return false;
    //     }

    //     let stmtLoc = stmt.value.loc;
    //     return stmtLoc.start.line === importNodeLoc.start.line && stmtLoc.start.column === importNodeLoc.start.column &&
    //             stmtLoc.end.line === importNodeLoc.end.line && stmtLoc.end.column === importNodeLoc.end.column;

    // });

    // console.log(statementCollection.length)
    if(statementCollection.length === 0) {

        return;
    }

    //replace require with an empty object
    //(a) invocation located in a member expression - replace member expression with null
    //(b) otherwise - replace invocation with an empty object
    statementCollection.forEach(stmt => {

        if(stmt.parentPath.value.type === 'MemberExpression') {

            return jscodeshiftAPI(stmt.parentPath).replaceWith(jscodeshiftAPI.literal(null));
        }
        
        return jscodeshiftAPI(stmt).replaceWith(jscodeshiftAPI.objectExpression([]));
    });

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