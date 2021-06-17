/**
 * export_function.js
 * Codemod for exporting variables to client modules.
 * Applied in library systems.
 */

 var path = require('path');
 
 var exports = module.exports = {};
 
 exports.description = "export_variable";
 
 exports.refactoring = function (jscodeshiftAPI, astRootCollection, transformationInfo) {
     
    // console.log(astRootCollection.toSource());
    // console.log("\n\n\n");
 
    let exportedElement = transformationInfo.exportedElement;
 
     let filePath = transformationInfo.filePath;
 
     //variable is exported from entryFile, regardless of its use in other modules
     let isEntryFile = transformationInfo.isEntryFile;
     filePath = path.basename(filePath, '.js').replace(/[^\w\s]/gi, '').replace(/-/g, '');
 
     // console.log(transformationInfo);
     // console.log(exportedElement);
     
     //variable that needs to be exported
     //(resolved at analysis to prevent name collisions)
     let variableName = exportedElement.variableName;
 
     //the variable that is actually exported (it is assigned the value of the variable assigned to the export object)
     // let mappedVariableName = filePath + '_' + variableName;
     // let mappedVariableName = variableName;
     let mappedVariableName = exportedElement.elementAlias;
 
     let resultObject = {
 
         isVariableInitializedWithAnObject: false,
         exportedProperties: 0
     };
 
     //search by the start and end of the definition of the variable, instead of its initialization value
 
     //introduce a variable definition right before the export statement
     let variableIdentifier = jscodeshiftAPI.identifier(variableName);
     let exportVariableIdentifier = jscodeshiftAPI.identifier(mappedVariableName);
     mapExportedDefinitionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, exportVariableIdentifier);
 
     //create an ES6 named export statement of the form export {<new_variable> as <variable>}
     //and add it right at the end of the AST
     let exportedNode;

     //keep type of export to preserve backwards compatibility with clients
     if(exportedElement.isExportedObjectDefinedThroughAssignmentToExports === true) {

        exportedNode = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);
     }
     else {

        // let exportSpecifier = jscodeshiftAPI.exportSpecifier(exportVariableIdentifier, variableIdentifier);
        let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportVariableIdentifier);
        exportedNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
     }
 
     //introduce ES6 export only in the case that it does not exist
     let es6Exports = astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).filter(expStmt => {
 
         return expStmt.value === exportedNode;
     });
 
     //ES6 export already exists, do not proceed
     //(ES6 spec does not allow duplicate imports/exports)
     if(es6Exports.length > 0) {
 
         return resultObject;
     }
 
     //ES6 export does not exist, add it in the bottom of the AST
     astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportedNode);

     //modify other references of the module object
     //e.g. patterns for preserving backwards compatibility
     //through assigning and bounding to the module object
     renameModObjRefs(jscodeshiftAPI, astRootCollection, mappedVariableName);
     
     // console.log(astRootCollection.toSource());
     return resultObject;
 }
 
 /**
  * Maps exportedElement to the variable being exported.
  * Introduces a variable definition right before its export statement.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} exportedElement 
  */
 function mapExportedDefinitionToVariable(jscodeshiftAPI, astRootCollection, exportedElement, exportedVarIdentifier) {
 
     let variableName = exportedElement.variableName;
     let variableExpNode = exportedElement.exportedVariableNode;
 
     //the variable's (modified) name
     let initialVariableIdentifier = jscodeshiftAPI.identifier(variableName);
     
     if(variableExpNode === null) {
 
         return;
     }
 
     //retrieve Statement (VariableDeclaration, AssignmentExpression etc...)
     //containing the definition's export statement
     //variable: a value assigned to the export object (no references to properties bound to the export object exist)
     let defExpStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableExpNode);
 
     // let defExpStmts = astRootCollection.find(jscodeshiftAPI[variableExpNode.type]).filter(expNode => {
 
     // 	if(expNode.value.loc == null) {
 
     // 		return false;
     // 	}
 
     // 	let expNodeLoc = expNode.value.loc;
     // 	return expNodeLoc.start.line === varExpNodeLoc.start.line && expNodeLoc.start.column === varExpNodeLoc.start.column &&
     // 			expNodeLoc.end.line === varExpNodeLoc.end.line && expNodeLoc.end.column === varExpNodeLoc.end.column;
     // });
 
     //the variable's export statement may be modified
     //assign the initial variable's value to variable
     if(defExpStmts.length === 0) {
 
         // let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
         // astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
         return;
     }
 
     //assign the value of the exported variable in a new variable (the mapped variable)
     //and export the introduced variable instead (CommonJS exports the value of the variable, 
     //not the variable itself: achieve 'disconnection' from the variable)
     //the newly introduced variable will have a name relevant to the property's name and the module's path
 
     //create variable declaration
     //the newly introduced variable's initialization value will be the value of the variable that is exported in the CommonJS module
     // let variableIdentifier = exportedVarIdentifier;
     let variableIdentifier = initialVariableIdentifier;
     
     //create variable declarator (syntax: <variableIdentifier> = <expDefinitionIdentifier>)
     let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
                         
     //create variable declaration (syntax: var <variableIdentifier> = <expDefinitionIdentifier>)
     let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
 
     //(a) insert variableDeclaration right before the definition's export statement
     //(b) update each reference to the export object or property bound to export object
     //to a reference of the introduced variable
     //(c) map exported variable to the new variable
     defExpStmts.forEach(defExpStmt => {
 
         //(a)
         let defExpStmtAST = jscodeshiftAPI(defExpStmt);
         defExpStmtAST.insertBefore(variableDeclaration);
 
         //(b)
         let expObjRefs = defExpStmtAST.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {
 
             return  mbExp.parentPath.value.type !== 'MemberExpression' &&
                     mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'module' &&
                     mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === 'exports';
         });
 
         if(expObjRefs.length > 0) {
 
             expObjRefs.forEach(expObjRef => {
 
                 //export object reference located in an assignment located in an expression statement
                 //syntax: module.exports = <value>
                 if(expObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
     
                     jscodeshiftAPI(expObjRef).replaceWith(variableIdentifier);
                     return;
                 }
     
                 //export object located in an assignment
                 //syntax: (1) <value> = module.exports = [assignment], (b) <value> = [assignment] = module.exports
                 if(expObjRef.parentPath.value.type === 'AssignmentExpression') {
     
                     //(1)
                     if(expObjRef.parentPath.value.left === expObjRef.value) {
     
                         jscodeshiftAPI(expObjRef.parentPath).replaceWith(expObjRef.parentPath.value.right);
                         return;
                         // return expObjRef.parentPath.value.right;
                     }
 
                     jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
                     return;
                 }
 
                 //export object located in a variable definition
                 if(expObjRef.parentPath.value.type === 'VariableDeclarator') {
 
                     jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
                 }
             });
         }
 
         expObjRefs = defExpStmtAST.find(jscodeshiftAPI.Identifier).filter(id => {
 
             return  id.parentPath.value.type !== 'MemberExpression' &&
                     id.value.name === 'exports';
         });
 
         if(expObjRefs.length > 0) {
 
             expObjRefs.forEach(expObjRef => {
 
                 //export object reference located in an assignment located in an expression statement
                 //syntax: module.exports = <value>
                 if(expObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
     
                     return jscodeshiftAPI(expObjRef).replaceWith(variableIdentifier);
                 }
     
                 //export object located in an assignment
                 //syntax: (a) module.exports = [assignment], (b) <value> = module.exports
                 if(expObjRef.parentPath.value.type === 'AssignmentExpression') {
     
                     //(1)
                     if(expObjRef.parentPath.value.left === expObjRef.value) {
     
                         jscodeshiftAPI(expObjRef.parentPath).replaceWith(expObjRef.parentPath.value.right);
                         return;
                     }
 
                     jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
                     return;
                 }
 
                 //export object located in a variable definition
                 if(expObjRef.parentPath.value.type === 'VariableDeclarator') {
 
                     jscodeshiftAPI(expObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
                 }
             });
         }
     });
 
     //after the export statement's modification, 
     //check if the statement has a reference of the introduced variable
     //if not, assign the initial variable's value to the new variable (prevent bugs due to undefined)
     defExpStmts.forEach(defExpStmt => {
 
         let newVarRefs = jscodeshiftAPI(defExpStmt).find(jscodeshiftAPI.Identifier).filter(id => {
 
             return id.value.name === variableIdentifier.name;
         });
 
         if(newVarRefs.length === 0) {
 
             // let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
             let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', initialVariableIdentifier, exportedVarIdentifier);
             astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
         }
     });
 
     //(c) assign the value of the initial variable to the mapped variable
     //(convert the assignment into an expression statement and add the expression statement at the end of the AST)
     // if(exportedElement.isImportedAndReexported === false) {
 
     // 	let mappingAssignment = jscodeshiftAPI.assignmentExpression('=', exportedVarIdentifier, initialVariableIdentifier);
     // 	astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(jscodeshiftAPI.expressionStatement(mappingAssignment));
     // }
     
 }
 
 /**
  * Modifies the exported definition's export statement
  * (it does not remove it, since it may be located within its definition).
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} exportedElement 
  */
 function modifyVariableExportNode(jscodeshiftAPI, astRootCollection, exportedElement) {
 
     //search by the start and end of the definition of the variable, instead of its initialization value
     //case (bluebird): what if a variable is declared, but not initialized?
     let variableName = exportedElement.variableName;
     let variableNode = exportedElement.variableDeclarationNode;
     let variableExportNode = exportedElement.exportedVariableNode;
 
     //remove exportNode from AST (commonJS export statement)
     //update: do not remove exportNode - in the case that variable definition is located within export statement,
     //the definition is gone as well
     //simply replace export object reference with an empty object
     let varDefLoc = variableNode.loc;
     let varExpLoc = variableExportNode.loc;
 
     // console.log(varDefLoc.start.line === varExpLoc.start.line && varDefLoc.start.column === varExpLoc.start.column &&
     // 	varDefLoc.end.line === varExpLoc.end.line && varDefLoc.end.column === varExpLoc.end.column);
         
     if(varDefLoc.start.line === varExpLoc.start.line && varDefLoc.start.column === varExpLoc.start.column &&
         varDefLoc.end.line === varExpLoc.end.line && varDefLoc.end.column === varExpLoc.end.column) {
 
         let exportNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, variableExportNode);
 
         // let exportNodeCollection = astRootCollection.find(jscodeshiftAPI[variableExportNode.type]).filter(path => {
 
         // 	if(path.value.loc === null) {
 
         // 		return false;
         // 	}
 
         // 	let pathLoc = path.value.loc;
         // 	return pathLoc.start.line === varExpLoc.start.line && pathLoc.start.column === varExpLoc.start.column &&
         // 			pathLoc.end.line === varExpLoc.end.line && pathLoc.end.column === varExpLoc.end.column;
         // });
 
         if(exportNodeCollection.length === 0) {
 
             return;
         }
 
         let objectExpression = jscodeshiftAPI.objectExpression([]);
 
         // let exportObjectIdentifier = jscodeshiftAPI.identifier('exportObject');
         let exportObjectIdentifier = jscodeshiftAPI.identifier(variableName);
 
         //do not introduced parenthesized expression (problems with babel)
         //created a hardcoded variable modelling the exported object
         //create variable declarator (syntax: <propertyName> = <initial_property_value>)
         let variableDeclarator = jscodeshiftAPI.variableDeclarator(exportObjectIdentifier, objectExpression);
                                 
         //create variable declaration (syntax: var <propertyName> = <initial_property_value>)
         let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
 
         // let expVarNodeAST = jscodeshiftAPI(exportedElement.exportedVariableNode);
         let expVarNodeAST = jscodeshiftAPI(exportNodeCollection.at(0).get());
         let exportObjectRefs = expVarNodeAST.find(jscodeshiftAPI.MemberExpression).filter(mb => {
 
             return mb.parentPath.value.type !== 'MemberExpression' &&
                     mb.value.object.type === 'Identifier' && mb.value.object.name === 'module' &&
                     mb.value.property.type === 'Identifier' && mb.value.property.name === 'exports';
         });
 
         // console.log(exportObjectRefs.length);
 
         if(exportObjectRefs.length > 0) {
 
             exportObjectRefs.replaceWith(exportObjectIdentifier);
         }
 
         exportObjectRefs = expVarNodeAST.find(jscodeshiftAPI.Identifier).filter(objRef => {
 
             return objRef.parentPath.value.type !== 'MemberExpression' &&
                     objRef.value.name === 'exports';
         });
 
         // console.log(exportObjectRefs.length);
 
         if(exportObjectRefs.length > 0) {
 
             exportObjectRefs.replaceWith(exportObjectIdentifier);
         }
 
         // console.log(jscodeshiftAPI(exportObjectIdentifier).toSource());
         // console.log(astRootCollection.toSource());
 
         //insert variableDeclaration at the top of the AST
         astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);
 
         return;
     }
 
     //export statement not located within exportedElement's definition (remove it)
     //update: remove it in the case that the export object is not used, but its properties is used
     astRootCollection.find(jscodeshiftAPI[variableExportNode.type], exportedElement.exportedVariableNode).remove();
 }
 
 /**
  * Determines if exportedElement is assigned the result of require() 
  * (i.e. it is an element imported in the module).
  * If yes, it exports the aliased definition under its actual name.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} exportedElement 
  */
 function isVariableAssignedTheValueOfRequireInvocation(exportedElement, jscodeshiftAPI, astRootCollection) {
 
     // let initializationNode = exportedElement.initializationValueNode;
 
     let initNode = exportedElement.initializationValueNode;
     let initStmts = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, initNode);
 
     if(initStmts.length === 0) {
 
         return false;
     }
 
     let initializationNode = initStmts.at(0).get().value;
     if(initializationNode.type !== 'CallExpression' ||
        initializationNode.callee.type !== 'Identifier' ||
        initializationNode.callee.name !== 'require') {
 
         return false;
     }
 
     return true;
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

/**
 * Renames all references to the module object with elementName references.
 * Needed for patterns preserving backwards compatibility, 
 * when the exported element is both assigned and bound to the module object.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} elementName the name of the exported element
 */
 function renameModObjRefs(jscodeshiftAPI, astRootCollection, elementName) {

	let elemId = jscodeshiftAPI.identifier(elementName);
	let modObjRefs = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {

		return mbExp.value.object.type === 'Identifier' &&
				mbExp.value.object.name === 'module' &&
				mbExp.value.property.type === 'Identifier' &&
				mbExp.value.property.name === 'exports';
	});

	if(modObjRefs.length > 0) {

		modObjRefs.replaceWith(elemId);
	}

	modObjRefs = astRootCollection.find(jscodeshiftAPI.Identifier).filter(id => {

		return id.value.name === 'exports';
	});

	if(modObjRefs.length > 0) {

		modObjRefs.replaceWith(elemId);
	}
}