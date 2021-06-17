/**
 * Replace_defineCallExpression.js. 
 * Helper codemod that replaces calls to 
 * define()/require()/requirejs() with the body of the callback passed as third argument
 * (exclusively).
 * AMD-specific codemod.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(astRootCollection.toSource());
    // console.log(transformationInfo);

    let resultObject = {

        isExportedElementAnObject: false,
        exportedProperties: 0
    };

    let exportedElement = transformationInfo.exportedElement;
    // let elementNode = exportedElement.elementNode;
    // let returnStatementNode = exportedElement.returnStatementNode;
    // let objectProperties = exportedElement.objectProperties;
    let surrExpressionNode = exportedElement.surrExpressionNode;

    //retrieve AST node representing surrExpressionNode, which 
    //contains the builtin function invocation with exportedElement as third argument
    let stmtCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, surrExpressionNode);

    // let surrExpressionLoc = surrExpressionNode.loc;
    // let stmtCollection = astRootCollection.find(jscodeshiftAPI.ExpressionStatement).filter(stmt => {

    //     if(stmt.value.loc === null) {

    //         return false;
    //     }

    //     let stmtLoc = stmt.value.loc;
    //     return stmtLoc.start.line === surrExpressionLoc.start.line && stmtLoc.start.column === surrExpressionLoc.start.column &&
    //             stmtLoc.end.line === surrExpressionLoc.end.line && stmtLoc.end.column === surrExpressionLoc.end.column;
    // });

    if(stmtCollection.length === 0) {

        return resultObject;
    }

    let stmt = stmtCollection.at(0).get();

    //the last argument of define() is a callback function
    //replace stmt with the body of the callback function
    if(exportedElement.dataType === 'callback') {

        replaceBuiltinFuncInvStmtWithCallbackBody(jscodeshiftAPI, astRootCollection, stmt, exportedElement);
        return resultObject;
    }

    // //export object (or its properties)
    // //if it is the argument of define()
    //this is addressed in the export codemod
    // if(exportedElement.dataType === 'object') {

    //     let elementNodeLoc = elementNode.loc;
    //     let objectExpressions = astRootCollection.find(jscodeshiftAPI[elementNode.type]).filter(elNode => {

    //         if(elNode.value.loc == null) {

    //             return false;
    //         }

    //         let elNodeLoc = elNode.value.loc;
    //         return elNodeLoc.start.line === elementNodeLoc.start.line && elNodeLoc.start.column === elementNodeLoc.start.column &&
    //                 elNodeLoc.end.line === elementNodeLoc.end.line && elNodeLoc.end.column === elementNodeLoc.end.column;
    //     });

    //     if(objectExpressions.length === 0) {

    //         return resultObject;
    //     }

    //     let variableIdentifier = jscodeshiftAPI.identifier(exportedElement.elementName);
    //     let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, objectExpressions.at(0).get().value);
    //     let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
    
    //     //replace statement with variableDeclaration
    //     jscodeshiftAPI(stmt).replaceWith(variableDeclaration);
    
    //     let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);

    //     let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

    //     //insert ES6 export at the end of the AST
    //     astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
    // }

    //require()/requirejs() invocation with 1 statement
    //(a module is referenced - a module import is already introduced)
    //remove the statement containing function invocation
    stmtCollection.remove();
    
    return resultObject;

};

/**
 * Replaces statement with the body of the function given as the callback of the contained invocation.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} statement expression containing builtin function invocation
 */
