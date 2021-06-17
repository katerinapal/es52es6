/**
 * insert_import.js
 * Replaces CJS import statements with ES6 imports (syntax transformation)
 * (keeps export statement type, in order to be adaptable to clients)
 */

const path = require('path');

exports = module.exports = {};
exports.description = "insert_import";

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // let importedElement = transformationInfo.importedElement;

    introduceImportStatement(jscodeshiftAPI, astRootCollection, transformationInfo);
};

/**
 * Generates the import statement to be introduced, 
 * based on the definition of importedElement.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} transformationInfo the object modelling the code transformation
 */
function introduceImportStatement(jscodeshiftAPI, astRootCollection, transformationInfo) {

    //specifies the export type:
    //(a) NamespaceImport/NamespaceModification: import/modification of module object
    //(b) GlobalUse/GlobalModification/FunctionDeclaration: import/modification of module feature
    let depType = transformationInfo.dependencyType;
    let importedElement = transformationInfo.importedElement;
    let impSource = jscodeshiftAPI.literal(importedElement.definitionModuleName);

    let impDeclAdded = false;

    //importedElement is not imported (ModuleImport)
    if(depType === 'ModuleImport') {

        let impDeclaration = jscodeshiftAPI.importDeclaration([], impSource);
        impDeclAdded = addImport(jscodeshiftAPI, astRootCollection, impDeclaration);
        importedElement.importedElementNodes.forEach(impElNode => {

            let impElNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, impElNode);

            if(impElNodeCollection.length > 0) {

                impElNodeCollection.remove();
            }
        });

        return;
    }

    //specifies the export type:
    //(a) importedElement is the module object: imported through a default import
    //(b) importedElement is a module object property: imported through a named import
    let impElAssignedToModObj = importedElement.isImportedElementExportedViaModuleExports;

    //remove dashes and special chars from definition module
    //avoid name collisions in imports
    let defModule = importedElement.definitionModuleName.replace(/[^\w\s]/gi, '').replace(/-/g, '');

    let elemName = importedElement.definitionModuleName.startsWith('.') === true ?
                    `${defModule}_${importedElement.elementName}` :
                    `ext_${importedElement.elementName}`;

    let elemIdentifier = jscodeshiftAPI.identifier(elemName);

    //importedElement is the module object -
    //add a default import
    if(impElAssignedToModObj === true ||
        importedElement.definitionModuleName.startsWith('.') === false) {

        let impSpecifier = jscodeshiftAPI.importDefaultSpecifier(elemIdentifier);
        let impDeclaration = jscodeshiftAPI.importDeclaration([impSpecifier], impSource);
        impDeclAdded = addImport(jscodeshiftAPI, astRootCollection, impDeclaration);

        //if impDeclaration is added, rename its references
        if(impDeclAdded === true) {

            replaceImportedElementDefNodes(jscodeshiftAPI, astRootCollection, importedElement, elemIdentifier);
        }

        return;
    }

    //importedElement is a module object property
    //add a named import, based on the dependency type (NamespaceImport/feature import)
    if(depType === 'NamespaceImport') {

        let impSpecifier = jscodeshiftAPI.importNamespaceSpecifier(elemIdentifier);
        let impDeclaration = jscodeshiftAPI.importDeclaration([impSpecifier], impSource);
        impDeclAdded = addImport(jscodeshiftAPI, astRootCollection, impDeclaration);

        //if impDeclaration is added, rename its references
        if(impDeclAdded === true) {

            replaceImportedElementDefNodes(jscodeshiftAPI, astRootCollection, importedElement, elemIdentifier);
        }

        return;
    }

    let impSpecifier = jscodeshiftAPI.importSpecifier(elemIdentifier);
    let impDeclaration = jscodeshiftAPI.importDeclaration([impSpecifier], impSource);
    impDeclAdded = addImport(jscodeshiftAPI, astRootCollection, impDeclaration);

    //if impDeclaration is added, rename its references
    if(impDeclAdded === true) {

        replaceImportedElementDefNodes(jscodeshiftAPI, astRootCollection, importedElement, elemIdentifier);
    }
}

