/**
 * Author: Nefeli Sylvia Charalambous
 * Date: 16/10/2017
 * 
 * Tranform code with jscodeshift
 * Insert Import Declaration
 * (only imports from modules defined locally in the analyzed system are considered).
 */

var exports = module.exports = {};


exports.description = "insert_import";

//replaces commonJS import statement (call to require()) to an ES6 import statement
exports.refactoring = function (jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	//(i) remove commonJS require statement, but keep info about the imported element
	//(needed in the ES6 import statement that will be inserted)
	var importedElementObject = removeCommonJSRequireStatement(jscodeshiftAPI, astRootCollection, transformationInfo);

	// console.log(transformationInfo);
	// console.log(importedElementObject);

	var importedElement = transformationInfo.importedElement;
	
	var importedElementName = importedElement.elementName;
	var definitionModuleName = importedElement.definitionModuleName;
	var importedElementAlias;
	if(importedElementObject === undefined) {

		//case: a module is imported as a whole
		importedElementAlias = importedElementName;
	}
	else {

		importedElementAlias = importedElementObject.importedModulePropertyAlias;
	}

	//TODO: in the created ImportDeclaration, add the comments of the deleted import declaration
	var comments = importedElementObject.comments;

	// parentNodeValueType: the type of the AST node representing the parent of the import of the element 
	//(the syntax of the ES6 import that is going to be introduced is partially determined by parentNodeValueType)
	var parentNodeValueType = importedElementObject.parentNodeValueType;

	// console.log(comments);

	// var importedElementAlias = importedElementObject.importedModulePropertyAlias;
	var usedGlobalIdentifiers;
	
	if(transformationInfo.dependencyType === 'GlobalDefinition') {
		
		//case: there exists an imported global variable modification 
		//in the source code represented by astRootCollection - assign imported global
		//to a module variable (binding) and rename the usages of the imported global 
		//to usages of the module variable
		usedGlobalIdentifiers = importedElement.usageSet;
		
		//(iii) before inserting new AST nodes, rename any use of imported global
		//(avoid type error due to imported element overwriting in ES6)
		
		//(1) create binding to the imported element & 
		//replace each use of the importing global with the name of the binding
		var elementAlias = importedElementAlias + "Binding";
		var bindingIdentifier = jscodeshiftAPI.identifier(elementAlias);
		
		//(2) apply rename transformations based on the node representing
		//the identifier that need to be renamed
		usedGlobalIdentifiers.forEach(function(usedGlobalIdentifier) {
			
			//search usedGlobalIdentifier by AST node and replace it with the bindingIdentifier
			return astRootCollection.find(jscodeshiftAPI.Identifier, usedGlobalIdentifier)
									.replaceWith(bindingIdentifier);
			
		});
		
		//(iv) insert node representing the binding declaration
		//after the node representing importDeclaration
		var initIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
		var bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, initIdentifier);
		var bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);
		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(bindingDeclaration);
	}
	
	var importIdentifier;
	if(importedElementName === 'anonymus') {

		//imported element is an anonymus function - create an identifier named definitionModuleName
		//each module's name is unique
		//case: prop-types
		importIdentifier = jscodeshiftAPI.identifier(definitionModuleName.replace(/.\//g, ''));
	}
	else {

		importIdentifier = jscodeshiftAPI.identifier(importedElementName);
	}
	
	// var importIdentifier = jscodeshiftAPI.identifier(importedElementName);
	// var localIdentifier = jscodeshiftAPI.identifier(importedElementAlias);

	//(ii) create node representing ES6 import and add it to the AST
	//the syntax of the introduced ES6 import statement is determined by the type of the export statement of the element in the definition module
	var isImportedElementExportedViaModuleExports = transformationInfo.importedElement.isImportedElementExportedViaModuleExports;
	var importDeclaration;
	if(parentNodeValueType === 'VariableDeclarator') {

		//case (c) export statement type: assignment to module.exports (syntax: module.exports = <elementName>) && var <variableName> = require(<modulePath>)
		//case (b) export statement type: assignment to exports (syntax: exports.<identifier> = <elementName>) && var <variableName> = require(<modulePath>) 
		//=> import * as <variableName> from '<modulePath>';
		var localIdentifier = jscodeshiftAPI.identifier(importedElementAlias);

		var importSpecifier = jscodeshiftAPI.importNamespaceSpecifier(localIdentifier);

		importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], jscodeshiftAPI.literal(definitionModuleName));

		// console.log(jscodeshiftAPI(importDeclaration).toSource());
	}
	else {

		//case (a) export statement type: assignment to exports property (syntax: exports.<identifier> = <elementName>) && var <variableName> = require(<modulePath>).<elementName> or
		//=> import {<elementName> [as <variableName>]} from '<modulePath>';

		//localIdentifier: in case when the result of require() (or the property of the require() result) is assigned
		//to a variable with a different name (name aliasing)

		// console.log(importedElementName + " " + importedElementAlias);

		if(importedElementName !== 'anonymus') {

			//imported element is not an anonymus function - create named import
			var importSpecifier;
			if(importedElementAlias !== undefined) {

				var localIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			}
			else {

				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier);
			}
			
			importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], jscodeshiftAPI.literal(definitionModuleName));
		}
		else {

			//imported element is an anonymus function (which is exported via module.exports - default export)
			importSpecifier = jscodeshiftAPI.importDefaultSpecifier(importIdentifier);
			importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], jscodeshiftAPI.literal(definitionModuleName));
		}
		

		// console.log(jscodeshiftAPI(importDeclaration).toSource());
	}
	
	//insert the newly created AST node (node representing the ES6 import statement) at the top of the AST
	astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
	
}

