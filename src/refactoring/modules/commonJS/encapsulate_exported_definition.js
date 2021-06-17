
exports.description = 'encapsulate_exported_definition';

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    let elementName = transformationInfo.elementName;

    //property (assigned/bound to the export object), 
    //variable/function (assigned to the export object)
    let dataType = transformationInfo.dataType;

    //property (export statement),
    //variable/function (declaration node)
    // let elementNode = transformationInfo.elementNode;

    //property (null),
    //variable/function (export statement)
    // let exportNode = transformationInfo.exportNode;

    let elementReferences = transformationInfo.elementReferences;

    //needed mainly for exported properties
    // let exportedThroughModuleExports = transformationInfo.exportedThroughModuleExports;

    if(dataType === 'property') {

        if(elementName == undefined) {

            return;
        }

        //property assigned/bound to the export object
        let variableIdentifier = jscodeshiftAPI.identifier(elementName);

        //(a) introduce variable right before the statement containing elementNode
        
        //(b) locate the property's reference inside elementNode
        
        //(c) convert reference to a reference of the introduced variable 
        //(do not convert assignment to a variable declaration, since 1..n properties
        //might be defined within the same assignment)
        
        //(d) convert each property's reference to a reference of the introduced variable

        //(a)-(c)
        let res = mapDefinitionToEncapsulatedVariable(jscodeshiftAPI, astRootCollection, transformationInfo, variableIdentifier);

        if(res === false) {

            return;
        }

        //(d)
        replaceDefinitionReferencesWithEncapsulatedVariableReferences(jscodeshiftAPI, astRootCollection, elementReferences, variableIdentifier);

        return;
    }

    //redundant definition is a variable/function assigned to the export object
    //export statement might have multiple forms
    //e.g. plain assignment to export object
    //assignment to multiple export object references (syntax: [...] = exports = module.exports = [...])
    
    //(a) insert a variable named 'encapsulated_<definition_name>' right before the export statement
    //(b) replace reference to the export object inside export statement with the variable
    //(or an empty object in the case that both exports and module.exports are referenced)

    //(c) replace references to the export object with references of the introduced variable

    //(a-b)
    let variableIdentifier = jscodeshiftAPI.identifier('encapsulated_' + elementName);
    let res = mapDefinitionToEncapsulatedVariable(jscodeshiftAPI, astRootCollection, transformationInfo, variableIdentifier);

    if(res === false) {

        return;
    }

    replaceDefinitionReferencesWithEncapsulatedVariableReferences(jscodeshiftAPI, astRootCollection, elementReferences, variableIdentifier);

    return;
};

/**
 * Maps the redundant property to a variable that is introduced right before its definition statement.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} elementName 
 * @param {*} elementNode 
 */
