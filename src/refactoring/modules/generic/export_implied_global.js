/**
 * Export_implied_global.js. Codemod that marks
 * an implied global as exported (the implied's definition introduction
 * is decoupled from its export).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    let impliedGlobalName = transformationInfo.exportedElement.variableName;
    let creationStatement = transformationInfo.exportedElement.creationStatement;
    let modificationFunctions = transformationInfo.exportedElement.modificationFunctions;

    let impliedGlobalIdentifier = jscodeshiftAPI.identifier(impliedGlobalName);

    let creationStatementType = creationStatement.type;

    if(creationStatementType !== 'ExpressionStatement') {

        return;
    }
    
    //implied global is introduced in an expression statement
    //(mark this variable as exported)
    let exportSpecifier = jscodeshiftAPI.exportSpecifier(impliedGlobalIdentifier, impliedGlobalIdentifier);
			
	//create an named export (the exported specifier is not a variable/function definition,
	//it is the element referenced by importedProperty)
    let exportNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
        
    //insert ES6 export at the end of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportNode);

    //create the modification functions with respect to the implied global
    modificationFunctions.forEach(modificationFunction => {

        introduceFunctionDeclaration(jscodeshiftAPI, astRootCollection, impliedGlobalName, modificationFunction);
    });

    replaceExportObjectReferencesWithEmptyObjectReferences(jscodeshiftAPI, astRootCollection, transformationInfo.exportedElement);

    // console.log(astRootCollection.toSource());
};

/**
 * Maps each modification of an implied global to 
 * a function definition that is going to be called.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} impliedGlobalName 
 * @param {*} modificationFunction 
 */
