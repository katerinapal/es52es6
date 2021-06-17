/**
 * Export_object_with_properties.js. 
 * Codemod for exporting objects assigned to the module object. 
 * Applied for libraries.
 */

var path = require('path');
 
 exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {
 
     let exportedElement = transformationInfo.exportedElement;
     let filePath = transformationInfo.filePath;
 
     //each value assigned/bound to the export object is assigned to a variable
     //whose name depends on the property's name and the definition module's name
     let definitionModuleName = path.basename(filePath, '.js').replace(/[^\w\s]/gi, '').replace(/-/g, '');
 
     let isExportedObjectCohesive = exportedElement.isFunctionConstructor;
     let isObjectReferenced = exportedElement.isObjectReferenced;
 
     //the exported object's defined properties, along with their uses within the exported object
     let objectProperties = exportedElement.objectProperties;
 
     //map exported property to a variable (use a different name to variableName, in order to prevent name collisions)
     //the name of the variable depends on the property's name (depending on the definition module)
     //and the alias under which it was initially exported
     //
     // let variableName = exportedElement.exportedElementName + '_' + exportedElement.exportAlias;
 
     let variableName = exportedElement.exportedElementName;
 
     //the assignment of the module's exported object to exports/module.exports
     let exportedElementNode = exportedElement.elementNode;
 
     let initializationNode = exportedElement.initializationNode;
 
     if(exportedElementNode === null) {
 
         return;
     }
 
     //the exported object's referenced properties (these need to be exported), along with their uses in other modules
     let referencedProperties = exportedElement.referencedProperties;
 
     let doesExportedElementHandleThis = exportedElement.doesExportedObjectHandleThis;
 
     let propertyReferences = exportedElement.propertyReferences;
 
     let isExportedObjectDefinedThroughAssignmentToExports = exportedElement.isExportedObjectDefinedThroughAssignmentToExports;
     let numberOfPropertiesExportedFromModule = exportedElement.numberOfPropertiesExportedFromModule;
     let isModFeatImportedInNestedScopes = exportedElement.isNested;
 
     let objInitNodes = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedElement.initializationNode);
 
     //update: what if an object (property bound/assigned to the module object)
     //is exported
     //but it's imported in nested scopes (or used as function invocation argument)?
     //the whole object with these properties should be exported
     //instead of the properties themselves
     //(the same applies for objects that are module objects of other modules)
     if(isExportedObjectDefinedThroughAssignmentToExports === false &&
         // numberOfPropertiesExportedFromModule > 1 &&
         (isModFeatImportedInNestedScopes === true ||
          exportedElement.isImportedAndReexported === true ||
          isObjectReferenced === true)) {
 
         exportModuleObject(jscodeshiftAPI, astRootCollection, exportedElement);
         return 1;
     }
 
     //(1) convert the module's exported object into a variable initialized with the specific object
     //the variable will be named after the exportedElement's name
     convertModuleExportedObjectIntoAVariable(jscodeshiftAPI, astRootCollection, variableName, exportedElement, propertyReferences);
 
     //all objects are exported as-is, to preserve backwards compatibility
 
     //(2) convert each reference to the export object (exports/module.exports/<export object name>)
     //into a reference of the introduced variable (variableName)
     convertReferencesOfExportObjectIntoVariableReferences(jscodeshiftAPI, astRootCollection, objectProperties, variableName);
 
     //(3) export the cohesive object through an ES6 export
     //names resolved during analysis
     exportCohesiveObject(jscodeshiftAPI, astRootCollection, variableName, exportedElement.exportAlias, isExportedObjectDefinedThroughAssignmentToExports);
 
     //after the refactoring, 1 cohesive object is exported
     return 1;
 
     
 };
 
 /**
  * Converts the module's exported object to a variable declaration.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} variableName 
  * @param {*} exportedElementNode 
  */
 function convertModuleExportedObjectIntoAVariable(jscodeshiftAPI, astRootCollection, variableName, exportedElement, propertyReferences) {
 
     if(variableName === null) {
 
         return;
     }
 
     let elementName = exportedElement.exportedElementName;
     let elementAlias = exportedElement.elementAlias;
     let exportedElementNode = exportedElement.elementNode;
     // let exportedElementNodeLoc = exportedElementNode.loc;
 
     let variableIdentifier = jscodeshiftAPI.identifier(variableName);
 
     //replace the module's export statement (assignment) with the declaration of a variable initialized with the exported object
     //update: the module's export statement might not be located in an expression statement
     //(it may be located within an assignment which is within another assignment etc)
     //retrieve a general statement (VariableDeclaration, Assignment, ...)
     let expObjDefs = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, exportedElementNode);
 
     // console.log(expObjDefs.length);
     if(expObjDefs.length === 0) {
 
         return;
     }
 
     let expObjDef = expObjDefs.at(0).get();
 
     //find the closest statement (ExpressionStatement, VariableDeclaration) containing expObjDef
     //(do not consider the whole program, if statements etc)
     let stmtCollection;
     if(expObjDef.value.type === 'ExpressionStatement' ||
         expObjDef.value.type === 'VariableDeclaration') {
 
         //export statement is an expression statement/variable declaration
         //do not find closest statement
         stmtCollection = expObjDefs;
     }
     else {
 
         //export statement is an assignment expression
         //find the statement's surrounding statement
         stmtCollection = jscodeshiftAPI(expObjDef).closest(jscodeshiftAPI.Statement);
     }
 
     if(stmtCollection.length === 0) {
 
         return;
     }
 
     let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
                             
     //create variable declaration (syntax: var <variableIdentifier>;)
     let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
 
     //introduce variable right before the statement containing the property's definition
     //update: introduce variable at the end of the AST 
     //(prevent introducing variable definitions inside if statements etc (case: jshint))
     astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(variableDeclaration);
 
     stmtCollection.forEach(stmt => {
 
         let stmtAST = jscodeshiftAPI(stmt);
         // stmtAST.insertBefore(variableDeclaration);
 
         //replace the property's definition with a reference of the introduced variable
         let elementDefs = stmtAST.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {
 
             // return (mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'exports' ||
             //         (mbExp.value.object.type === 'MemberExpression' && 
             //         mbExp.value.object.object.type === 'Identifier' && mbExp.value.object.object.name === 'module' &&
             //         mbExp.value.object.property.type === 'Identifier' && mbExp.value.object.property.name === 'exports')) &&
             //         mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === elementName;
 
             //names have change due to name collisions (do NOT search against them)
             //search refs by the property's alias (the features are exported under their initial names)
             return (mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'exports' ||
                     (mbExp.value.object.type === 'MemberExpression' && 
                     mbExp.value.object.object.type === 'Identifier' && mbExp.value.object.object.name === 'module' &&
                     mbExp.value.object.property.type === 'Identifier' && mbExp.value.object.property.name === 'exports')) &&
                     mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === elementAlias;
         });
 
         if(elementDefs.length > 0) {
 
             elementDefs.replaceWith(variableIdentifier);
             return;
         }
 
         //property is an object assigned to the export object
         //syntax: exports | module.exports = [module.exports | exports] = <value>
         //find references to the export object inside statement
         let exportObjRefs = stmtAST.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {
 
             return mbExp.parentPath.value.type !== 'MemberExpression' &&
                     mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'module' &&
                     mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === 'exports';
         });
 
         //a reference whose grand parent AST node is an expression is replaced with a reference of the variable
         //a nested reference is replaced with an empty object
         if(exportObjRefs.length > 0) {
 
             exportObjRefs.forEach(exportObjRef => {
 
                 if(exportObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
 
                     return jscodeshiftAPI(exportObjRef).replaceWith(variableIdentifier);
                 }
 
                 //do not replace with an empty object literal
                 //(ES6 does not allow assigning to empty object literals)
                 if(exportObjRef.parentPath.value.type === 'AssignmentExpression') {
 
                     return jscodeshiftAPI(exportObjRef.parentPath).replaceWith(exportObjRef.parentPath.value.right);
                 }
                 
                 return exportObjRef.value;
             });
         }
 
         exportObjRefs = stmtAST.find(jscodeshiftAPI.Identifier).filter(mbExp => {
 
             return mbExp.parentPath.value.type !== 'MemberExpression' &&
                     mbExp.value.name === 'exports';
         });
 
         //a reference whose grand parent AST node is an expression is replaced with a reference of the variable
         //a nested reference is replaced with an empty object
         if(exportObjRefs.length > 0) {
 
             exportObjRefs.forEach(exportObjRef => {
 
                 if(exportObjRef.parentPath.parentPath.value.type === 'ExpressionStatement') {
 
                     return jscodeshiftAPI(exportObjRef).replaceWith(variableIdentifier);
                 }
                 
                 //do not replace with an empty object literal
                 //(ES6 does not allow assigning to empty object literals)
                 if(exportObjRef.parentPath.value.type === 'AssignmentExpression') {
 
                     return jscodeshiftAPI(exportObjRef.parentPath).replaceWith(exportObjRef.parentPath.value.right);
                 }
                 
                 return exportObjRef.value;
             });
         }
     });
     
     //if the exported object has references (inner properties)
     //replace references with the newly introduced variable
     propertyReferences.forEach(propertyReference => {
 
         let propertyRefs = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyReference);
 
         if(propertyRefs.length > 0) {
 
             propertyRefs.replaceWith(variableIdentifier);
         }
 
         // astRootCollection.find(jscodeshiftAPI[propertyReference.type]).filter(node => {
 
         //     let nodeLoc = node.value.loc;
         //     let propertyReferenceLoc = propertyReference.loc;
 
         //     if(nodeLoc === null) {
 
         //         return false;
         //     }
 
         //     return nodeLoc.start.line === propertyReferenceLoc.start.line && nodeLoc.start.column === propertyReferenceLoc.start.column &&
         //            nodeLoc.end.line === propertyReferenceLoc.end.line && nodeLoc.end.column === propertyReferenceLoc.end.column;
         // }).replaceWith(variableIdentifier);
     });
 }
 
 /**
  * Converts references of the export object into references of the introduced variables.
  * Applies in the cases that the export object is cohesive.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} objectProperties 
  * @param {*} variableName 
  */
 function convertReferencesOfExportObjectIntoVariableReferences(jscodeshiftAPI, astRootCollection, objectProperties, variableName) {
 
     let variableIdentifier = jscodeshiftAPI.identifier(variableName);
 
     //in the definition of each export object property, 
     //replace the export object reference with a reference of variableName
     objectProperties.forEach(objectProperty => {
 
         let propertyName = objectProperty.propertyName;
         let propertyDefNode = objectProperty.propertyDefinitionNode;
         let propertyDefNodeLoc = propertyDefNode.loc;
 
         //we care only for properties defined outside the object's initial value 
         //through assignments- the other properties are exported through the object itself
         if(propertyDefNode.type !== 'AssignmentExpression') {
 
             return;
         }
 
         //(1) in objectProperty's definition, replace the reference of the export object
         //to a reference of variableName
         let defNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, propertyDefNode);
 
         // let defNodeCollection = astRootCollection.find(jscodeshiftAPI[propertyDefNode.type]).filter(defNode => {
 
         //     //we care only for properties defined outside the object's initial value through assignments
         //     //the other properties are exported through the object itself
         //     let defNodeLoc = defNode.value.loc;
         //     return defNode.value.type === 'AssignmentExpression' && 
         //            defNodeLoc.start.line === propertyDefNodeLoc.start.line && defNodeLoc.start.column === propertyDefNodeLoc.start.column &&
         //            defNodeLoc.end.line === propertyDefNodeLoc.end.line && defNodeLoc.end.column === propertyDefNodeLoc.end.column; 
         // });
 
         if(defNodeCollection.length === 0) {
 
             //objectProperty's definition not found
             return;
         }
 
         defNodeCollection = defNodeCollection.forEach(defNode => {
 
             //defNodeCollection includes assignment expressions
             //syntax: <exportObjectName>.<property> = <initialValue>
             let leftOperand = defNode.value.left;
             if(leftOperand.type !== 'MemberExpression' || 
                (leftOperand.property.type === 'Identifier' && 
                 leftOperand.property.name !== propertyName)) {
 
                 //left operand not a member expression
                 //or a member expression not accessing objectProperty
                 return defNode;
             }
 
             //left operand is a member expression accessing objectProperty
             //convert the member's expression object to a reference of variableName
             leftOperand.object = variableIdentifier;
 
             return defNode;
         });
 
         //(2) within each use of the property, replace the reference to the export object
         //with a reference to variableName (the property is bound to the object exported after refactoring)
         let objectPropertyUsages = objectProperty.objectPropertyUsages ? objectProperty.objectPropertyUsages : [];
 
         if(objectPropertyUsages.length === 0) {
 
             //initial property had no uses - abort
             return;
         }
 
         objectPropertyUsages.forEach(objectPropertyUsage => {
 
             let objectPropertyUsageLoc = objectPropertyUsage.loc;
 
             let propertyUsages = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, objectPropertyUsage);
 
             // let propertyUsages = astRootCollection.find(jscodeshiftAPI[objectPropertyUsage.type]).filter(propertyUsageNode => {
 
             //     let propertyUsageLoc = propertyUsageNode.value.loc;
             //     if(propertyUsageLoc === null) {
                    
             //         return false;
             //     }
 
             //     let isPropertyUsage = (objectPropertyUsageLoc.start.line === propertyUsageLoc.start.line && 
             //                            objectPropertyUsageLoc.start.column === propertyUsageLoc.start.column &&
             //                            objectPropertyUsageLoc.end.line === propertyUsageLoc.end.line &&
             //                            objectPropertyUsageLoc.end.column === propertyUsageLoc.end.column);
                 
             //     if(isPropertyUsage === false) {
 
             //         return false;
             //     }                
                 
             //     return true;
             // });
 
             if(propertyUsages.length === 0) {
 
                 return;
             }
 
             propertyUsages.forEach(propertyUsage => {
 
                 propertyUsage.value.object = variableIdentifier;
                 return propertyUsage;
             });
         });
     });
     
 }
 
