/**
 * Export_IIFE.js. Codemod that transforms a library's IIFE with an ES6 default export.
 * Used for external libraries used in AMD projects.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    //the exported element is the AST node representing the IIFE
    var exportedElement = transformationInfo.exportedElement;

    var exportedElementLoc = exportedElement.loc;
    var startLine = exportedElementLoc.start.line;
    var startColumn = exportedElementLoc.start.column;
    var endLine = exportedElementLoc.end.line;
    var endColumn = exportedElementLoc.end.column;

    var variableName;
    var bindingIdentifier;
    var bindingDeclarator;
    var bindingDeclaration;
    var exportDefaultDeclaration;

    //retrieve the IIFE in the AST and replace it with an ES6 default export statement
    var expressionStatementCollection = astRootCollection.find(jscodeshiftAPI.ExpressionStatement, {
        loc: { 
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
        }
    }).replaceWith(path => {

        // console.log(path.value);

        //create a new variable, which is initialized with the expression 
        variableName = 'bindingVariable';
        
        bindingIdentifier = jscodeshiftAPI.identifier(variableName);
        bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, path.value.expression);
        bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);

        exportDefaultDeclaration = jscodeshiftAPI.exportDefaultDeclaration(bindingIdentifier);
                
        //replace return statement with the AST node representing the binding variable definition
        return bindingDeclaration;
    });

    //insert the ES6 default export right after the binding declaration
    astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
    {
        type: "VariableDeclarator",
        id: { name: variableName }
    }]}).insertAfter(exportDefaultDeclaration);
};