function mapDefinitionToEncapsulatedVariable(jscodeshiftAPI, astRootCollection, transformationInfo, variableIdentifier) {

    let elementName = transformationInfo.elementName;

    let dataType = transformationInfo.dataType;

    //property (export statement),
    //variable/function (declaration node)
    let elementDeclNode = transformationInfo.elementNode;

    //property (null),
    //variable/function (export statement)
    let exportNode = transformationInfo.exportNode;

    //the definition's export node (VariableDeclaration, ExpressionStatement)
    //property (definition node)
    //variable/function (export statement node)
    let elementExpNode;
    if(dataType === 'property') {

        //definition is a property (an object assigned/bound to the export object)
        //export statement is identical to the declaration statement
        elementExpNode = elementDeclNode;
    }
    else {

        //definition is a variable/function (assigned to the export object)
        //export statement not identical to its declaration
        elementExpNode = exportNode;
    }

    //needed mainly for exported properties
    //variable/function (true)
    let exportedThroughModuleExports = transformationInfo.exportedThroughModuleExports;

    //generate a variable with the same name with property, but not initialized
    let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
    let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

    let elementNodeLoc = elementExpNode.loc;

    //introduce variable declaration right before the property's definition
    let stmtsContainingElementNode = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementExpNode);

    // let stmtsContainingElementNode = astRootCollection.find(jscodeshiftAPI[elementExpNode.type]).filter(stmt => {

    //     //syntax: exports.<property> || module.exports.<property>
    //     if(stmt.value.loc === null) {

    //         return false;
    //     }

    //     let stmtLoc = stmt.value.loc;
    //     return stmtLoc.start.line === elementNodeLoc.start.line && stmtLoc.start.column === elementNodeLoc.start.column &&
    //             stmtLoc.end.line === elementNodeLoc.end.line && stmtLoc.end.column === elementNodeLoc.end.column;
    // });

    // console.log(stmtsContainingElementNode.length)

    //statement containing the property's definition not found
    if(stmtsContainingElementNode.length === 0) {

        return false;
    }

    //statement containing the property's definition found
    //insert variable declaration right before the property's definition
    let stmtContainingElementNode = stmtsContainingElementNode.at(0).get();
    let stmtContainingElementNodeAST = stmtContainingElementNode.value.type === 'AssignmentExpression' ?
                                        jscodeshiftAPI(stmtContainingElementNode.parentPath) :
                                        jscodeshiftAPI(stmtContainingElementNode);
                                        
    stmtContainingElementNodeAST.insertBefore(variableDeclaration);

    //replace the property's reference inside its definition with a reference
    //of the introduced variable
    if(exportedThroughModuleExports === true) {

        //property assigned to export object
        //replace reference to the export object with a reference of the introduced variable
        //(or an empty object in the case it is located in a statement nested in an assignment,
        //in the case that both exports and module.exports are referenced)
        let objectExpression = jscodeshiftAPI.objectExpression([]);

        let exportObjRefs = stmtContainingElementNodeAST.find(jscodeshiftAPI.MemberExpression).filter(mb => {

            return mb.value.object.type === 'Identifier' && mb.value.object.name === 'module' &&
                   mb.value.property.type === 'Identifier' && mb.value.property.name === 'exports' &&
                   mb.parentPath.value.type !== 'MemberExpression';
        });

        if(exportObjRefs.length > 0) {

            let exportObjRef = exportObjRefs.at(0).get();
            if(exportObjRef.parentPath.parentPath.value.type === 'AssignmentExpression') {

                //export object reference located in a statement inside an assignment
                jscodeshiftAPI(exportObjRef).replaceWith(objectExpression);
                return true;
            }

            exportObjRefs.replaceWith(variableIdentifier);
            return true;
        }

        exportObjRefs = stmtContainingElementNodeAST.find(jscodeshiftAPI.Identifier).filter(id => {

            return id.value.name === 'exports' &&
                   id.parentPath.value.type !== 'MemberExpression';
        });

        if(exportObjRefs.length > 0) {

            let exportObjRef = exportObjRefs.at(0).get();
            
            //export object reference located in an assignment located in an expression statement
			//syntax: module.exports = <value>
            if(exportObjRef.parentPath.parentPath.value.type === 'ExpressionStatement' ||
            exportObjRef.parentPath.parentPath.value.type === 'VariableDeclarator') {
	
                jscodeshiftAPI(exportObjRef).replaceWith(variableIdentifier);
                return true;
			}
	
			//export object located in an assignment
			//syntax: (1) <value> = module.exports = [assignment], (b) <value> = [assignment] = module.exports
			if(exportObjRef.parentPath.value.type === 'AssignmentExpression') {
	
				//(1)
				if(exportObjRef.parentPath.value.left === exportObjRef.value) {
	
                    jscodeshiftAPI(exportObjRef).replaceWith(exportObjRef.parentPath.value.right);
                    return true;
				}
						
                jscodeshiftAPI(exportObjRef).replaceWith(jscodeshiftAPI.objectExpression([]));
                return true;
			}

            exportObjRefs.replaceWith(variableIdentifier);
            return true;
        }

        return true;
    }

    let elemRefsInsideDef = stmtContainingElementNodeAST.find(jscodeshiftAPI.MemberExpression).filter(mb => {

        //syntax: exports.<property> || module.exports.<property>
        return ((mb.value.object.type === 'Identifier' && mb.value.object.name === 'exports') ||
               (mb.value.object.type === 'MemberExpression' && 
                mb.value.object.object.type === 'Identifier' && mb.value.object.object.name === 'module' &&
                mb.value.object.property.type === 'Identifier' && mb.value.object.property.name === 'exports')) &&
                mb.value.property.type === 'Identifier' && mb.value.property.name === elementName;
    });

    //convert the object of the member expression of the property's usage
    //inside its definition with a reference to the introduced variable
    if(elemRefsInsideDef.length > 0) {

        elemRefsInsideDef.forEach(elemRef => {

            jscodeshiftAPI(elemRef).replaceWith(variableIdentifier);
        });
    }

    return true;
}

/**
 * Replaces each property's reference with its mapped variable reference.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} elementReferences 
 * @param {*} variableIdentifier 
 */
function replaceDefinitionReferencesWithEncapsulatedVariableReferences(jscodeshiftAPI, astRootCollection, elementReferences, variableIdentifier) {

    //search each property reference in the AST
    //and replace it with the property's mapped variable reference
    elementReferences.forEach(elementRef => {

        let elementRefLoc = elementRef.loc;

        let elRefs = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elementRef);

        // let elRefs = astRootCollection.find(jscodeshiftAPI.MemberExpression).filter(mb => {

        //     if(mb.value.loc === null) {

        //         return false;
        //     }

        //     let mbLoc = mb.value.loc;
        //     return mbLoc.start.line === elementRefLoc.start.line && mbLoc.start.column === elementRefLoc.start.column &&
        //            mbLoc.end.line === elementRefLoc.end.line && mbLoc.end.column === elementRefLoc.end.column;
        // });

        if(elRefs.length > 0) {

            elRefs.replaceWith(variableIdentifier);
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