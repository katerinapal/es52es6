/**
 * Insert_import.js. Codemod that adds an import statement in a module.
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(astRootCollection.toSource());

    let dependencyType = transformationInfo.dependencyType;

    // console.log(transformationInfo.importedElement);
    // console.log(dependencyType);

    let importedElement = transformationInfo.importedElement;
    let importedElementName = importedElement.elementName != null ? 
                                importedElement.elementName.replace(/[^$\w\s]/gi, '').replace(/-./g, ''):
                                null;

    let importedAliasName = importedElement.aliasName != null ?
                            importedElement.aliasName :
                            importedElementName;

    let importedSource = importedElement.definitionModuleName;
    let objectProperties = importedElement.objectProperties;
    let isObjectReferenced = importedElement.isObjectReferenced;

    let importSpecifier;
    let importSourceLiteral;
    let importDeclaration;

    let importIdentifier;
    let aliasIdentifier;

    //create the literal representing the module including the declaration of the element that is going to be imported
    importSourceLiteral = jscodeshiftAPI.literal(importedSource);

    //introduce an ES6 named import with respect to importedElement
    //or its properties (in the case it is decomposed after refactoring)

    if(dependencyType === 'ModuleImport') {

        // console.log(importedElementName);
        // console.log(importedElementName == null)
        if(importedElementName == null) {

            //a module is imported for its side-effects (no exported definitions are imported, thus no renamings needed)
            //module import statement is replaced with an ES6 module import statement during the removal
            //(syntax: import <modulePath>)
            importDeclaration = jscodeshiftAPI.importDeclaration([], importSourceLiteral);
        
            // console.log(jscodeshiftAPI(importDeclaration).toSource())
            // console.log(astRootCollection.find(jscodeshiftAPI.Program).get('body',0).value)

            // add import declaration at the top of the AST
            jscodeshiftAPI(astRootCollection.find(jscodeshiftAPI.Program).get('body',0)).insertBefore(importDeclaration);
            return;
        }
        
        importIdentifier = jscodeshiftAPI.identifier(importedElementName);
        importSpecifier = jscodeshiftAPI.importDefaultSpecifier(importIdentifier);

        importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

        // console.log(jscodeshiftAPI(importDeclaration).toSource())
        // console.log(astRootCollection.find(jscodeshiftAPI.Program).get('body',0).value);

        // add import declaration at the top of the AST
        jscodeshiftAPI(astRootCollection.find(jscodeshiftAPI.Program).get('body',0)).insertBefore(importDeclaration);

        // console.log(astRootCollection.toSource())
        return;
    }
    // console.log(importedElement)

    let elRefs = locateImportedElUsagesInAST(jscodeshiftAPI, astRootCollection, importedElement);
    if(elRefs.length === 0) {

        return;
    }

    //create identifiers for importedElementName and its alias
    importIdentifier = jscodeshiftAPI.identifier(importedElementName);
    aliasIdentifier = jscodeshiftAPI.identifier(importedAliasName);

    //create import specifier (the element that is going to be imported)
    //update: AMD module exports 1 element, the element that is returned from the callback function of define() (this element is exported via an ES6 export default statement)
    //an AST node representing the imported element's ES6 import named statement is created
    let importSpecifiers = [];
    if(importedElement.dataType === 'property' && isObjectReferenced === false) {

        //for each property:
        //(a) add an import specifier for property (it is imported under an alias)
        //(b) rename property references to its propertyAlias
        objectProperties.forEach(objectProp => {

            let propertyName = objectProp.propertyName;
            let propertyAliasName = objectProp.propertyAlias;
            // let propertyAliasName = importedSource.replace(/[^\w\s]/gi, '').replace(/-/g, '') + '_' + propertyName;
            
            let propertyIdentifier = jscodeshiftAPI.identifier(propertyName);
            let propertyAliasIdentifier = jscodeshiftAPI.identifier(propertyAliasName);
            // importSpecifier = jscodeshiftAPI.importSpecifier(propertyIdentifier, propertyAliasIdentifier);
            // importSpecifiers.push(importSpecifier);

            let propertyReferences = retrieveElementPropertyReferences(propertyName, elRefs);
            propertyReferences.forEach(propertyRef => {

                jscodeshiftAPI(propertyRef.parentPath).replaceWith(propertyAliasIdentifier);
            });

            //property is referenced in module
            if(propertyReferences.length > 0) {

                importSpecifier = jscodeshiftAPI.importSpecifier(propertyIdentifier, propertyAliasIdentifier);
                importSpecifiers.push(importSpecifier);
            }
        });
    }
    else {

        if(importedElement.dataType === 'variable' && 
            importedElement.isFunctionConstructor === false &&
            importedElement.objectProperties.length > 0) {

            //for each object property:
            //(a) add an import specifier for property (it is imported under an alias)
            //(b) rename property references to its propertyAlias
            objectProperties.forEach(objectProp => {

                let propertyName = objectProp.propertyName;
                let propertyAliasName = objectProp.propertyAlias;
                // let propertyAliasName = importedSource.replace(/[^\w\s]/gi, '').replace(/-/g, '') + '_' + propertyName;
                
                let propertyIdentifier = jscodeshiftAPI.identifier(propertyName);
                let propertyAliasIdentifier = jscodeshiftAPI.identifier(propertyAliasName);
                // importSpecifier = jscodeshiftAPI.importSpecifier(propertyIdentifier, propertyAliasIdentifier);
                // importSpecifiers.push(importSpecifier);

                let propertyReferences = retrieveElementPropertyReferences(propertyName, elRefs);
                propertyReferences.forEach(propertyRef => {

                    jscodeshiftAPI(propertyRef.parentPath).replaceWith(propertyAliasIdentifier);
                });

                //property is referenced in module
                if(propertyReferences.length > 0) {

                    importSpecifier = jscodeshiftAPI.importSpecifier(propertyIdentifier, propertyAliasIdentifier);
                    importSpecifiers.push(importSpecifier);
                }
            });
        }
        else {

            importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, aliasIdentifier);
            importSpecifiers.push(importSpecifier);
        }
        
    }

    if(importSpecifiers.length === 0) {

        return;
    }

    //create import declaration
    importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

    // add import declaration at the top of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
};

/**
 * Locates the references of importedElement in the AST.
 * Returns the retrieved references.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} importedElement 
 */