function introduceFunctionDeclaration(jscodeshiftAPI, astRootCollection, impliedGlobalName, modificationFunction) {

    //generate the function's name (ES6 does not allow dashes between names)
    let modificationFunctionName = modificationFunction.modificationFunctionName.replace(/-/g, '_');

    let modificationFunctionArguments = [];
    let modificationFunctionArgument = jscodeshiftAPI.identifier(`${modificationFunctionName}_argument`);

    //generate the function's body
    modificationFunction.modificationFunctionBodyStatements.forEach(modFuncStmtObj => {

        let resStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, modFuncStmtObj);

        if(resStmts.length === 0) {

            return;
        }

        let resStmt = resStmts.at(0).get();
        let modificationFunctionStatement = resStmt.value.type === 'ExpressionStatement' ?
                                            resStmt.value.expression :
                                            resStmt.value;


        if(modificationFunctionStatement.type === 'AssignmentExpression' && 
            modificationFunctionStatement.right.type !== 'Literal') {

            //modification statement is an assignment expression, 
            //where the right operand is computed
            //replace right operand with the argument of the function to be introduced
            modificationFunctionStatement.left.loc = null;
            modificationFunctionStatement.left.range = null;
            modificationFunctionStatement.right = modificationFunctionArgument;
            modificationFunctionArguments.push(modificationFunctionArgument);
        }
        else if(modificationFunctionStatement.type === 'UpdateExpression') {

            modificationFunctionStatement.argument.loc = null;
            modificationFunctionStatement.argument.range = null;
        }

        //empty location and range before moving
        modificationFunctionStatement.loc = null;
        modificationFunctionStatement.range = null;

        // console.log(modificationFunctionStatement);
        // console.log(jscodeshiftAPI(modificationFunctionStatement).toSource());

        let expressionStatement;
        if(modificationFunctionStatement.type === 'AssignmentExpression' || 
            modificationFunctionStatement.type === 'UpdateExpression') {

            //create the expression statement that will be introduced in the body of the function that is going to be created
            expressionStatement = jscodeshiftAPI.expressionStatement(modificationFunctionStatement);
        }
        else {

            //block statement (for, while...)
            expressionStatement = modificationFunctionStatement;
        }

        if(expressionStatement == null) {

            return;
        }
        
        // console.log(jscodeshiftAPI(expressionStatement).toSource());

        //introduce the setter function right before the newly inserted variable definition
        //create the block statement corresponding to the body of the function that is going to be created
        let blockStatement = jscodeshiftAPI.blockStatement([expressionStatement]);

        //blockStatement made of ast nodes
        //empty location and range of all inner expressions
        //before moving to the new function
        jscodeshiftAPI(blockStatement).find(jscodeshiftAPI.Statement).replaceWith(path => {

            path.value.loc = path.value.range = null;
            return path.value;
        });

        // console.log(jscodeshiftAPI(blockStatement).toSource());

        // //create the function declaration whose body is represented by blockStatement
        let functionNameIdentifier = jscodeshiftAPI.identifier(modificationFunctionName);
        let functionDeclaration = jscodeshiftAPI.functionDeclaration(functionNameIdentifier, modificationFunctionArguments, blockStatement);

        // console.log(jscodeshiftAPI(functionDeclaration).toSource());

        let functionDeclarations = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, functionDeclaration);
        if(functionDeclarations.length !== 0) {

            //prevent introducing the same function twice (case: multiple definitions of property in module)
            return;
        }

        //insert the function right before the module variable that is defined
        let variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration).filter(path => {

            let declarations = path.value.declarations;
            if(declarations.find(declaration => {

                return declaration.id.name === impliedGlobalName && 
                        path.parentPath.parentPath.value.type === 'Program';

            }) != undefined) {

                return true;
            };

            return false;
            
            // for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

            //     let declaration = declarations[declarationIndex];
            //     return declaration.id.name === impliedGlobalName && path.parentPath.parentPath.value.type === 'Program';
            // }
        });

        //modification function: it is exported from the module
        let node = jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

        // console.log(jscodeshiftAPI(node).toSource());
            
        if(variableDeclarationCollection.length === 0) {

            //there are no such variable definitions
            //insert functionDeclaration at the top of the AST
            astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertAfter(node);
            return;
        }
        
        //insert function declaration right before the defined module variable
        variableDeclarationCollection.insertBefore(node);
    });
    
    // let modificationFunctionName = modificationFunction.modificationFunctionName;
    // modificationFunctionName = modificationFunctionName.replace(/-/g, '_');
    // let modificationFunctionStatement = modificationFunction.modificationFunctionBodyStatement;

    // let modificationFunctionArgument = jscodeshiftAPI.identifier(modificationFunctionName + "_argument");
    // let modificationFunctionArguments = [];

    // // console.log(jscodeshiftAPI(modificationFunctionArgument).toSource());

    // if(modificationFunctionStatement.type === 'AssignmentExpression' && modificationFunctionStatement.right.type !== 'Literal') {

    //     //modification statement is an assignment expression, where the right operand is computed
    //     //replace right operand with the argument of the function to be introduced
    //     modificationFunctionStatement.left.loc = null;
    //     modificationFunctionStatement.left.range = null;
    //     modificationFunctionStatement.right = modificationFunctionArgument;
    //     modificationFunctionArguments.push(modificationFunctionArgument);
    // }
    // else if(modificationFunctionStatement.type === 'UpdateExpression') {

    //     modificationFunctionStatement.argument.loc = null;
    //     modificationFunctionStatement.argument.range = null;
    // }

    // modificationFunctionStatement.loc = null;
    // modificationFunctionStatement.range = null;
    // // modificationFunctionStatement

    // // console.log(modificationFunctionStatement);
    // // console.log(jscodeshiftAPI(modificationFunctionStatement).toSource());

    // let expressionStatement;
    // if(modificationFunctionStatement.type === 'AssignmentExpression' || modificationFunctionStatement.type === 'UpdateExpression') {

    //     //create the expression statement that will be introduced in the body of the function that is going to be created
    //     expressionStatement = jscodeshiftAPI.expressionStatement(modificationFunctionStatement);
    // }
    // else {

    //     //block statement (for, while...)
    //     expressionStatement = modificationFunctionStatement;
    // }
    
    // // console.log(jscodeshiftAPI(expressionStatement).toSource());

    // //introduce the setter function right before the newly inserted variable definition
    // //create the block statement corresponding to the body of the function that is going to be created
    // let blockStatement = jscodeshiftAPI.blockStatement([expressionStatement]);

    // jscodeshiftAPI(blockStatement).find(jscodeshiftAPI.Statement).replaceWith(path => {

    //     path.value.loc = path.value.range = null;
    //     return path.value;
    // });

    // // console.log(jscodeshiftAPI(blockStatement).toSource());

    // //create the function declaration whose body is represented by blockStatement
    // let functionNameIdentifier = jscodeshiftAPI.identifier(modificationFunctionName);
    // let functionDeclaration = jscodeshiftAPI.functionDeclaration(functionNameIdentifier, modificationFunctionArguments, blockStatement);

    // // console.log(jscodeshiftAPI(functionDeclaration).toSource());

    // let functionDeclarations = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, functionDeclaration);
    // if(functionDeclarations.length !== 0) {

    //     //prevent introducing the same function twice (case: multiple definitions of property in module)
    //     return;
    // }

    // //insert the function right before the module variable that is defined
    // let variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration).filter(path => {

    //     let declarations = path.value.declarations;
    //     for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

    //         let declaration = declarations[declarationIndex];
    //         return declaration.id.name === impliedGlobalName && path.parentPath.parentPath.value.type === 'Program';
    //     }
    // });

    // //modification function: it is exported from the module
    // let node = jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

    // // console.log(jscodeshiftAPI(node).toSource());
        
    // if(variableDeclarationCollection.length === 0) {

    //     //there are no such variable definitions
    //     //insert functionDeclaration at the top of the AST
    //     astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertAfter(node);
    // }
    // else {

    //     //insert function declaration right before the defined module variable
    //     variableDeclarationCollection.insertBefore(node);
    // }
}

