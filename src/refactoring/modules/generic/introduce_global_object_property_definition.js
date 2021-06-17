/**
 * Introduce_global_object_property_definition.js. Codemod that involves the transformation of a global
 * object property into a module variable (and the limitation of its scope).
 */

exports.refactoring = function(jscodeshiftAPI, astRootCollection, transformationInfo) {

    // console.log(transformationInfo);

    //name of the module variable that will be introduced: global<Variable>
    let propertyName = 'global' + 
                        transformationInfo.importedElement.elementName.charAt(0).toUpperCase() + 
                        transformationInfo.importedElement.elementName.slice(1);
    
    let propertyAccessStatementNodeObj = transformationInfo.importedElement.propertyAccessStatementNode;
    let definitionFunctionName = transformationInfo.importedElement.definitionFunctionName;

    //(1) introduce a variable definition with the property's name
    introduceVariableDeclaration(jscodeshiftAPI, astRootCollection, propertyName);
    
    //(2) replace property initialization statement with an initialization of the introduced variable
    // let {assignmentExpressionCollection, initializationStatementNode} = replacePropertyInitializationStatement(jscodeshiftAPI, astRootCollection, propertyName, propertyAccessStatementNodeObj, transformationInfo.importedElement.elementName);

    let resObj = replacePropertyInitializationStatement(jscodeshiftAPI, astRootCollection, propertyName, propertyAccessStatementNodeObj, transformationInfo.importedElement.elementName);

    // console.log(resObj);

    if(resObj == null) {

        return;
    }

    let {assignmentExpressionCollection, initializationStatementNode} = resObj;

    //initialize context for function definition introduction
    let functionIntroduction = new functionIntroductionContext();
    
    // //(3) introduce a function with a body consisting of the initializationStatementNode
    // let variableInitializationFunction = new IntroduceVariableInitializationFunction(jscodeshiftAPI, astRootCollection, definitionFunctionName, initializationStatementNode, propertyName);
    // functionIntroduction.setStrategy(variableInitializationFunction);
    // functionIntroduction.introduceFunction();

    // //(4) replace initializationStatementNode with a call site of the introduced function
    // assignmentExpressionCollection.replaceWith(path => {

    //     let callExpression = jscodeshiftAPI.callExpression(jscodeshiftAPI.identifier(definitionFunctionName), [initializationStatementNode.value.right]);

    //     // console.log(jscodeshiftAPI(callExpression).toSource());

    //     //create an expression statement representing modificationFunctionName()
    //     let expressionStatement = jscodeshiftAPI.expressionStatement(callExpression);

    //     // console.log(jscodeshiftAPI(expressionStatement).toSource());

    //     //replace module variable modification with the call to modificationFunctionName
    //     return expressionStatement;
    // });

    //(5) introduce a default getter function for the newly introduced variable
    // let getterFunctionName = 'get' + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
    // let getterFunction = new IntroduceGetterForVariableDefinition(jscodeshiftAPI, astRootCollection, propertyName, getterFunctionName);
    // functionIntroduction.setStrategy(getterFunction);
    // functionIntroduction.introduceFunction();

    //(6) introduce a default setter function for the newly introduced variable
    let setterFunctionName = 'set' + 
                             propertyName.charAt(0).toUpperCase() + 
                             propertyName.slice(1);

    let setterFunction = new IntroduceSetterForVariableDefinition(jscodeshiftAPI, astRootCollection, propertyName, setterFunctionName);
    functionIntroduction.setStrategy(setterFunction);
    functionIntroduction.introduceFunction();

};

/**
 * Introduces a definition of a variable named propertyName in the top of the AST specified by astRootCollection.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} propertyName 
 */