function replaceBuiltinFuncInvStmtWithCallbackBody(jscodeshiftAPI, astRootCollection, statement, exportedElement) {

    let returnStatementNode = exportedElement.returnStatementNode;

    let funcInvocation = statement.value.expression;
    let callee = funcInvocation.callee;
    let calleeArguments = funcInvocation.arguments;
    let callbackFuncExpression = calleeArguments[calleeArguments.length - 1];

    //function body is a BlockStatement
    let callbackFuncExpressionBody = callbackFuncExpression.body;
    let callbackBody = callbackFuncExpressionBody.body;

    // console.log(callbackBody);

    //replace expression statement with the first statement of the callback
    jscodeshiftAPI(statement).replaceWith(callbackBody[0]);

    //the other statements are added one after the other in the AST
    //keep the statement order, 
    //while not needing to search the location to add the statements (scope)
    //remove first statement of array
    let previousStmt = callbackBody.shift();

    callbackBody.forEach(funcStmt => {

        let previousStmtCollection = astRootCollection.find(jscodeshiftAPI[previousStmt.type]).filter(stmt => {

            return stmt.value === previousStmt;
        });
        
        if(previousStmtCollection.length > 0) {

            previousStmtCollection.insertAfter(funcStmt);
            previousStmt = funcStmt;
        }

    });

    //if callee is require()/requirejs(),
    //also encapsulate the callback's returned definition (if any)
    //(replace return statement with a variable initialized with the return argument)
    if(callee.type === 'Identifier' &&
        (callee.name === 'require' || callee.name === 'requirejs' ||
         callee.name === 'define' && exportedElement.isExported === false)) {

        if(returnStatementNode == null) {

            return;
        }

        let returnStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, returnStatementNode);

        // let returnStatementNodeLoc = returnStatementNode.loc;
        // let returnStmts = astRootCollection.find(jscodeshiftAPI.ReturnStatement).filter(returnStmt => {

        //     if(returnStmt.value.loc == null) {

        //         return false;
        //     }

        //     let returnStmtLoc = returnStmt.value.loc;
        //     return returnStmtLoc.start.line === returnStatementNodeLoc.start.line &&
        //             returnStmtLoc.start.column === returnStatementNodeLoc.start.column &&
        //             returnStmtLoc.end.line === returnStatementNodeLoc.end.line &&
        //             returnStmtLoc.end.column === returnStatementNodeLoc.end.column;
        // });

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
    }

    // console.log(astRootCollection.toSource());
}

/**
 * Introduces a variable initialized with the objectLiteral specified in exportedElement 
 * at the end of the AST specified in astRootCollection.
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function assignExportedObjectToVariable(jscodeshiftAPI, astRootCollection, exportedElement) {

    let exportedElementName = 'exportedObject';
    let variableIdentifier = jscodeshiftAPI.identifier(exportedElementName);
    let objectExpressionASTNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedElement.objectExpressionASTNode);

    if(objectExpressionASTNodes.length === 0) {

        return;
    }

    let objectExpressionASTNode = objectExpressionASTNodes.at(0).get().value;
    let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, objectExpressionASTNode);

    // let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, exportedElement.objectExpressionASTNode);
    let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

     //insert variable declaration at the end of the AST
     astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);

    //  console.log(astRootCollection.toSource())
}

/**
 * For each accessed property of the object specified in exportedElement, 
 * it introduces a variable at the end of the AST specified in astRootCollection.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function mapAccessedObjectPropertiesToVariables(jscodeshiftAPI, astRootCollection, exportedElement) {

    let objectProperties = exportedElement.objectProperties;

    //needed for the construction of the ES6 named statement with respect to the accessed properties
    let exportDeclarationNameObjects = [];
    let exportDeclarationNameObject = null;

    objectProperties.forEach(objectProperty => {

        if(objectProperty.isExported === false) {

            //objectProperty not accessed - no need to be exported (improve encapsulation)
            //proceed to the next property
            return;
        }

        let objectName = "exportedObject";
        let propertyName = objectProperty.propertyName;
        let propertyValues = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, objectProperty.propertyDefinitionNode);

        if(propertyValues.length === 0) {

            return;
        }

        let propertyValue = propertyValues.at(0).get().value;
        // let propertyValue = objectProperty.propertyDefinitionNode.value;
        let variableName = objectName + '_' + propertyName;

        //the introduced variable will be exported with propertyName as an alias
        //(recall that in the initial code, the property is accessed, not the variable)
        exportDeclarationNameObject = {

            declarationName: variableName,
            aliasName: propertyName
        }

        //the new variable will be initialized with a member expression of the form exportedObject.<propertyName>
        let variableIdentifier = jscodeshiftAPI.identifier(variableName);
        let objectIdentifier = jscodeshiftAPI.identifier(objectName);
        let propertyIdentifier = jscodeshiftAPI.identifier(propertyName);

        //create a member expression whose property is static (not calculated)
        let memberExpression = jscodeshiftAPI.memberExpression(objectIdentifier, propertyIdentifier, false);
        let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, memberExpression);
        let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

        //insert variable declaration at the end of the AST
        astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);

        exportDeclarationNameObjects.push(exportDeclarationNameObject);
    });

    return exportDeclarationNameObjects;
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