/**
 * In the case that impliedGlobal is initialized with the export object, 
 * the function replaces the export object references with empty objects.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 */
function replaceExportObjectReferencesWithEmptyObjectReferences(jscodeshiftAPI, astRootCollection, exportedElement) {

    let creationStatementObj = exportedElement.creationStatement;
    let creationStatementLoc = creationStatementObj.loc;

    let crStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, creationStatementObj)

    // let crStmts = astRootCollection.find(jscodeshiftAPI[creationStatement.type]).filter(crStmt => {

    //     if(crStmt.value.loc == null) {

    //         return false;
    //     }

    //     let crStmtLoc = crStmt.value.loc;
    //     return crStmtLoc.start.line === creationStatementLoc.start.line &&
    //             crStmtLoc.start.column === creationStatementLoc.start.column &&
    //             crStmtLoc.end.line === creationStatementLoc.end.line &&
    //             crStmtLoc.end.column === creationStatementLoc.end.column;
    // });

    if(crStmts.length === 0) {

        return;
    }

    let crStmtAST = jscodeshiftAPI(crStmts.at(0).get());

    let objectExp = jscodeshiftAPI.objectExpression([]);

    let expObjRefs = crStmtAST.find(jscodeshiftAPI.Identifier).filter(id => {

        return id.value.name === 'exports' &&
                id.parentPath.value.type !== 'MemberExpression';
    });

    if(expObjRefs.length > 0) {

        expObjRefs.replaceWith(objectExp);
    }

    expObjRefs = crStmtAST.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

        return mbExp.value.object.type === 'Identifier' &&
                mbExp.value.object.name === 'module' &&
                mbExp.value.property.type === 'Identifier' &&
                mbExp.value.property.name === 'exports' &&
                mbExp.parentPath.value.type !== 'MemberExpression';
    });

    if(expObjRefs.length > 0) {

        expObjRefs.replaceWith(objectExp);
    }
}

/**
 * Maps an object specifying a statement to the actual statement.
 * @param modFuncStmtObj the object specifying the statement
 */
function searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, modFuncStmtObj) {

    let stmtType = modFuncStmtObj.type;
    let stmtLoc = modFuncStmtObj.loc;

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