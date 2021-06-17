/**
 * Create_variableBinding.js. Codemod that creates a variable binding to the variable specified in transformationInfo.
 * Replaces the identifiers corresponding to usages of the variable specified with usages of the variable binding.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    //case: there exists an imported global variable modification 
	//in the source code represented by astRootCollection - assign imported global
	//to a module variable (binding) and rename the usages of the imported global 
    //to usages of the module variable
    let importedElement = transformationInfo.importedElement;
    let importedElementName = importedElement.aliasName;
	let usedGlobalIdentifiers = importedElement.usageSet;
		
	//before inserting new AST nodes, rename any use of imported global
	//(avoid type error due to imported element overwriting in ES6)
		
	//(1) create binding to the imported element & 
	//replace each use of the importing global with the name of the binding
	let elementAlias = importedElementName + "Binding";
	let bindingIdentifier = jscodeshiftAPI.identifier(elementAlias);
		
	//(2) apply rename transformations based on the node representing
	//the identifier that need to be renamed
	usedGlobalIdentifiers.forEach(usedGlobalIdentifier => {
            
		//search usedGlobalIdentifier by AST node and replace it with the bindingIdentifier
		let usedGlobRefs = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, usedGlobalIdentifier);
		if(usedGlobRefs.length > 0) {

			usedGlobRefs.replaceWith(bindingIdentifier);
		}
		
        // astRootCollection.find(jscodeshiftAPI.Identifier, usedGlobalIdentifier).replaceWith(bindingIdentifier);
			
	});
		
	//insert node representing the binding declaration
	//after the node representing importDeclaration
	let initIdentifier = jscodeshiftAPI.identifier(importedElementName);
	let bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, initIdentifier);
	let bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);
	astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertAfter(bindingDeclaration);
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