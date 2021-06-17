/**
 * Replace_moduleVariableModification.js. Codemod that renames each modification of the imported variable specified
 * in transformationInfo with a call expression to the respective modification function. This codemod introduces an
 * ES6 import statement in order to import the modification function.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    let modificationFunctions = transformationInfo.importedElement.modificationFunctions;

    // console.log(modificationFunctions);

    let modificationFunctionName;
    let modificationFunctionBodyStatements;
    let definitionModuleName = transformationInfo.importedElement.definitionModuleName;
    let importedElement = transformationInfo.importedElement;

    //modificationFunctionBodyStatement represents the statement 
    //where the module variable's modification is met 
    //(this statement is identical to the statement introduced in the modification function,
    //in order to prevent the runtime error due to module variable modification in ES6)
    let expressionCollection;

    modificationFunctions.forEach(modificationFunction => {

        modificationFunctionName = modificationFunction.modificationFunctionName;
        // modificationFunctionName = modificationFunctionName.replace(/-/g, '_');
        modificationFunctionBodyStatements = modificationFunction.modificationFunctionBodyStatements;

        // console.log(modificationFunctionBodyStatement.type);

        // if(modificationFunctionBodyStatement instanceof Array === true) {

        //     //bulk modification statements - each modification statement is corresponded to a modification function
        //     return;
        // }

        let identifier = jscodeshiftAPI.identifier(modificationFunctionName);

        modificationFunctionBodyStatements.forEach(modificationFunctionBodyStatement => {

            //create an identifier representing modificationFunctionName (needed in both the import statement and the call expression)
            let identifier = jscodeshiftAPI.identifier(modificationFunctionName);

            //(i) replace modificationFunctionBodyStatement with a call expression to the function with name modificationFunctionName
            expressionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, modificationFunctionBodyStatement);
            
            if(expressionCollection.length > 0) {

                expressionCollection.replaceWith(path => {

                    let elementRefs = jscodeshiftAPI(path).find(jscodeshiftAPI.Identifier).filter(id => {
    
                        return id.value.name === importedElement.elementName && 
                                id.parentPath.value.type !== 'MemberExpression';
                    });
    
                    // console.log(elementRefs.length)
    
                    //do not modify references inside member expressions
                    if(elementRefs.length === 0) {
    
                        return path.value;
                    }
    
                    //variable is modified through (a) update expression or (b) assignment expression
                    //replace modification statement with a call to the setter function
                    //(give the modification value as a parameter to the function)
    
                    let modFuncParamExp = null;
    
                    if(modificationFunctionBodyStatement.expression.type === 'UpdateExpression') {
    
                        //(a) UpdateExpression (++/--)
                        //syntax: a++/a--
                        //introduce a statement of form a-1/a+1
                        let leftOperand = jscodeshiftAPI.identifier(importedElement.elementName);
                        let binaryOp;
                        if(modificationFunctionBodyStatement.expression.operator === '++') {
    
                            binaryOp = '+';
                        }
                        else {
    
                            binaryOp = '-';
                        }
    
                        let rightOperand = jscodeshiftAPI.binaryExpression(binaryOp, leftOperand, jscodeshiftAPI.literal(1));
                        modFuncParamExp = rightOperand;
                    }
                    else if(modificationFunctionBodyStatement.expression.type === 'AssignmentExpression'){
    
                        //(b) AssignmentExpression (a <op> <value>)
                        //where op: "=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "|=", "^=", "&="
    
                        //introduce a statement of form a <op> value, when op != '=',
                        //otherwise a statement of form <value>
                        let assignmentOp;
                        let rightOperand = modificationFunctionBodyStatement.expression.right;
                        if(modificationFunctionBodyStatement.expression.operator === '=') {
    
                            modFuncParamExp = rightOperand;
                        }
                        else {
    
                            assignmentOp = modificationFunctionBodyStatement.expression.operator.replace('=', '');
                            let leftOperand = jscodeshiftAPI.identifier(importedElement.elementName);
                            modFuncParamExp = jscodeshiftAPI.binaryExpression(assignmentOp, leftOperand, rightOperand);
                        }
                    }
    
                    // console.log(modificationFunctionBodyStatement)
    
                    //create a call expression representing modificationFunctionName()
                    let callExpression = jscodeshiftAPI.callExpression(identifier, [modFuncParamExp]);
                    let expressionStmt = jscodeshiftAPI.expressionStatement(callExpression);
    
                    // console.log(jscodeshiftAPI(expressionStmt).toSource());
    
                    return expressionStmt;
                });
            }

            // bodyStatementLoc = modificationFunctionBodyStatement.loc;
            // bodyStatementStart = bodyStatementLoc.start;
            // bodyStatementEnd = bodyStatementLoc.end;

            // //(i) replace modificationFunctionBodyStatement with a call expression to the function with name modificationFunctionName
            // // console.log(modificationFunctionBodyStatement);
            // expressionCollection = astRootCollection.find(jscodeshiftAPI[modificationFunctionBodyStatement.type], {
            //     loc: { 
            //         start: { line: bodyStatementStart.line, column: bodyStatementStart.column },
            //         end: { line: bodyStatementEnd.line, column: bodyStatementEnd.column }
            //     }
            // }).replaceWith(path => {

            //     let elementRefs = jscodeshiftAPI(path).find(jscodeshiftAPI.Identifier).filter(id => {

            //         return id.value.name === importedElement.elementName && id.parentPath.value.type !== 'MemberExpression';
            //     });

            //     // console.log(elementRefs.length)

            //     //do not modify references inside member expressions
            //     if(elementRefs.length === 0) {

            //         return path.value;
            //     }

            //     //variable is modified through (a) update expression or (b) assignment expression
            //     //replace modification statement with a call to the setter function
            //     //(give the modification value as a parameter to the function)

            //     let modFuncParamExp = null;

            //     if(modificationFunctionBodyStatement.expression.type === 'UpdateExpression') {

            //         //(a) UpdateExpression (++/--)
            //         //syntax: a++/a--
            //         //introduce a statement of form a-1/a+1
            //         let leftOperand = jscodeshiftAPI.identifier(importedElement.elementName);
            //         let binaryOp;
            //         if(modificationFunctionBodyStatement.expression.operator === '++') {

            //             binaryOp = '+';
            //         }
            //         else {

            //             binaryOp = '-';
            //         }

            //         let rightOperand = jscodeshiftAPI.binaryExpression(binaryOp, leftOperand, jscodeshiftAPI.literal(1));
            //         modFuncParamExp = rightOperand;
            //     }
            //     else if(modificationFunctionBodyStatement.expression.type === 'AssignmentExpression'){

            //         //(b) AssignmentExpression (a <op> <value>)
            //         //where op: "=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "|=", "^=", "&="

            //         //introduce a statement of form a <op> value, when op != '=',
            //         //otherwise a statement of form <value>
            //         let assignmentOp;
            //         let rightOperand = modificationFunctionBodyStatement.expression.right;
            //         if(modificationFunctionBodyStatement.expression.operator === '=') {

            //             modFuncParamExp = rightOperand;
            //         }
            //         else {

            //             assignmentOp = modificationFunctionBodyStatement.expression.operator.replace('=', '');
            //             let leftOperand = jscodeshiftAPI.identifier(importedElement.elementName);
            //             modFuncParamExp = jscodeshiftAPI.binaryExpression(assignmentOp, leftOperand, rightOperand);
            //         }
            //     }

            //     // console.log(modificationFunctionBodyStatement)

            //     //create a call expression representing modificationFunctionName()
            //     let callExpression = jscodeshiftAPI.callExpression(identifier, [modFuncParamExp]);
            //     let expressionStmt = jscodeshiftAPI.expressionStatement(callExpression);

            //     // console.log(jscodeshiftAPI(expressionStmt).toSource());

            //     return expressionStmt;

            //     // return callExpression;

            //     //create an expression statement representing modificationFunctionName();
            //     // var expressionStatement = jscodeshiftAPI.expressionStatement(callExpression);

            //     // console.log(jscodeshiftAPI(expressionStatement).toSource());

            //     //replace module variable modification with the call to modificationFunctionName
            //     // return expressionStatement;
            // });

        });

        //(ii) insert an import statement at the top of the AST (import modificationFunctionName)
        let importSpecifier = jscodeshiftAPI.importSpecifier(identifier);

        //create the literal representing the module including the declaration of the element that is going to be imported
        let importSourceLiteral = jscodeshiftAPI.literal(definitionModuleName);

        //create import declaration
        let importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

        //insert import for modification function once
        let modFuncImports = astRootCollection.find(jscodeshiftAPI.ImportDeclaration).filter(impDecl => {

            return impDecl.value === importDeclaration;
        });

        if(modFuncImports.length > 0) {

            return;
        }

        //insert the newly created AST node (node representing the ES6 import statement) at the top of the AST
        astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);

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