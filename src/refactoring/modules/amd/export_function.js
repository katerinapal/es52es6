/**
 * Export_function.js. Codemod that adds an export statement in an AMD module. Codemod specific to AMD 
 * (AMD does not use export statements explicitly
 * like CommonJS, but exported modules are the values returned from the callback of define()).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let exportedElement = transformationInfo.exportedElement;

    let elementNode = exportedElement.elementNode;
    let elemNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementNode);

    if(elemNodeCollection.length > 0) {

        //function assigned to a member expression (property)
        let elemNode = elemNodeCollection.at(0).get();
        if(elemNode.parentPath.value.type === 'AssignmentExpression' &&
           elemNode.parentPath.value.left.type === 'MemberExpression' &&
           elemNode.parentPath.value.right === elemNode.value) {

            return;
        }
    }

    let elementName = exportedElement.elementName.replace(/[^\w\s]/gi, '').replace(/-/g, '');
    let elementAlias = exportedElement.elementAlias.replace(/[^\w\s]/gi, '').replace(/-/g, '');
    
    //(a) map returned function to the variable that is going to be exported
    //(b) replace return statement with the introduced variable definition
    // let mappedVarName = 'exported_' + elementName;

    //element's name and alias resolved during analysis
    let mappedVarName = elementName;
    let mappedVarIdentifier = jscodeshiftAPI.identifier(mappedVarName);
    // let exportAliasName = elementName;
    let exportAliasName = elementAlias;
    let exportAliasIdentifier = jscodeshiftAPI.identifier(exportAliasName);

    // console.log(jscodeshiftAPI(mappedVarIdentifier).toSource())
    // console.log(jscodeshiftAPI(exportAliasIdentifier).toSource())

    let mappedVarDeclaration = mapReturnedFunctionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarIdentifier);
    if(mappedVarDeclaration === null) {

        return;
    }

    //(c) add an ES6 named export for the introduced variable right after its definition
    introduceES6NamedExportForVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarDeclaration, mappedVarIdentifier, exportAliasIdentifier);
};

/**
 * Maps the returned function to a variable that is going to be exported from the module.
 * Replaces the return statement (if exists) with the respective variable definition in the AST.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 * @param {*} mappedVarIdentifier 
 */
function mapReturnedFunctionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarIdentifier) {

    let elementName = exportedElement.elementName;
    let elementAlias = exportedElement.elementAlias;
    let returnNode = exportedElement.returnStatementNode;
    let elementNode = exportedElement.elementNode;

    let mappedVarDeclarator;
    let mappedVarDeclaration;

    //variable to be mapped to an exported variable is not returned
    //(e.g. a top-level definition)
    //assign the variable's value (name for a named function, 
    //element's value name for an anonymus function) to the mapped variable
    //and add variable definition in the end of the AST
    if(returnNode == null) {

        if(elementName !== 'anonymus') {

            // mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, jscodeshiftAPI.identifier(elementName));

            //feature is renamed to mod_<elementName>, but exported under its initial name
            mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, jscodeshiftAPI.identifier(elementAlias));
            mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

            astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);
            return mappedVarDeclaration;
        }
        
        //anonymus function expression - assign its value to the mapped variable
        let functionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementNode);

        // let elNodeLoc = elementNode.loc;
        // let functionCollection = astRootCollection.find(jscodeshiftAPI[elementNode.type]).filter(stmt => {

        //     if(stmt.value.loc == null) {

        //         return false;
        //     }

        //     let stmtLoc = stmt.value.loc;

        //     return stmtLoc.start.line === elNodeLoc.start.line && 
        //             stmtLoc.start.column === elNodeLoc.start.column &&
        //             stmtLoc.end.line === elNodeLoc.end.line &&
        //             stmtLoc.end.column === elNodeLoc.end.column;

        // });

        if(functionCollection.length === 0) {

            return null;
        }

        let functionDef = functionCollection.at(0).get();
        // if(functionDef.value.type === 'FunctionExpression') {

        //     mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, functionDef.value);
        //     mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

        //     astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);
        //     return mappedVarDeclaration;
        // }

        let surrStmtCollection = jscodeshiftAPI(functionDef).closest(jscodeshiftAPI.ExpressionStatement);
        if(surrStmtCollection.length === 0) {

            return null;
        }

        let surrStmt = surrStmtCollection.at(0).get();
        mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, surrStmt.value.expression);
        mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

        jscodeshiftAPI(surrStmt).replaceWith(mappedVarDeclaration);
        // astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(mappedVarDeclaration);
        return mappedVarDeclaration;
    }

    // let returnLoc = returnStatementNode.loc;

    let returnStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, returnNode);
    if(returnStmts.length === 0) {

        return null;
    }

    let returnStatementNode = returnStmts.at(0).get().value;
    let returnArgument = returnStatementNode.argument;

    //map returned value of the callback function
    //(variable/function reference/function expression)
    //to a variable (assign argument of return statement to the new variable)
    mappedVarDeclarator = jscodeshiftAPI.variableDeclarator(mappedVarIdentifier, returnArgument);
    mappedVarDeclaration = jscodeshiftAPI.variableDeclaration('var', [mappedVarDeclarator]);

    // let returnStmts = astRootCollection.find(jscodeshiftAPI.ReturnStatement).filter(returnStmt => {

    //     if(returnStmt.value.loc == null) {

    //         return false;
    //     }

    //     let returnStmtLoc = returnStmt.value.loc;
    //     return returnStmtLoc.start.line === returnLoc.start.line && returnStmtLoc.start.column === returnLoc.start.column &&
    //             returnStmtLoc.end.line === returnLoc.end.line && returnStmtLoc.end.column === returnLoc.end.column;
    // });

    // if(returnStmts.length === 0) {

    //     return null;
    // }

    returnStmts.replaceWith(mappedVarDeclaration);

    return mappedVarDeclaration;
}

/**
 * Adds an ES6 named export for the variable specified in mappedVarDeclaration
 * right after its definition in the AST.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} mappedVarDeclaration 
 * @param {*} mappedVarIdentifier 
 * @param {*} exportAliasIdentifier 
 */
function introduceES6NamedExportForVariable(jscodeshiftAPI, astRootCollection, exportedElement, mappedVarDeclaration, mappedVarIdentifier, exportAliasIdentifier) {

    //do not export function in the case that:
    //(a) it is not cohesive and
    //(b) it has function properties and
    //(c) it is not fully referenced and 
    //(d) it is not used besides its properties
    if(exportedElement.isCohesive === false && 
        exportedElement.functionProperties.length > 0 &&
        exportedElement.isObjectReferenced === false &&
        exportedElement.usedBesidesProperties === false) {

        return;
    }

    let exportSpecifier = jscodeshiftAPI.exportSpecifier(mappedVarIdentifier, exportAliasIdentifier);
    let exportSpecifiers = [exportSpecifier];
    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, exportSpecifiers, null);
    
    // console.log(jscodeshiftAPI(exportStatement).toSource())
    // console.log(jscodeshiftAPI(mappedVarDeclaration).toSource())
    // console.log(mappedVarDeclaration);

    let mappedVarDefs = astRootCollection.find(jscodeshiftAPI[mappedVarDeclaration.type]).filter(mappedVarDef => {

        return mappedVarDef.value === mappedVarDeclaration;
    });

    if(mappedVarDefs.length === 0) {

        return;
    }

    mappedVarDefs.insertAfter(exportStatement);
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