/**
 * Removes an import statement of a commonJS module.
 * @param jscodeshiftAPI
 * @param astRootCollection
 * @param definition
 * @returns the identifier that is accessed in the removed import statement
 */
function removeCommonJSRequireStatement(jscodeshiftAPI, astRootCollection, transformationInfo) {
	
	var importedElement = transformationInfo.importedElement;
	var importedElementNode = importedElement.importedElementNode;
	
	var importedElementObject;
	
	//(i) find import statement that needs to be removed
	//search by node representing the import statement
	
	//find specific call to require() through the AST CallExpression node
	//callee: function called in CallExpression node (contains the range, 
	//namely the position of the node in the AST)
	var callExpressions = astRootCollection.find(jscodeshiftAPI.CallExpression, {callee: importedElementNode.callee});
	var callExpression;
	
	for(var callExpressionIndex = 0; callExpressionIndex < callExpressions.length; callExpressionIndex++) {
		
		callExpression = callExpressions.at(callExpressionIndex).get();
		
		// callExpression syntax: require(<modulePath>)[.<importedElement.elementName>]
		
		var importedElementObject = {};
		
		/*ES6 named import needs two (or three) elements:
		(1) the name of the imported element's definition module
		(2) the name of the imported element
		(3) an alias of the imported element (optional)*/
		
		/* (1) find the name of the imported element's definition module
		(1st argument of require()) */
		var callExpressionValue = callExpression.value;
		var calleeArguments = callExpressionValue.arguments;
		
		var importedSourceFileName = calleeArguments[0].value;
		
		importedElementObject['definitionModule'] = importedSourceFileName;
		
		/* (2) find the name of the imported element
		//case 1: after call to require(), a property is accessed (parentNode is a MemberExpression)
		//case 2: after call to require(), no property is accessed (parentNode is a VariableDeclarator) */
		
		var importedProperty;
		var importedElementAlias;
		
		var variableDeclaratorNode;
		
		//find parentPath of callExpression
		var parentNode = callExpression.parentPath;
		var parentNodeValue = parentNode.value;
		var parentNodeValueType = parentNodeValue.type;

		var variableDeclarations;
		var variableDeclaration;
		var comments;
		if(parentNodeValueType === 'MemberExpression') {
			
			//case 1: parentNode is a MemberExpression
			//(parentNode syntax: require(<modulePath>).<modulePropertyName> )
			importedProperty = parentNodeValue.property.name;
			
			//find CommonJS export statement
			//(CommonJS export statement syntax: var <variableName> = require(<modulePath>).<modulePropertyName>)
			variableDeclaratorNode = parentNode.parentPath;
			
			//(3) find alias of the imported element (<variableName>)
			//(the name of the variable that is assigned the result of the call to require())
			importedElementAlias = variableDeclaratorNode.value.id.name;
			
			//remove node representing the whole import statement
			//(assignment expression where result of call to 
			//require() is assigned to a variable)

			//search VariableDeclaration AST node by node value (each variable assigned the result of a call to require() is defined once)
			//export/import statement are not processed, as their refactoring leads to runtime errors (maybe an extension?)
			variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclarator, variableDeclaratorNode.value);
			variableDeclaration = variableDeclarations.at(0).get();

			//keep comments of the AST node that is going to be deleted
			comments = variableDeclaration.parentPath.value.comments;
			if(comments === undefined) {

				comments = null;
			}

			//remove the AST node representing the commonJS export statement
			variableDeclarations.remove();
		}
		else if(parentNodeValueType === 'VariableDeclarator') {
			
			//case 2: parentNode is a VariableDeclarator
			//(syntax: var <variableName> = require(<modulePath>) )
			importedProperty = transformationInfo.importedElement.elementName;
			
			variableDeclaratorNode = parentNode;
			
			//(3) find alias of the imported element
			//(the name of the variable that is assigned the result of the call to require())
			importedElementAlias = variableDeclaratorNode.value.id.name;
			
			//remove node representing the whole import statement
			//(assignment expression where result of call to 
			//require() is assigned to a variable))
			//search VariableDeclaration AST node by node value (each variable assigned the result of a call to require() is defined once)
			//export/import statement are not processed, as their refactoring leads to runtime errors (maybe an extension?)
			variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclarator, variableDeclaratorNode.value);
			variableDeclaration = variableDeclarations.at(0).get();

			//keep comments of the AST node that is going to be deleted
			comments = variableDeclaration.parentPath.value.comments;
			if(comments === undefined) {

				comments = null;
			}

			//remove the AST node representing the commonJS export statement
			variableDeclarations.remove();

			//astRootCollection.find(jscodeshiftAPI.VariableDeclarator, variableDeclaratorNode.value).remove();
		}
		else if(parentNodeValueType === 'AssignmentExpression') {
			
			//case: result of requireCall is assigned directly to exports/module.exports
			//syntax: exports.<exportedElementIdentifier> = require(<modulePath>)[.<moduleProperty>] or
			//		  module.exports = require(<modulePath)[.<moduleProperty>]
			
			importedProperty = transformationInfo.importedElement.elementName;
			
			//get left operand of AssignmentExpression AST node (syntax: exports.<exportedElementIdentifier>)
			variableDeclaratorNode = parentNodeValue.left;
			
			//(3) find alias of the imported element (exportedElementIdentifier)
			//(the name of the variable that is assigned the result of the call to require())
			importedElementAlias = variableDeclaratorNode.property.name;
			if(importedElementAlias === 'exports') {
				
				//result of requireCall is assigned to module.exports
				//(syntax: module.exports = require(<modulePath)[.<moduleProperty>])
				//importedProperty is assigned to importedElementAlias (case: module.exports = require(<modulePath))
				importedElementAlias = importedProperty;
			}
			
			//remove node representing the whole import statement
			//(assignment expression where result of call to 
			//require() is assigned to a variable)
			////(syntax: <variableName> = require(<argumentName>).<modulePropertyName> or
			// <variableName> = require(<argumentName>) or
			// exports.<alias> = require(<modulePath>)[.modulePropertyName] or
			// module.exports = require(<modulePath>)[.modulePropertyName] )
			
			var assignmentExpressions = astRootCollection.find(jscodeshiftAPI.AssignmentExpression, parentNode.value);

			//keep comments of the AST node that is going to be deleted
			comments = assignmentExpressions.at(0).get().value.comments;
			if(comments === undefined) {

				comments = null;
			}

			// console.log(assignmentExpressions.at(0).get().value.comments);

			// astRootCollection.find(jscodeshiftAPI.AssignmentExpression, parentNode.value).remove();
			
			//create a named export for importedProperty and insert it at 
			//the start of the AST (top-level scope of the source code)
			
			var variableIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
			var exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
			
			//create an named export (the exported specifier is not a variable/function definition,
			//it is the element referenced by importedProperty)
			var exportNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);
			
			//insert exportNode at the start of the AST
			astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(exportNode);
			
			//remove the AST node representing the commonJS export statement
			//(remove the whole assignment expression)
			assignmentExpressions.remove();
		}
		
		importedElementObject['importedModuleProperty'] = importedProperty;
		
		//(3) find alias of the imported element
		//(the name of the variable that is assigned the result of the call to require())
		importedElementObject['importedModulePropertyAlias'] = importedElementAlias;

		importedElementObject['comments'] = comments;

		//add parentNodeValueType to importedElementObject
		//(i)  parentNodeValueType = 'MemberExpression': export statement syntax: var <variableName> = require(<modulePath>).<elementName> => import {<elementName> [as <variableName>]} from '<modulePath>';
		//(ii) parentNodeValueType = 'VariableDeclarator': export statement syntax: var <variableName> = require(<modulePath>) => import * as <variableName> from 'modulePath';
		importedElementObject['parentNodeValueType'] = parentNodeValueType;
		
		return importedElementObject;
	}
	
	return importedElementObject;
}