/**
 * Adds an import at the top of the AST, if an imported element with the same name
 * doesn't exist.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} impDeclaration the import statement to be introduced
 * @returns {*} true if impDeclaration is added in the AST, false otherwise
 * (in case of duplicate imports).
 */
function addImport(jscodeshiftAPI, astRootCollection, impDeclaration) {

    let modImports = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);

    //module doesn't have any imports
    //add import
    if(modImports.length === 0) {

        //ES6 import statements do not exist - add the top of the AST
		// console.log(astRootCollection.toSource());
		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(impDeclaration);
        return true;
    }

    //module has ES6 imports
	let importedSource = impDeclaration.source;
	let importedSpecifiers = impDeclaration.specifiers;

    //check if ES6 import importing a feature in importedSpecifiers 
    //(features imported through impDeclaration) exists
    let duplImports = modImports.filter(modImport => {

        // console.log(modImport.value.specifiers);
		// console.log(impDeclaration)

		let introducedSource = modImport.value.source;

		if(introducedSource.value !== importedSource.value) {

			return false;
		}

		let introducedSpecifiers = modImport.value.specifiers;

        //find if modImport imports 1 feature
        //imported through impDeclaration
        let impSpecifier = importedSpecifiers.find(importedSpecifier => {

			// console.log(importedSpecifier);

			let importedSpecifierName;
			if(importedSpecifier.type === 'ImportNamespaceSpecifier' || 
			importedSpecifier.type === 'ImportDefaultSpecifier' || 
			importedSpecifier.type === 'ImportSpecifier') {

				importedSpecifierName = importedSpecifier.local.name;
			}
			else {

				importedSpecifierName = importedSpecifier.imported.name;
			}

			let retrievedIdentifier = introducedSpecifiers.find(introducedSpecifier => {

				// console.log(introducedSpecifier)
				let introducedSpecifierName;
				if(introducedSpecifier.type === 'ImportNamespaceSpecifier' ||
				introducedSpecifier.type === 'ImportDefaultSpecifier' ||
				introducedSpecifier.type === 'ImportSpecifier') {

					introducedSpecifierName = introducedSpecifier.local.name;
				}
				else {

					introducedSpecifierName = introducedSpecifier.imported.name;
				}

				return introducedSpecifierName === importedSpecifierName;
			});

			if(retrievedIdentifier !== undefined) {

				return true;
			}

            return false;
        });

        //modImport imports a feature
        //imported in impDeclaration
        if(impSpecifier !== undefined) {

            return true;
        }

        return false;
    });

    //duplImport imports a feature specified in impDeclaration
    //avoid duplicate imports, which lead to module evaluation error
    if(duplImports.length > 0) {

        return false;
    }

    //no imports importing a feature specified in impDeclaration exist
    //add impDeclaration at the top of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(impDeclaration);
    return true;
}

/**
 * Renames the imports of importedElement with the element's name. 
 * Leaves the element usages as is, since the import is not removed.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} importedElement the imported element
 * @param {*} elemIdentifier the name under which importedElement is imported in the AST
 */
function replaceImportedElementDefNodes(jscodeshiftAPI, astRootCollection, importedElement, elemIdentifier) {

    // let impElRefs = importedElement.usageSet;
    let impElNodes = importedElement.importedElementNodes;

    // impElRefs.forEach(impElRef => {

    //     let impElRefCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, impElRef);

    //     if(impElRefCollection.length > 0) {

    //         impElRefCollection.replaceWith(elemIdentifier);
    //     }
    // });

    impElNodes.forEach(impElNode => {

        let impElNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, impElNode);

        if(impElNodeCollection.length > 0) {

            impElNodeCollection.replaceWith(elemIdentifier);
        }
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