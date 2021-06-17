/**
 * Export_function.js. Codemod that marks a function definition as exported, through the introduction of an ES6 named export.
 * (Needed in cases when an AMD module import a plain JS module. The plain JS module should export all the top-level scope function definitions).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let exportedElement = transformationInfo.exportedElement;
    let exportedFunctionNode = exportedElement.elementNode;

    //retrieve function definition through its coordinates
    let functionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedFunctionNode);

    if(functionCollection.length === 0) {

        return;
    }

    functionCollection.replaceWith(path => {

        const comments = path.value.comments;
        path.value.comments = '';
        const node  = path.node;
        var exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
        exportedNode.comments = comments;
        return exportedNode;
    });

    // var exportedFunctionLoc = exportedFunctionNode.loc;

    // if(exportedFunctionLoc === null) {

    //     return;
    // }

    // var exportedFunctionStart = exportedFunctionLoc.start;
    // var exportedFunctionEnd = exportedFunctionLoc.end;

    // //retrieve function definition through its coordinates
    // var functionCollection = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, {
    //     loc: { 
    //             start: { line: exportedFunctionStart.line, column: exportedFunctionStart.column },
    //             end: { line: exportedFunctionEnd.line, column: exportedFunctionEnd.column }
    //     }
    // });
    // if(functionCollection.length === 1) {

    //     functionCollection.replaceWith(path => {

    //         const comments = path.value.comments;
	// 		path.value.comments = '';
	// 		const node  = path.node;
    //         var exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
    //         exportedNode.comments = comments;
    //         return exportedNode;
    //     });
    // }
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