function introduceVariableDeclaration(jscodeshiftAPI, astRootCollection, propertyName) {

    let variableIdentifier = jscodeshiftAPI.identifier(propertyName);
	let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
    let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

    let variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, variableDeclaration);
    if(variableDeclarations.length !== 0) {

        //prevent introducing the same variable twice (case: multiple definitions of property in module)
        return;
    }

    //the introduced variable is exported by default
    let exportNamedDeclaration = jscodeshiftAPI.exportNamedDeclaration(variableDeclaration);
    
    let es6ImportStatements = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);
	if(es6ImportStatements.length > 0) {

		//ES6 import statements exist - add variableDeclaration after the last ES6 import
        // jscodeshiftAPI(es6ImportStatements.at(-1).get()).insertAfter(variableDeclaration);
        
        jscodeshiftAPI(es6ImportStatements.at(es6ImportStatements.length-1).get()).insertAfter(exportNamedDeclaration);
	}
	else {

		//ES6 import statements do not exist - add it at the top of the AST
        // astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);
        
        astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(exportNamedDeclaration);
    }
    
    //return the collection ES6 import declarations (the function definition will be introduced after these statements)
    // return es6ImportStatements;
	// astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertAfter(variableDeclaration);
}

/**
 * In the AST specified by astRootCollection, the function replaces the initialization statement 
 * of a global object property with the initialization statement of the variable specified by 
 * propertyName.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} propertyName 
 */
function replacePropertyInitializationStatement(jscodeshiftAPI, astRootCollection, variableName, propertyAccessStatementNode, propertyName) {

    let assignmentExpressionCollection;
    let initializationStatementNode;
    let accessStatementLocStart = propertyAccessStatementNode.loc.start;
    let accessStatementLocEnd = propertyAccessStatementNode.loc.end;

    // console.log(astRootCollection.toSource());
    // console.log(propertyAccessStatementNode);

    //(a) retrieve property initialization statement
    assignmentExpressionCollection = astRootCollection.find(jscodeshiftAPI.AssignmentExpression).filter(path => {

        // console.log(path.value);
        // console.log(propertyAccessStatementNode);
        // return path.value === propertyAccessStatementNode;

        if(path.value.loc === null) {

            //prevent searching on newly introduced assignments
            return false;
        }

        return path.value.loc.start.line === accessStatementLocStart.line && path.value.loc.start.column === accessStatementLocStart.column &&
               path.value.loc.end.line === accessStatementLocEnd.line && path.value.loc.end.column === accessStatementLocEnd.column &&
               path.value.left.type === 'MemberExpression' && (path.value.left.object.name === 'window' || path.value.left.object.name === 'global') &&
               path.value.left.property.name === propertyName;
    });

    // console.log(assignmentExpressionCollection.length);

    if(assignmentExpressionCollection.length === 0) {

        //no initialization statement for property - terminate
        return null;
    }

    initializationStatementNode = assignmentExpressionCollection.at(0).get();
    
    //(b) replace reference to global object property with a referenced to the introduced variable
    initializationStatementNode.value.left = jscodeshiftAPI.identifier(variableName);

    //return the collection of the assignment expressions (needed for the replacement with the callsite), 
    //along with the transformed initialization statement (needed for the creation of the function)
    return {

        assignmentExpressionCollection: assignmentExpressionCollection,
        initializationStatementNode: initializationStatementNode
    };
}

/**
 * (Context)
 * Function definition introduction.
 */
var functionIntroductionContext = function() {

    this.functionIntroduction = null;
};

functionIntroductionContext.prototype = {

    setStrategy: function(functionIntroduction) {

        this.functionIntroduction = functionIntroduction;
    },
    introduceFunction: function() {

        this.functionIntroduction.introduceFunctionDeclaration();
    }
};

/**
 * (Strategy 1)
 * Introduces the function that is responsible for the variable's initialization in the top of the AST specified by astRootCollection.
 * The function is specified by definitionFunctionName and its body comprises the statement specified by initializationStatementNode.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} definitionFunctionName 
 * @param {*} initializationStatementNode 
 */
