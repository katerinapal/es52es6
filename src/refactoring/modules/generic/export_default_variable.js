/**
 * Export_variable.js. Codemod that adds an export statement in an module.
 * (Update: codemod that marks the variable returned from the callback function specified in transformationInfo as exported)
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);
    // console.log(transformationInfo.exportedElement.exportedVariableNode.loc);
    // console.log(astRootCollection.toSource());

    //variableDeclarator corresponds to the declaration of the variable
    //that is returned from the callback (third argument of call to define())
    let variableDeclarator = transformationInfo.exportedElement.initializationValueNode;
    let exportedVariableNode = transformationInfo.exportedElement.exportedVariableNode;
    let variableName = transformationInfo.exportedElement.variableName;

    let variableDeclarationCollection;
    let variableIdentifier;
    let exportDefaultDeclaration;

    let returnStatementCollection;
    let returnedValueNode;
    let bindingIdentifier;
    let bindingDeclarator;
    let bindingDeclaration;

    // console.log(variableDeclarator);

    if(variableDeclarator !== null) {

        // variableDeclaratorLoc = variableDeclarator.loc;
        // startLine = variableDeclaratorLoc.start.line;
        // startColumn = variableDeclaratorLoc.start.column;
        // endLine = variableDeclaratorLoc.end.line;
        // endColumn = variableDeclaratorLoc.end.column;

        //update: each AMD value returns (exports) 1 element, the element returned from the callback function
        //=> this element may be exported through an ES6 export default statement
        //update: switch default to named export

        //create an AST node representing the ES6 export default statement 
        //and insert it before the AST node representing the definition of the element
        variableIdentifier = jscodeshiftAPI.identifier(variableName);
        // exportDefaultDeclaration = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);
        exportDefaultDeclaration = jscodeshiftAPI.exportNamedDeclaration(null, [jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier)], null);

        //update: the replace of a define() hook may result in an existing ES6 export default declaration (1 export default/module is allowed)
        // console.log(astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration).length);

        if(astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration).length === 0) {

            //insert AST node representing ES6 export default after the AST node representing the declaration of the variable being exported
            //es6 default export statement is not hoisted
            variableDeclarationCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableDeclarator);
            if(variableDeclarationCollection.length > 0) {

                variableDeclarationCollection.insertAfter(exportDefaultDeclaration);
            }

            // variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {
            //     loc: { 
            //         start: { line: startLine, column: startColumn },
            //         end: { line: endLine, column: endColumn }
            //     }
            // }).insertAfter(exportDefaultDeclaration);
        }
    }
    else if(exportedVariableNode !== null) {

        //update: the element that is exported is not a variable (an expression, i.e. the result of a function call, is returned)

        //retrieve the collection comprising the return statements with the specified 'coordinates'
        returnStatementCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedVariableNode);
        
        if(returnStatementCollection.length > 0) {

            returnStatementCollection.replaceWith(path => {

                //ES6 exports are provided only names, not call expressions
                returnedValueNode = path.value.argument;
    
                //create a new variable, which is initialized with returnedValueNode 
                //(the expression that is returned from the callback function of define())
                bindingIdentifier = jscodeshiftAPI.identifier("bindingVariable");
                bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, returnedValueNode);
                bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);
    
                //replace return statement with the AST node representing the binding variable definition
                return bindingDeclaration;
            });
        }

        // returnStatementCollection = astRootCollection.find(jscodeshiftAPI.ReturnStatement, {
        //     loc: {
        //         start: { line: returnStatementStartLine, column: returnStatementStartColumn },
        //         end: { line: returnStatementEndLine, column: returnStatementEndColumn}
        //     }
        // }).replaceWith(path => {

        //     //ES6 exports are provided only names, not call expressions
        //     returnedValueNode = path.value.argument;

        //     //create a new variable, which is initialized with returnedValueNode 
        //     //(the expression that is returned from the callback function of define())
        //     bindingIdentifier = jscodeshiftAPI.identifier("bindingVariable");
        //     bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, returnedValueNode);
        //     bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);

        //     //replace return statement with the AST node representing the binding variable definition
        //     return bindingDeclaration;
        // });

        //create an AST node representing the ES6 export default statement and add it before the binding variable definition
        if(bindingIdentifier !== undefined) {

            // exportDefaultDeclaration = jscodeshiftAPI.exportDefaultDeclaration(bindingIdentifier);
            exportDefaultDeclaration = jscodeshiftAPI.exportNamedDeclaration(null, [jscodeshiftAPI.exportSpecifier(bindingIdentifier, bindingIdentifier)], null);
            astRootCollection.find(jscodeshiftAPI.VariableDeclaration, bindingDeclaration).insertAfter(exportDefaultDeclaration);
        }
        
    }

    // console.log(variableDeclaratorCollection.length);
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