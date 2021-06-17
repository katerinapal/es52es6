/**
 * Insert_moduleVariableModificationFunction.js. Codemod that inserts a function that modifies a module variable.
 * Triggered when an GlobalDefinition MDG edge is resolved (compatible with non-modular ES5).
 */

var deepClone = require('../../../../node_modules/lodash.clonedeep');

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    // let moduleVariableName = transformationInfo.exportedElement.elementName;

    //all features are exported under their initial names
    let moduleVariableName = transformationInfo.exportedElement.exportAlias;

    // console.log(moduleVariableDeclarationNode);

    let modificationFunctions = transformationInfo.exportedElement.modificationFunctions;

    if(modificationFunctions.length === 0) {

        return;
    }

    let functionName;
    let functionBodyStatement;

    let expressionStatement;
    let blockStatement;
    let functionNameIdentifier;
    let functionDeclaration;
    let exportNamedDeclaration;

    let moduleVariableDeclarationCollection;
    let moduleVariableDeclaration;
    let moduleVariableExportStatementNode;
    let functionBody;

    //moduleVariableInitializationNode represents the declaration of the module variable which is modified
    //(we attempt to insert the modification functions that will be created right after this AST node)
    moduleVariableDeclarationCollection = retrieveDeclarationOfModifiedModuleVariable(jscodeshiftAPI, astRootCollection, transformationInfo);

    // console.log(moduleVariableDeclarationCollection.length);
    if(moduleVariableDeclarationCollection.length === 0) {

        return;
    }

    functionName = modificationFunctions[0].modificationFunctionName;
    // functionBodyStatement = modificationFunction.modificationFunctionBodyStatement;

     //ES6 does not allow for dashes in names (webpack)
     // functionName = functionName.replace(/-/g, '_');

    //instantiate a function containing the variable's modification
    let leftOperand = jscodeshiftAPI.identifier(moduleVariableName);
    let rightOperand = jscodeshiftAPI.identifier('value');
    let assignmentExp = jscodeshiftAPI.assignmentExpression('=', leftOperand, rightOperand);
    expressionStatement = jscodeshiftAPI.expressionStatement(assignmentExp);

    blockStatement = jscodeshiftAPI.blockStatement([expressionStatement]);

    let functionParam = rightOperand;

    //(iii) create the function declaration whose body is represented by blockStatement
    functionNameIdentifier = jscodeshiftAPI.identifier(functionName);
    functionDeclaration = jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [functionParam], blockStatement);

    // console.log(functionDeclaration);
    // console.log(jscodeshiftAPI(functionDeclaration).toSource());

    //(iv) create an AST node representing an ES6 export statement (export the newly created function declaration)
    exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

    // console.log(jscodeshiftAPI(exportNamedDeclaration).toSource());

    //(v) insert the newly created exportNamedDeclaration right after the statement that exports the module variable
    moduleVariableDeclarationCollection.insertAfter(exportNamedDeclaration);

    // modificationFunctions.forEach(modificationFunction => {

    //     //create a new function containing the statement that modifies the module variable

    //     // console.log(modificationFunction);

    //     // functionName = modificationFunction.modificationFunctionName;
    //     // functionBodyStatement = modificationFunction.modificationFunctionBodyStatement;

    //     // console.log(functionBodyStatement);

    //     // //ES6 does not allow for dashes in names (webpack)
    //     // // functionName = functionName.replace(/-/g, '_');

    //     // //instantiate a function containing the variable's modification
    //     // let leftOperand = jscodeshiftAPI.identifier(moduleVariableName);
    //     // let rightOperand = jscodeshiftAPI.identifier('value');
    //     // let assignmentExp = jscodeshiftAPI.assignmentExpression('=', leftOperand, rightOperand);
    //     // let expressionStatement = jscodeshiftAPI.expressionStatement(assignmentExp);

    //     // blockStatement = jscodeshiftAPI.blockStatement([expressionStatement]);

    //     // // let bodyLoc = functionBodyStatement.loc;

    //     // // //instantiate a function with functionBodyStatement
    //     // // blockStatement = jscodeshiftAPI.blockStatement([deepClone(functionBodyStatement)]);

    //     // // console.log(jscodeshiftAPI(blockStatement).toSource());

    //     // let functionParam = rightOperand;

    //     // //(iii) create the function declaration whose body is represented by blockStatement
    //     // functionNameIdentifier = jscodeshiftAPI.identifier(functionName);
    //     // functionDeclaration = jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [functionParam], blockStatement);

    //     // // console.log(functionDeclaration);
    //     // // console.log(jscodeshiftAPI(functionDeclaration).toSource());

    //     // //(iv) create an AST node representing an ES6 export statement (export the newly created function declaration)
    //     // exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

    //     // // console.log(jscodeshiftAPI(exportNamedDeclaration).toSource());

    //     // //(v) insert the newly created exportNamedDeclaration right after the statement that exports the module variable
    //     // moduleVariableDeclarationCollection.insertAfter(exportNamedDeclaration);

    // });

    // console.log(astRootCollection.toSource());
};

function retrieveDeclarationOfModifiedModuleVariable(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let moduleVariableDeclarationCollection;
    // let moduleVariableDeclarationNode = transformationInfo.exportedElement.variableDeclarationNode;

    let moduleVariableDeclarationNode = transformationInfo.exportedElement.elementNode;
    if(moduleVariableDeclarationNode === undefined) {

        //case: an implied global is imported and modified
        moduleVariableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
        {
            type: "VariableDeclarator",
            id: { name: transformationInfo.exportedElement.elementName }
        }]});

        // console.log(moduleVariableDeclarationCollection.length);
        return moduleVariableDeclarationCollection;
    }

    moduleVariableDeclarationCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, moduleVariableDeclarationNode);

    // let variableDeclarationNodeLoc = moduleVariableDeclarationNode.loc;
    // let variableDeclarationStartLine = variableDeclarationNodeLoc.start.line;
    // let variableDeclarationStartColumn = variableDeclarationNodeLoc.start.column;
    // let variableDeclarationEndLine = variableDeclarationNodeLoc.end.line;
    // let variableDeclarationEndColumn = variableDeclarationNodeLoc.end.column;
    // moduleVariableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {
    //     loc: { 
    //         start: { line: variableDeclarationStartLine, column: variableDeclarationStartColumn },
    //         end: { line: variableDeclarationEndLine, column: variableDeclarationEndColumn }
    //     }
    // });

    return moduleVariableDeclarationCollection;
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