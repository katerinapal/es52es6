/**
 * Insert_import.js. Codemod that adds an import statement in an AMD module. Codemod specific to AMD (AMD does not use explicit import statements
 * like commonJS, but imported modules are passed as parameters in the calls to define()/require())
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);
    // console.log(astRootCollection.toSource());

    var importedElementName = transformationInfo.importedElement.elementName;
    var importedElementAlias = transformationInfo.importedElement.aliasName;
    var importedSource = transformationInfo.importedElement.definitionModuleName;

    //create identifiers for importedElementName/importedElementAlias
    var importIdentifier = jscodeshiftAPI.identifier(importedElementName);
    var aliasIdentifier = jscodeshiftAPI.identifier(importedElementAlias);

    //create import specifier (the element that is going to be imported)
    var importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, aliasIdentifier);
    // console.log(jscodeshiftAPI(importSpecifier).toSource());

    //create the literal representing the module including the declaration of the element that is going to be imported
    var importSourceLiteral = jscodeshiftAPI.literal(importedSource);

    //create import declaration
    var importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

    //insert the newly created AST node (node representing the ES6 import statement) after the last ES6 import statement
    var es6ImportStatements = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);
    // console.log(es6ImportStatements);
	if(es6ImportStatements.length > 0) {

		//ES6 import statements exist - add importDeclaration after the last ES6 import
		jscodeshiftAPI(es6ImportStatements.at(-1).get()).insertAfter(importDeclaration);
	}
	else {

		//ES6 import statements do not exist - add the top of the AST
		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
	}
    
    // astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
};