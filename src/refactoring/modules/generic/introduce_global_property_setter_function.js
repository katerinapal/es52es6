/**
 * Introduce_global_property_setter_function.js. Codemod that is used for GOPM (Global Object Property
 * Modification) dependency establishment in a module that defines a global object property that is
 * modified in other modules.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(astRootCollection.toSource());

    //name of the module variable that is introduced during the definition codemod: global<Variable>
    let propertyName = 'global' + 
                        transformationInfo.importedElement.elementName.charAt(0).toUpperCase() + 
                        transformationInfo.importedElement.elementName.slice(1);
    
    //modification statement
    let propAccStmtNode = transformationInfo.importedElement.propertyAccessStatementNode;

    let propAccesses = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propAccStmtNode);
    if(propAccesses.length === 0) {

        return;
    }

    let propertyAccessStatementNode = propAccesses.at(0).get();

    //the name of the function that will be introduced (resolved in the analysis phase, in order to prevent object overwriting)
    let definitionFunctionName = transformationInfo.importedElement.definitionFunctionName;

    let functionCollection = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration).filter(path => {

        // console.log(path.value);
        return path.value != null && path.value.id.name === definitionFunctionName;
    });

    if(functionCollection.length !== 0) {

        return;
    }

    //(1) replace the property's usage with a usage of the introduced variable
    let statementCollection = jscodeshiftAPI(propertyAccessStatementNode.value).find(jscodeshiftAPI.MemberExpression).filter(path => {

        return path.value != null && (path.value.object.name === 'global' || path.value.object.name === 'window') &&
                path.value.property.name === transformationInfo.importedElement.elementName;
    }).replaceWith(jscodeshiftAPI.identifier(propertyName));

    //(2) replace the statement that makes use of global property with
    //a callsite of the newly introduced function (prevent transforming the statement inside the introduced function)
    replaceGlobalPropertyUseStatementWithDefinitionFunctionCallsite(jscodeshiftAPI, astRootCollection, propertyAccessStatementNode, definitionFunctionName, importedElement);

    //(3) introduce the modification function in the top of the AST (and export it)
    introduceVariableModificationFunction(jscodeshiftAPI, astRootCollection, definitionFunctionName, propertyAccessStatementNode.value, transformationInfo.importedElement.elementName);

    // console.log(astRootCollection.toSource());
};

/**
 * Introduces the function that modifies the introduced variable in the top of the AST specified by astRootCollection.
 * The function is specified by definitionFunctionName and its body comprises the statement specified by initializationStatementNode.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} definitionFunctionName 
 * @param {*} initializationStatementNode 
 */
function introduceVariableModificationFunction(jscodeshiftAPI, astRootCollection, definitionFunctionName, modificationStatementNode, propertyName) {

    // let leftOperand = initializationStatementNode.value.left;
    // let rightOperand = initializationStatementNode.value.right;
    // let assignmentExpression = jscodeshiftAPI.assignmentExpression('=', leftOperand, rightOperand);

    // console.log(modificationStatementNode);

    // modificationStatementNode.loc = null;

    //create the expression statement that will be introduced in the body of the function that is going to be created
    let expressionStatement = jscodeshiftAPI.expressionStatement(modificationStatementNode);

    //introduce the getter function right before the newly inserted variable definition
    introduceFunctionDeclaration(jscodeshiftAPI, astRootCollection, definitionFunctionName, expressionStatement, propertyName);
}

/**
 * Introduces the function definition specified by functionName in the AST specified by astRootCollection.
 */
function introduceFunctionDeclaration(jscodeshiftAPI, astRootCollection, functionName, statementNode, propertyName) {

    let functionArguments = [];
    let functionArgumentName;
    let functionArgument;

    if(statementNode.value.type === 'AssignmentExpression') {

        //modification statement is an assignment
        //the function that is introduced will take the expression in the assignment's right operand as a parameter
        //(during the call)
        //replace right operand with argument
        functionArgumentName = functionName + "_argument";
        functionArgument = jscodeshiftAPI.identifier(functionArgumentName);
        statementNode.value.right = functionArgument;

        functionArguments.push(functionArgument);
    }

    //create the block statement corresponding to the body of the function that is going to be created
    let blockStatement = jscodeshiftAPI.blockStatement([statementNode]);

    // console.log(jscodeshiftAPI(blockStatement).toSource());

    //create the function declaration whose body is represented by blockStatement
    let functionNameIdentifier = jscodeshiftAPI.identifier(functionName);
    let functionDeclaration = jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [functionArguments], blockStatement);

    //insert the function right before the module variable that is defined
    let variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration).filter(path => {

        let declarations = path.value.declarations;
        for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

            let declaration = declarations[declarationIndex];
            return declaration.id.name === propertyName && path.parentPath.parentPath.value.type === 'Program';
        }
    });

    let node = jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

    // console.log(astRootCollection.toSource());
    if(variableDeclarationCollection.length === 0) {

        //there are no such variable definitions
        //insert functionDeclaration at the top of the AST
        astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertAfter(node);
    }
    else {

        //insert function declaration right before the defined module variable
        variableDeclarationCollection.insertBefore(node);
    }
}

/**
 * Replaces the statement where a use of a global property is met with a callsite of the respective
 * setter function.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} propertyAccessStatementNode 
 * @param {*} definitionFunctionName 
 */
function replaceGlobalPropertyUseStatementWithDefinitionFunctionCallsite(jscodeshiftAPI, astRootCollection, propertyAccessStatementNode, definitionFunctionName, importedElement) {

    // let accessStatementLocStart = propertyAccessStatementNode.loc.start;
    // let accessStatementLocEnd = propertyAccessStatementNode.loc.end;
    let functionArguments = [];

    // console.log(astRootCollection.toSource());

    jscodeshiftAPI(propertyAccessStatementNode).replaceWith(path => {

        if(path.value.type === 'AssignmentExpression') {
            
            functionArguments.push(path.value.right);
        }

        // console.log(path.value);
        return jscodeshiftAPI.callExpression(jscodeshiftAPI.identifier(definitionFunctionName), functionArguments);
    });

    // astRootCollection.find(jscodeshiftAPI[propertyAccessStatementNode.type]).filter(path => {

    //     if(path.value.loc === null) {

    //         return false;
    //     }

    //     return path.value.loc.start.line === accessStatementLocStart.line && 
    //             path.value.loc.start.column === accessStatementLocStart.column &&
    //             path.value.loc.end.line === accessStatementLocEnd.line && 
    //             path.value.loc.end.column === accessStatementLocEnd.column;

    //     // return path.value === propertyAccessStatementNode;

    //     // return path.value.loc.start.line === accessStatementLocStart.line && path.value.loc.start.column === accessStatementLocStart.column &&
    //     //        path.value.loc.end.line === accessStatementLocEnd.line && path.value.loc.end.column === accessStatementLocEnd.column;
    // }).replaceWith(path => {

    //     if(path.value.type === 'AssignmentExpression') {
            
    //         functionArguments.push(path.value.right);
    //     }

    //     // console.log(path.value);
    //     return jscodeshiftAPI.callExpression(jscodeshiftAPI.identifier(definitionFunctionName), functionArguments);
    // });

    // console.log(astRootCollection.toSource());
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