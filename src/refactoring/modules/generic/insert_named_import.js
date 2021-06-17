/**
 * Insert_named_import.js. Codemod that inserts an ES6 named import statement.
 * (Needed in cases when an AMD module imports elements from a plain JS module through a call to require()).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(astRootCollection.toSource());

    let dependencyType = transformationInfo.dependencyType;

    // console.log(transformationInfo);
    // console.log(astRootCollection.toSource());
    // console.log(dependencyType);

    let importedElementName = transformationInfo.importedElement.elementName;
    let importedSource = transformationInfo.importedElement.definitionModuleName;
    let importIdentifier;
    let importSpecifier;
    let importSourceLiteral;
    let importDeclaration;

    if(transformationInfo.importedElement.usageSet.length === 0) {

        //imported element is not used within the module
        return;
    }

    importedElementName = importedElementName.replace(/-/g, '_');

    //create identifier for importedElementName
    importIdentifier = jscodeshiftAPI.identifier(importedElementName);

    //create import specifier (the element that is going to be imported)
    importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier);

    // console.log(jscodeshiftAPI(importSpecifier).toSource());

    //create the literal representing the module including the declaration of the element that is going to be imported
    importSourceLiteral = jscodeshiftAPI.literal(importedSource);

    //create import declaration
    importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

    //insert the newly created AST node (node representing the ES6 import statement) at the top of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);

    // console.log(astRootCollection.toSource());
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