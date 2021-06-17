/**
 * Export_IIFE.js. Codemod that transforms a library's IIFE with an ES6 default export.
 * Used for external libraries used in AMD projects.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    //the exported element is the AST node representing the IIFE
    let exportedElement = transformationInfo.exportedElement;

    // let exportedElementLoc = exportedElement.elementNode.loc;
    // let startLine = exportedElementLoc.start.line;
    // let startColumn = exportedElementLoc.start.column;
    // let endLine = exportedElementLoc.end.line;
    // let endColumn = exportedElementLoc.end.column;

    let variableName;
    let bindingIdentifier;
    let bindingDeclarator;
    let bindingDeclaration;
    let exportDefaultDeclaration;

    let programBody = astRootCollection.find(jscodeshiftAPI.Program).get('body').value.filter(prgStmt => {

        // console.log(prgStmt)
        return prgStmt.type !== 'EmptyStatement';
    });

    let stmtCollection = astRootCollection.find(jscodeshiftAPI.Statement).filter(stmt => {

        return stmt.value === programBody[0];
    });

    if(stmtCollection.length === 0) {

        return;
    }

    //retrieve the IIFE in the AST and replace it with an ES6 default export statement
    stmtCollection.replaceWith(path => {

        // console.log(path.value);

        //create a new variable, which is initialized with the expression 
        variableName = 'libraryObj_' + exportedElement.elementName;
        
        bindingIdentifier = jscodeshiftAPI.identifier(variableName);
        bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, path.value.expression);
        bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);

        exportDefaultDeclaration = jscodeshiftAPI.exportDefaultDeclaration(bindingIdentifier);
                
        //replace return statement with the AST node representing the binding variable definition
        return bindingDeclaration;
    });

    // console.log(jscodeshiftAPI(bindingDeclaration).toSource());

    //insert the ES6 default export right after the binding declaration
    astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
    {
        type: "VariableDeclarator",
        id: { name: variableName }
    }]}).insertAfter(exportDefaultDeclaration);
};