/**
 * Insert_module_import.js.
 * Codemod that insert an ES6 import of the form: import <identifier> from <modulePath>.
 * Needed in cases that a plain JS module imports elements from a module that does not export elements (i.e. an IIFE)
 */

var path = require('path');

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let importedElement = transformationInfo.importedElement;
    let importedSource = importedElement.definitionModuleName;
    let identifier;
    let importSpecifier;

    // console.log(astRootCollection.toSource())

    // import default declaration does not work in some libraries
    //add (a) 1 default import and (b) 1 module import (for side effects)

    //(a) import specifier depends on the importedSource's name and the imported library name
    //(prevent name conflicts with global object properties updated from IIFE)

    let elementName = importedElement.elementName.replace(/[^$\w\s]/gi, '').replace(/-./g, '');
    identifier = jscodeshiftAPI.identifier(elementName);
    importSpecifier = jscodeshiftAPI.importDefaultSpecifier(identifier);

    //create the literal representing the module including the declaration of the element that is going to be imported
    let importSourceLiteral = jscodeshiftAPI.literal(importedSource);
    // let importDefaultDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);
    // astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDefaultDeclaration);
    
    //(b)
    //(an ES6 import statement that imports nothing, but only references the module that needs to be executed)
    let importModuleDeclaration = jscodeshiftAPI.importDeclaration([], importSourceLiteral);
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importModuleDeclaration);

    // console.log(astRootCollection.toSource())
}