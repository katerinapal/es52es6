/**
 * Remove_requireHook.js. Helper codemod that removes calls to require(), where the modules referenced
 * in the module dependency array are not mapped to parameters in the callback function (the function
 * given as the last argument of the call to require()).
 */

 exports.refactoring = function(jscodeshiftAPI, astRootCollection) {

    let requireHookArguments;
    let callbackFunction;
    let callbackFunctionBody;
    let callbackFunctionArguments;

    //update: remove calls to require() with module dependencies are not mapped to parameters of the callback function 
    //(not modelled as import statements, as the imported module is not used (referenced) in the source code)
    let requireHookCollection = astRootCollection.find(jscodeshiftAPI.CallExpression).filter(path => {

        // console.log(path);

        if(path.value.callee.type === 'Identifier' &&
           (path.value.callee.name === 'require' || path.value.callee.name === 'requirejs')) {

            //path represents a call to require()/requirejs()
            //retrieve its parameters
            requireHookArguments = path.value.arguments;

            //the callback function is the last parameter of the require() call
            callbackFunction = requireHookArguments[requireHookArguments.length-1];

            // console.log(callbackFunction);

            //retrieve the callback function's arguments
            callbackFunctionArguments = callbackFunction.params;

            // console.log(callbackFunctionArguments);

            //retrieve the callback function's body (the require hook will be replaced with these statements)
            if(callbackFunction.type !== 'FunctionExpression') {

                //case: the last argument of require() is not a function
                return;
            }
            callbackFunctionBody = callbackFunction.body.body;

            //if callback has no arguments, the module defined in the module dependency array are not mapped to objects
            //replace call with the body of the callback function
            // return callbackFunctionArguments.length === 0;
            return true;
        }

        return false;

        
    }).replaceWith(path => {

        // console.log(callbackFunctionBody.length);

        //replace require hook with the body of the function given as the last parameter
        if(callbackFunctionBody.length === 1) {

            // console.log(callbackFunctionBody[0].expression);
            //block statement contains 1 expression statement
            if(callbackFunctionBody[0].type === 'ExpressionStatement') {

                //return expression
                return callbackFunctionBody[0].expression;
            }

            //otherwise, return the statement itself
            return callbackFunctionBody[0];
        }
        
        //case: block statement contains multiple statements
        //(add statements at the the end of the array containing the statements of the program)

        // console.log(jscodeshiftAPI(callbackFunctionBody).toSource());

        let programNode = astRootCollection.find(jscodeshiftAPI.Program);

        programNode.at(0).get().value.body = programNode.at(0).get().value.body.concat(callbackFunctionBody);
    });
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