var IntroduceVariableInitializationFunction = function(jscodeshiftAPI, astRootCollection, definitionFunctionName, initializationStatementNode, propertyName) {

    this.jscodeshiftAPI = jscodeshiftAPI;
    this.astRootCollection = astRootCollection;
    this.definitionFunctionName = definitionFunctionName;
    this.initializationStatementNode = initializationStatementNode;
    this.propertyName = propertyName;

    this.introduceFunctionDeclaration = function() {

        let leftOperand = this.initializationStatementNode.value.left;
        let rightOperand = this.initializationStatementNode.value.right;
        let functionArgument = jscodeshiftAPI.identifier(definitionFunctionName + "_argument");
        let assignmentExpression = this.jscodeshiftAPI.assignmentExpression('=', leftOperand, functionArgument);

        //create the expression statement that will be introduced in the body of the function that is going to be created
        let expressionStatement = this.jscodeshiftAPI.expressionStatement(assignmentExpression);

        //create the block statement corresponding to the body of the function that is going to be created
        let blockStatement = this.jscodeshiftAPI.blockStatement([expressionStatement]);

        //create the function declaration:
        //(i) the parameter of the function is the property's initialization value (the right operand of the initialization statement)
        //(ii) the body of the function is the initialization statement
        let functionNameIdentifier = this.jscodeshiftAPI.identifier(this.definitionFunctionName);
        let functionDeclaration = this.jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [functionArgument], blockStatement);

        let functionDeclarations = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, functionDeclaration);
        if(functionDeclarations.length !== 0) {

            //prevent introducing the same function twice (case: multiple definitions of property in module)
            return;
        }

        //insert the function right before the module variable that is defined
        let variableDeclarationCollection = this.astRootCollection.find(this.jscodeshiftAPI.VariableDeclaration).filter(path => {

            let declarations = path.value.declarations;

            if(declarations.find(declaration => {

                return declaration.id.name === this.propertyName && path.parentPath.parentPath.value.type === 'Program';

            }) != undefined) {

                return true;
            }

            return false;

            // for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

            //     let declaration = declarations[declarationIndex];
            //     return declaration.id.name === this.propertyName && path.parentPath.parentPath.value.type === 'Program';
            // }
        });

        //variable initialization function: it is not exported from the module
        if(variableDeclarationCollection.length === 0) {

            //there are no such variable definitions
            //insert functionDeclaration at the top of the AST
            this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body',0).insertAfter(functionDeclaration);
        }
        else {

            //insert function declaration right before the defined module variable
            variableDeclarationCollection.insertBefore(functionDeclaration);
        }
    }
}

/**
 * (Strategy 2)
 * Introduces the the default getter function for the variable specified by propertyName in the top of the AST specified by astRootCollection.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} definitionFunctionName 
 * @param {*} initializationStatementNode 
 */
var IntroduceGetterForVariableDefinition = function(jscodeshiftAPI, astRootCollection, propertyName, getterFunctionName) {

    this.jscodeshiftAPI = jscodeshiftAPI;
    this.astRootCollection = astRootCollection;
    this.propertyName = propertyName;
    this.getterFunctionName = getterFunctionName;

    this.introduceFunctionDeclaration = function() {

        let propertyIdentifier = this.jscodeshiftAPI.identifier(this.propertyName);

        //create the expression statement that will be introduced in the body of the function that is going to be created
        let expressionStatement = this.jscodeshiftAPI.returnStatement(propertyIdentifier);

        //introduce the getter function right before the newly inserted variable definition
        //create the block statement corresponding to the body of the function that is going to be created
        let blockStatement = this.jscodeshiftAPI.blockStatement([expressionStatement]);

        // console.log(jscodeshiftAPI(blockStatement).toSource());

        //create the function declaration whose body is represented by blockStatement
        let functionNameIdentifier = this.jscodeshiftAPI.identifier(this.getterFunctionName);
        let functionDeclaration = this.jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [], blockStatement);

        let functionDeclarations = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, functionDeclaration);
        if(functionDeclarations.length !== 0) {

            //prevent introducing the same function twice (case: multiple definitions of property in module)
            return;
        }

        //insert the function right before the module variable that is defined
        let variableDeclarationCollection = this.astRootCollection.find(this.jscodeshiftAPI.VariableDeclaration).filter(path => {

            let declarations = path.value.declarations;
            if(declarations.find(declaration => {

                return declaration.id.name === this.propertyName && path.parentPath.parentPath.value.type === 'Program';

            }) != undefined) {

                return true;
            }

            return false;

            // for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

            //     let declaration = declarations[declarationIndex];
            //     return declaration.id.name === this.propertyName && path.parentPath.parentPath.value.type === 'Program';
            // }
        });

        //getter function: it is exported from the module
        let node = this.jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

        if(variableDeclarationCollection.length === 0) {

            //there are no such variable definitions
            //insert functionDeclaration at the top of the AST
            this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body',0).insertAfter(node);
        }
        else {

            //insert function declaration right before the defined module variable
            // jscodeshift(variableDeclarationCollection.at(0).get()).insertBefore(node);

            this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body',0).insertBefore(node);
        }
    };

}

