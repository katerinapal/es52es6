/**
 * Replace_requireCallExpression.js. 
 * Helper codemod that replaces calls to require() with the body of the callback passed as third argument.
 * AMD-specific codemod.
 */

 exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
     
    // console.log(transformationInfo);

    //importedElementNode: AST node representing the statement that imports importedElement
    //(require() call)
    let importedElementNodes = transformationInfo.importedElement.importedElementNodes;

    importedElementNodes.forEach(importedElementNode => {

        let callParameters;
        let callbackFunctionExpression;
        let callbackBlockStatement;
        let blockStatementBody;

        //replace require() call with the body of the callback passed as third parameter
        //(search leverages the 'coordinates' of the call expression represented by functionNode and not the call expression itself,
        //as astRootCollection and the AST of the source file containing the function (AST created during the refactoring candidate identification procedure) do not reference the same object -
        //maybe this would be resolved if the refactoring candidate identification and the source code transformation procedures are unified into one process)
        let requireCallCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, importedElementNode);

        if(requireCallCollection.length === 0) {

            return;
        }

        requireCallCollection.filter(path => {

            return path.value.callee.name === 'require' || path.value.callee.name === 'requirejs';
        
        }).replaceWith(path => {

            // console.log(path);

            path.parentPath.value.comments = "";

            //retrieve parameters of call expression
            callParameters = path.value.arguments;

            //the last parameter corresponds to the callback
            callbackFunctionExpression = callParameters[callParameters.length-1];

            //retrieve the callback's body (block statement representing its body)
            callbackBlockStatement = callbackFunctionExpression.body;

            //retrieve the block statement's body (the set of the commands that are included in the callback function's body)
            blockStatementBody = callbackBlockStatement.body;

            if(blockStatementBody.length === 1) {

                // console.log(blockStatementBody[0].expression);
                //block statement contains 1 expression statement
                if(blockStatementBody[0].type === 'ExpressionStatement') {

                    //return expression
                    return blockStatementBody[0].expression;
                    // returnStatement = blockStatementBody[0].expression;
                }

                //otherwise, return the statement itself
                return blockStatementBody[0];
                // returnStatement = blockStatementBody[0];
            }
            
            //case: block statement contains multiple statements
            //(add statements at the the end of the array containing the statements of the program)
            //update: return statements outside function definitions are not allowed
            //the element that is referenced in return statement should be exported

            // console.log(jscodeshiftAPI(blockStatementBody).toSource());

            let programNode = astRootCollection.find(jscodeshiftAPI.Program);

            programNode.at(0).get().value.body = programNode.at(0).get().value.body.concat(blockStatementBody);

            // return blockStatementBody;
        });

        // var requireCallCollection = astRootCollection.find(jscodeshiftAPI.CallExpression, {
        //     loc: { 
        //             start: { line: startLine, column: startColumn },
        //             end: { line: endLine, column: endColumn }
        //     }
        // }).filter(path => {

        //     return path.value.callee.name === 'require' || path.value.callee.name === 'requirejs';
        // })
        // .replaceWith(path => {

        //     // console.log(path);

        //     path.parentPath.value.comments = "";

        //     //retrieve parameters of call expression
        //     callParameters = path.value.arguments;

        //     //the last parameter corresponds to the callback
        //     callbackFunctionExpression = callParameters[callParameters.length-1];

        //     //retrieve the callback's body (block statement representing its body)
        //     callbackBlockStatement = callbackFunctionExpression.body;

        //     //retrieve the block statement's body (the set of the commands that are included in the callback function's body)
        //     blockStatementBody = callbackBlockStatement.body;

        //     if(blockStatementBody.length === 1) {

        //         // console.log(blockStatementBody[0].expression);
        //         //block statement contains 1 expression statement
        //         if(blockStatementBody[0].type === 'ExpressionStatement') {

        //             //return expression
        //             return blockStatementBody[0].expression;
        //             // returnStatement = blockStatementBody[0].expression;
        //         }

        //         //otherwise, return the statement itself
        //         return blockStatementBody[0];
        //         // returnStatement = blockStatementBody[0];
        //     }
            
        //     //case: block statement contains multiple statements
        //     //(add statements at the the end of the array containing the statements of the program)
        //     //update: return statements outside function definitions are not allowed
        //     //the element that is referenced in return statement should be exported

        //     // console.log(jscodeshiftAPI(blockStatementBody).toSource());

        //     var programNode = astRootCollection.find(jscodeshiftAPI.Program);

        //     programNode.at(0).get().value.body = programNode.at(0).get().value.body.concat(blockStatementBody);

        //     // return blockStatementBody;
        // });

        // console.log(blockStatementBody);

        
    });

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