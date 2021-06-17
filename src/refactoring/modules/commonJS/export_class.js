/**
 * Export_class.js. Codemod used for exporting class definitions in CommonJS modules.
 */

var exports = module.exports = {};

exports.description = "export_class";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);
	
    var exportedElement = transformationInfo.exportedElement;
    var className = exportedElement.className;

    //retrieve the AST node representing the definition of the class that is going to become exported
    var classDeclarationNode = exportedElement.classDeclarationNode;

    //retrieve the AST node representing the initial export statement of the class 
    //(this statement needs to be removed from the AST)
    var exportedClassNode = exportedElement.exportedClassNode;

    //is class exported through assignment to module.exports? 
    //(if yes, an ES6 default export statement is introduced, otherwise an ES6 named export statement is introduced)
    var isClassExportedViaModuleExports = exportedElement.exportedThroughModuleExports;

    var classNodeLoc = classDeclarationNode.loc;
	var startLine = classNodeLoc.start.line;
	var startColumn = classNodeLoc.start.column;
	var endLine = classNodeLoc.end.line;
	var endColumn = classNodeLoc.end.column;

    var classDefinitionCollection;
    var classExpression;
    var assignmentExpressionCollection;
    var exportedNode;

    var exportStatementLoc;
    var exportStatementStartLine;
    var exportStatementStartColumn;
    var exportStatementEndLine;
    var exportStatementEndColumn;

    //(1) retrieve the AST node representing the class definition (search by the AST node's 'coordinates')
    if(classDeclarationNode.type === 'ClassDeclaration') {

        //ClassDeclaration: statement representing a plain class definition
        //syntax: class <className> {...}
        classDefinitionCollection = astRootCollection.find(jscodeshiftAPI.ClassDeclaration, {
            loc: { 
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
        }}).replaceWith(path => {

            const comments = path.value.comments;
			path.value.comments = '';
			const node  = path.node;
			var exportedNode;
			if(isClassExportedViaModuleExports === false) {

				//class is exported via exports-
				//it will be referenced with an import named statement
				//or through a reference to the imported namespace object

				exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
			}
			else {

				//class is exported via module.exports - it may be used directly in the imported module
				exportedNode = jscodeshiftAPI.exportDefaultDeclaration(node);
			}
			// const exportedNode = jscodeshiftAPI.exportNamedDeclaration(node);
			exportedNode.comments = comments;
			return exportedNode;
        });

    }
    else if(classDeclarationNode.type === 'ClassExpression') {

        //ClassExpression: statement representing the assignment of a class definition to a value
        classDefinitionCollection = astRootCollection.find(jscodeshiftAPI.ClassExpression, {
            loc: { 
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
        }});

        if(classDefinitionCollection.length === 1) {

			//retrieve user comments regarding class definition represented by classExpression
			//if the specific node does not contain comments, maybe his parent AST node contains comments
            //(retrieve these comments)
            
			classExpression = classDefinitionCollection.at(0).get();
            // console.log(classExpression);
            
            //retrieve the assignment collection containing the class definition
			assignmentExpressionCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
				right: 
					classExpression.value
			});

			// console.log(assignmentExpressionCollection.length);

			assignmentExpressionCollection.replaceWith(path => {

				var comments = path.value.comments;
				var parentNode = path;
				while(comments === undefined) {
						
					parentNode = parentNode.parentPath;
					comments = parentNode.value.comments;
				}
					
				if(isClassExportedViaModuleExports === false) {

					//case: class is exported via its assignment to a property of exports
					//A new variable named className is created. 
					//This variable will be assigned the class that is going to become exported.

					//update: what if class is exported (and used) with an alias?

					// console.log(path.value.left);

					var aliasName = path.value.left.property.name;
					var variableName;
					if(aliasName === undefined) {

						variableName = className;
					}
					else {

						variableName = aliasName;
					}
					
					//create identifier variableName
					var variableIdentifier = jscodeshiftAPI.identifier(variableName);
						
					//create variable declarator for variableName (syntax: <variableIdentifier> = class [<className>] {...})
					var variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, classExpression.value);
						
					//print statement represented by the variable declarator AST node (mainly for debugging)
		//			console.log(jscodeshiftAPI(variableDeclarator).toSource());
						
					//create variable declaration for variableName (syntax: var <variableIdentifier> = class [<className>] {...})
					var variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
						
					// console.log(jscodeshiftAPI(variableDeclaration).toSource());
						
					//create a node representing the export of the newly created variable
					exportedNode = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
				}
				else {

					//case: class is exported via module.exports)
					//an export default declaration is created
					//(syntax: export default class [<className>] {...})
					exportedNode = jscodeshiftAPI.exportDefaultDeclaration(classExpression.value);
				}
					
				exportedNode.comments = comments;

				return exportedNode;
			});

			//update: what if exportedNode is included in an assingment? (keep only right operand of that assignment)
			astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
				right:
					exportedNode
			}).replaceWith(path => {

				// console.log(path);

				return path.value.right;
			});
		}
    }

    //(2) remove the initial export statement
    exportStatementLoc = exportedClassNode.loc;
    exportStatementStartLine = exportStatementLoc.start.line;
    exportStatementStartColumn = exportStatementLoc.start.column;
    exportStatementEndLine = exportStatementLoc.end.line;
    exportStatementEndColumn = exportStatementLoc.end.column;

    astRootCollection.find(jscodeshiftAPI.AssignmentExpression, {
        loc: { 
            start: { line: exportStatementStartLine, column: exportStatementStartColumn },
            end: { line: exportStatementEndLine, column: exportStatementEndColumn }
    }}).remove();

	// console.log(astRootCollection.toSource());
}