/**
 * (Strategy 3)
 * Introduces the the default setter function for the variable specified by propertyName in the top of the AST specified by astRootCollection.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} definitionFunctionName 
 * @param {*} initializationStatementNode 
 */
var IntroduceSetterForVariableDefinition = function(jscodeshiftAPI, astRootCollection, propertyName, setterFunctionName) {

    this.jscodeshiftAPI = jscodeshiftAPI;
    this.astRootCollection = astRootCollection;
    this.propertyName = propertyName;
    this.setterFunctionName = setterFunctionName;

    this.introduceFunctionDeclaration = function() {

        let propertyIdentifier = this.jscodeshiftAPI.identifier(this.propertyName);

        // let valueIdentifier = this.jscodeshiftAPI.identifier(this.propertyName.toLowerCase());

        let valueIdentifier = this.jscodeshiftAPI.identifier('value');

        let assignmentExpression = this.jscodeshiftAPI.assignmentExpression('=', propertyIdentifier, valueIdentifier);

        //create the expression statement that will be introduced in the body of the function that is going to be created
        let expressionStatement = this.jscodeshiftAPI.expressionStatement(assignmentExpression);

        //introduce the setter function right before the newly inserted variable definition
        //create the block statement corresponding to the body of the function that is going to be created
        let blockStatement = this.jscodeshiftAPI.blockStatement([expressionStatement]);

        // console.log(jscodeshiftAPI(blockStatement).toSource());

        //create the function declaration whose body is represented by blockStatement
        let functionNameIdentifier = this.jscodeshiftAPI.identifier(this.setterFunctionName);
        let functionDeclaration = this.jscodeshiftAPI.functionDeclaration(functionNameIdentifier, [valueIdentifier], blockStatement);

        let functionDeclarations = astRootCollection.find(jscodeshiftAPI.FunctionDeclaration, functionDeclaration);
        if(functionDeclarations.length !== 0) {

            //prevent introducing the same function twice (case: multiple definitions of property in module)
            return;
        }

        //insert the function right before the module variable that is defined
        let variableDeclarationCollection = this.astRootCollection.find(this.jscodeshiftAPI.VariableDeclaration).filter(path => {

            let declarations = path.value.declarations;
            if(declarations.find(declaration => {

                return declaration.id.name === this.propertyName && 
                        path.parentPath.parentPath.value.type === 'Program';

            }) != undefined) {

                return true;
            }

            return false;

            // for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

            //     let declaration = declarations[declarationIndex];
            //     return declaration.id.name === this.propertyName && path.parentPath.parentPath.value.type === 'Program';
            // }
        });

        //setter function: it is exported from the module
        let node = this.jscodeshiftAPI.exportNamedDeclaration(functionDeclaration);

        //insert function declaration at the bottom of the AST
        this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body').value.push(node);
        
        // if(variableDeclarationCollection.length === 0) {

        //     //there are no such variable definitions
        //     //insert functionDeclaration at the top of the AST
        //     this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body',0).insertAfter(node);
        // }
        // else {

        //     //insert function declaration right before the defined module variable
        //     // variableDeclarationCollection.insertBefore(node);

        //     this.astRootCollection.find(this.jscodeshiftAPI.Program).get('body',0).insertBefore(node);
        // }
    };
}

/**
 * Maps an object specifying a statement to the actual statement.
 * @param nodeObj the object specifying the statement
 */
function searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, nodeObj) {

    let stmtType = nodeObj.type;
    let stmtLoc = nodeObj.loc;

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