function locateImportedElUsagesInAST(jscodeshiftAPI, astRootCollection, importedElement) {

    let elementUsages = importedElement.usageSet;
    let elRefIdentifiers = [];

    elementUsages.forEach(elementUsage => {

        let refIds = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementUsage);

        // let elUseLoc = elementUsage.loc;
        // let refIds = astRootCollection.find(jscodeshiftAPI[elementUsage.type]).filter(elRef => {

        //     if(elRef.value.loc == null) {

        //         return false;
        //     }

        //     let elRefLoc = elRef.value.loc;
        //     return elRefLoc.start.line === elUseLoc.start.line && elRefLoc.start.column === elUseLoc.start.column &&
        //             elRefLoc.end.line === elUseLoc.end.line && elRefLoc.end.column === elUseLoc.end.column;
        // });

        if(refIds.length === 0) {

            return;
        }

        refIds.forEach(refId => {

            elRefIdentifiers.push(refId);
        });
    });

    return elRefIdentifiers;
}

/**
 * Returns the AST nodes that correspond to references of propertyName.
 * @param {*} propertyName 
 * @param {*} elementRefs 
 */
function retrieveElementPropertyReferences(propertyName, elementRefs) {

    return elementRefs.filter(elRef => {

        if(elRef.parentPath.value.type !== 'MemberExpression') {

            return false;
        }

        return elRef.parentPath.value.property.type === 'Identifier' &&
                elRef.parentPath.value.property.name === propertyName;
    });
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