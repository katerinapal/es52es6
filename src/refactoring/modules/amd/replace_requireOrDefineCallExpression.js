/**
 * Replace_requireOrDefineCallExpression.js. 
 * Helper codemod that replaces calls to require() with the body of the callback passed as third argument.
 */

 exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
     
    // console.log(transformationInfo);

    //importedElementNode: AST node representing the statement that imports importedElement
    //(require() call)
    var importedElementNode = transformationInfo.importedElement.importedElementNode;

    // console.log(importedElementNode);

    var importedElementNodeLoc = importedElementNode.loc;
    var startLine = importedElementNodeLoc.start.line;
    var startColumn = importedElementNodeLoc.start.column;
    var endLine = importedElementNodeLoc.end.line;
    var endColumn = importedElementNodeLoc.end.column;

    var callParameters;
    var callbackFunctionExpression;
    var callbackBlockStatement;
    var blockStatementBody;

    //replace require() call with the body of the callback passed as third parameter
	//(search leverages the 'coordinates' of the call expression represented by functionNode and not the call expression itself,
	//as astRootCollection and the AST of the source file containing the function (AST created during the refactoring candidate identification procedure) do not reference the same object -
	//maybe this would be resolved if the refactoring candidate identification and the source code transformation procedures are unified into one process)
    var requireCallCollection = astRootCollection.find(jscodeshiftAPI.CallExpression, {
        loc: { 
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
        }
    }).replaceWith(path => {

        // console.log(path);

        path.parentPath.value.comments = "";

        //retrieve parameters of call expression
        callParameters = path.value.arguments;

        //the last parameter corresponds to the callback
        callbackFunctionExpression = callParameters[callParameters.length-1];

        //retireve the callback's body (block statement representing its body)
        callbackBlockStatement = callbackFunctionExpression.body;

        //retrieve the block statement's body (the set of the commands that are included in the callback function's body)
        blockStatementBody = callbackBlockStatement.body;

        // console.log(blockStatementBody);

        if(blockStatementBody.length == 1) {

            // console.log(blockStatementBody[0].expression);
            //block statement contains 1 expression statement
            if(blockStatementBody[0].type === 'ExpressionStatement') {

                //return expression
                return blockStatementBody[0].expression;
            }

            //otherwise, return the statement itself
            return blockStatementBody[0];
        }
        
        //case: block statement contains multiple statements
        //(add statements at the top level scope of module)
        var programNode = astRootCollection.find(jscodeshiftAPI.Program);
        programNode.at(0).get().value.body = blockStatementBody;

    });

 };