/**
 * Export_variable.js. Codemod that marks a variable declaration as exported. 
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let exportedElement = transformationInfo.exportedElement;
    let exportedVariableDeclarationNode = exportedElement.elementNode;

    //retrieve function definition through its coordinates
    let variableDeclarationCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedVariableDeclarationNode);

    if(variableDeclarationCollection.length === 0) {

        return;
    }

    //exported variable with the same name exists (applied in libraries)
    //abort
    if(variableDeclarationCollection.at(0).get().parentPath.value instanceof Array !== true ||
    variableIsAlreadyExported(jscodeshiftAPI, astRootCollection, exportedElement) === true) {

        //variable declaration located within block (i.e. for statement)
        //do not export variable
        return;
    }

    variableDeclarationCollection.replaceWith(path => {

        const comments = path.value.comments;
        path.value.comments = '';
        const node  = path.node;
        var exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
        exportedNode.comments = comments;
        return exportedNode;
    });

    // var exportedVariableLoc = exportedVariableDeclarationNode.loc;
    // var exportedVariableStart = exportedVariableLoc.start;
    // var exportedVariableEnd = exportedVariableLoc.end;

    // //retrieve function definition through its coordinates
    // var variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {
    //     loc: { 
    //             start: { line: exportedVariableStart.line, column: exportedVariableStart.column },
    //             end: { line: exportedVariableEnd.line, column: exportedVariableEnd.column }
    //     }
    // });

    // if(variableDeclarationCollection.length === 1) {

    //     if(variableDeclarationCollection.at(0).get().parentPath.value instanceof Array !== true) {

    //         //variable declaration located within block (i.e. for statement)
    //         //do not export variable
    //         return;
    //     }

    //     variableDeclarationCollection.replaceWith(path => {

    //         const comments = path.value.comments;
	// 		path.value.comments = '';
	// 		const node  = path.node;
    //         var exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
    //         exportedNode.comments = comments;
    //         return exportedNode;
    //     });
    // }
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

/**
 * Is exportedElement already exported? Prevents duplicate exports in libraries
 * (where all module features are exported, regardless of their use).
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} exportedElement 
 * @returns 
 */
function variableIsAlreadyExported(jscodeshiftAPI, astRootCollection, exportedElement) {

    let expDecls = astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).filter(expDecl => {

        // console.log(expDecl)
        if(expDecl.value.declaration == null) {

            return false;
        }

        // console.log(expDecl)
        let decl = expDecl.value.declaration;

        if(decl.type !== 'VariableDeclaration') {

            return false;
        }

        let varDeclarator = decl.declarations.find(declarator => {

            return declarator.id.type === 'Identifier' &&
                    declarator.id.name === exportedElement.exportAlias;
        });

        if(varDeclarator != undefined) {

            return true;
        }

        return false;
    });

    return expDecls.length > 0;
}