/**
 * Exports a cohesive object through an ES6 named export.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} variableName the exported variable
 * @param {*} isExportedObjectDefinedThroughAssignmentToExports is the exported object the actual module object?
 * Needed for determining the export type (named/default).
 */
function exportCohesiveObject(jscodeshiftAPI, astRootCollection, variableName, exportAlias, isExportedObjectDefinedThroughAssignmentToExports) {

    //prevent exporting object if it is already exported (also, check aliases)
    let es6NamedExports = astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration).filter(path => {
 
        // console.log(path);
        let exportSpecifier = path.value.specifiers.find(specifier => {
 
            return (specifier.exported.type === 'Identifier' && specifier.exported.name === variableName) ||
                (specifier.local.type === 'Identifier' && specifier.local.name === variableName);
        });
 
        if(exportSpecifier !== undefined) {
 
            return true;
        }
 
        return false;
    });
 
    // console.log(es6Exports.length)
 
    if(es6NamedExports.length > 0) {
 
        //object already exported
        return;
    }

    let es6DefaultExports = astRootCollection.find(jscodeshiftAPI.ExportDefaultDeclaration).filter(path => {
 
        // console.log(path);
        
        return path.value.declaration.type === 'Identifier' &&
                path.value.declaration.name === variableName;
    });
 
    // console.log(es6Exports.length)
 
    if(es6DefaultExports.length > 0) {
 
        //object already exported
        return;
    }
 
    //export the newly introduced variable under the alias (the initial property's name)
    //the modules import the definition under the alias
    //exported object is the actual module object
    if(isExportedObjectDefinedThroughAssignmentToExports === true) {

        let variableIdentifier = jscodeshiftAPI.identifier(variableName);
        let exportStatement = jscodeshiftAPI.exportDefaultDeclaration(variableIdentifier);

        //insert ES6 export at the end of the AST
        astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
        return;
    }

    //exported object is a module object property
    //add an ES6 named export
    let variableIdentifier = jscodeshiftAPI.identifier(variableName);
    let exportAliasIdentifier = jscodeshiftAPI.identifier(exportAlias);
    let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, exportAliasIdentifier);
 
     
    // let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
 
    let exportStatement = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
 
    //insert ES6 export at the end of the AST
    astRootCollection.find(jscodeshiftAPI.Program).get('body').value.push(exportStatement);
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
  * Exports the module's object, along with its properties.
  * Applies in cases of a module with sparse module object properties,
  * which is imported in nested scopes at least once.
  * @param {*} jscodeshiftAPI 
  * @param {*} astRootCollection 
  * @param {*} exportedElement 
  */
 function exportModuleObject(jscodeshiftAPI, astRootCollection, exportedElement) {
 
     let objName = `mod_${exportedElement.importAlias}`;
     let objExpAlias = exportedElement.importAlias;
 
     let variableIdentifier = jscodeshiftAPI.identifier(objName);
 
     let initValue = jscodeshiftAPI.objectExpression([]);
 
     //create a variable modelling the module object
     //(initialize it with an empty object literal, to avoid bugs due to undefined)
     let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, initValue);
                             
     //create variable declaration (syntax: var <variableIdentifier> = <callExpression>)
     let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);
 
     //introduce variable right before the statement containing the property's definition
     //update: introduce variable at the end of the AST 
     //(prevent introducing variable definitions inside if statements etc (case: jshint))
     let varDecls = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
         {
             type: "VariableDeclarator",
             id: { name: objName }
     }]});
 
     //insert each variable once 
     //(at the top of the AST, right after the ES6 imports (if any), 
     //in order to avoid bugs due to undefined)
     if(varDecls.length === 0) {
 
         let es6ImportStatements = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);
         
         // console.log(es6ImportStatements);
         if(es6ImportStatements.length > 0) {
 
             //ES6 import statements exist - add variableDeclaration after the last ES6 import
             jscodeshiftAPI(es6ImportStatements.at(-1).get()).insertAfter(variableDeclaration);
         }
         else {
 
             //ES6 import statements do not exist - add variableDeclaration at the top of the AST
             astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);
         }
 
         // astRootCollection.find(jscodeshiftAPI.Program).get('body', 0).insertBefore(variableDeclaration);
     }
 
     //replace all references of the module object with references of the introduced variable
     let expObjRefs = astRootCollection.find(jscodeshiftAPI.Identifier).filter(id => {
 
         return id.value.name === 'exports';
     });
 
     if(expObjRefs.length > 0) {
 
         expObjRefs.replaceWith(variableIdentifier);
     }
 
     expObjRefs = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(mbExp => {
 
         return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'module' &&
                 mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === 'exports';
     });
 
     if(expObjRefs.length > 0) {
 
         expObjRefs.replaceWith(variableIdentifier);
     }
 
     //export the introduced variable, instead of the module object properties themselves
     exportCohesiveObject(jscodeshiftAPI, astRootCollection, objName, objExpAlias, exportedElement.isExportedObjectDefinedThroughAssignmentToExports);
 }