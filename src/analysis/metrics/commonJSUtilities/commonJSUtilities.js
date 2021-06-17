/**
 * 
 */

var fs = require('fs');
var path = require('path');
const process = require('process');

var jscodeshift = require('../../../../node_modules/jscodeshift');
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

var FunctionDeclaration = require('../../ast/model/functionDeclaration.js');
var Variable = require('../../ast/model/variable.js');
var FunctionProperty = require('../../ast/model/functionProperty.js');
var ObjectProperty = require('../../ast/model/objectProperty.js');

var ImportedElement = require('../../ast/model/importedElement.js');
var ExportedProperty = require('../../ast/model/exportedProperty.js');
var ImportedNamespace = require('../../ast/model/importedNamespace.js');
var ImportedModule = require('../../ast/model/importedModule.js');

const util = require('../../ast/util/util.js');
var codeHierarchyUtilities = require('../../ast/util/codeHierarchyUtilities.js');
var enums = require('../../ast/util/enums.js');

var fileUtilities = require('../../../io/fileUtilities.js');

//used to retrieve the number of the distinct CommonJS modules that are imported 
//(referenced in a callsite of require()) in the analyzed system
var distinctImportedModules = [];
exports.distinctImportedModules = distinctImportedModules;

//used to retrieve the number of the distinct CommonJS external (not located in the system under analysis) 
//that are imported (referenced in a callsite of require()) in the analyzed system
var distinctImportedExternalModules = [];
exports.distinctImportedExternalModules = distinctImportedExternalModules;

//used to retrieve the number of the CommonJS import statements that are located in the analyzed system
//(#call sites of require())
var systemImportStatements = [];
exports.systemImportStatements = systemImportStatements;


/**
 * Is sourceFile a commonJS module?
 * @param sourceFile
 * @returns
 */
function isSourceFileACommonJSModule(sourceFile) {
	
	//(i) does sourceFile contain export statements with commonJS syntax?
	
	getExportStatementsOfCommonJSModule(sourceFile);
	
	if(sourceFile.statementsReferencingExportObject.length !== 0 || sourceFile.assignmentsToExportObjectBindings.length !== 0) {

		//sourceFile does contain either assignments or bindings to the export object (exports/module.exports)
		sourceFile.updateSourceVersion(enums.SourceVersion.ES5);
		sourceFile.updateModuleFramework(enums.ModuleFramework.CommonJS);
		return true;
	}
	
	//(ii) does sourceFile contain import statements with commonJS syntax?
	var requireCalls = getImportStatementsOfCommonJSModule(sourceFile);
	
	for(var callIndex = 0; callIndex < requireCalls.length; callIndex++) 
	{
		var requireCall = requireCalls[callIndex];
		var requireCallArguments = requireCall.value.arguments;
		if(requireCallArguments.length === 1) {
			
			//sourceFile contains commonJS import declarations -
			//it is a commonJS module
			
			sourceFile.updateSourceVersion(enums.SourceVersion.ES5);
			sourceFile.updateModuleFramework(enums.ModuleFramework.CommonJS);
			return true;
		}
	}
	
	return false;
}

/**
 * Retrieves the exported elements (variables, functions, anonymus object expressions) of a commonJS module.
 * @param sourceFile
 * @returns
 */
function retrieveExportedElementsOfCommonJSModule(sourceFile) {
	
	//retrieve export statements in sourceFile
	getExportStatementsOfCommonJSModule(sourceFile);
	
	/**
	  a CommonJS module contains either:
	(a) an assignment referencing the export object
	(b) a module variable initialized with the export object
	(c) bindings to the export object
	(d) a mix of (a)/(b) and (c)
	(d) none of the above

	*/

	//statements containing references (not bindings) of the export object
	let statementsReferencingExportObject = sourceFile.statementsReferencingExportObject;

	//assignments to export object bindings
	let assignmentsToExportObjectBindings = sourceFile.assignmentsToExportObjectBindings;

	// console.log(sourceFile.fileName);
	// console.log(statementsReferencingExportObject.length);
	// console.log(assignmentsToExportObjectBindings);

	//sourceFile does not have anly export statements (d)
	if(statementsReferencingExportObject.length === 0 && assignmentsToExportObjectBindings.length === 0) {

		return;
	}

	//in the case that the CommonJS module contains an assignment to the export object
	//this definition is exported
	//find the definition (variable, function) that is exported-
	//in the case that there are bindings to export object, these bindings comprise the definition's properties
	
	//case: multiple statements with export object references
	//keep one as a property's definition, the others as references
	let propertyRefs = [];
	statementsReferencingExportObject = statementsReferencingExportObject.filter(stmtRefExpObj => {

		// console.log(stmtRefExpObj.value.type);
		if(stmtRefExpObj.value.type === 'VariableDeclaration') {

			return true;
		}

		if(stmtRefExpObj.value.type === 'ExpressionStatement') {

			//(b)
			//reference to exports/module.exports at the left or at the right part of the assignment (it is allowed)

			
			let processStmt = stmtRefExpObj.value.expression;
			if(processStmt.type === 'AssignmentExpression') {

				let leftOperand = processStmt.left;
				let rightOperand = processStmt.right;

				if(leftOperand.type === 'MemberExpression' &&
					leftOperand.object.type === 'Identifier' && leftOperand.object.name !== 'module' &&
					leftOperand.property.type === 'Identifier' && leftOperand.property.name !== 'exports') {

					//case: multiple statements with export object references
					//do not consider assignments of the export object
					//in member expressions
					//(consider them as property references)
					// console.log(rightOperand);
					propertyRefs.push(rightOperand);
					return false;
				}
				
				return true;
			}

		}

		return false;
	});

	statementsReferencingExportObject.forEach(statementReferencingExportObject => {

		// console.log(statementReferencingExportObject);

		//statementReferencingExportObject is either:
		//(a) a variable declaration (in the case the export object is the initialization value of a variable) or
		//(b) an expression statement (in the case that the export object is assigned to/with a variable/function/object)
		if(statementReferencingExportObject.value.type === 'VariableDeclaration') {

			//(a)
			let declarations = statementReferencingExportObject.value.declarations;
			declarations.forEach(declaration => {

				let variableName = declaration.id.name;

				//variableName is assigned the value of the export object
				//it is marked as exported
				sourceFile.updateExplicitElementToExported(variableName,statementReferencingExportObject, true);
			});
		}
		else if(statementReferencingExportObject.value.type === 'ExpressionStatement') {

			//(b)
			//reference to exports/module.exports at the left or at the right part of the assignment (it is allowed)

			
			let processStmt = statementReferencingExportObject.value.expression;
			while(processStmt.type === 'AssignmentExpression') {

				let leftOperand = processStmt.left;

				if(leftOperand.type === 'Identifier' && leftOperand.name !== 'exports') {

					//leftOperand is an identifier, but not a reference to the exported object
					let definitionName = leftOperand.name;

					//mark definition with name definitionName as exported
					sourceFile.updateExplicitElementToExported(definitionName, statementReferencingExportObject, true);
				}
				
				processStmt = processStmt.right;
			}

			// console.log(processStmt);

			//processStmt is the rightmost operand of statementReferencingExportObject
			//check if it is an identifier or a function expression (or the result of a function invocation)
			if(processStmt.type === 'Identifier' && processStmt.name !== 'exports') {

				//processStmt is an identifier, but not a reference to the exported object
				let definitionName = processStmt.name;

				//mark definition with name definitionName as exported
				sourceFile.updateExplicitElementToExported(definitionName, statementReferencingExportObject, true);
			}
			else if(processStmt.type === 'FunctionExpression') {

				//processStmt is an identifier and not a reference to the exported object
				//mark definition as exported
				let definedFunction = sourceFile.retrieveDefinedFunctionByNode(processStmt);
				if(definedFunction !== null) {

					definedFunction.updateIsExported(true);
					definedFunction.updateExportedFunctionNode(statementReferencingExportObject);
					definedFunction.updateExportStatementType(true);
				}
				
			}
			else {

				//processStmt is neither a function expression nor an identifier
				//maybe the result of a function invocation
				//it is an object assigned to export object
				//add it to the file exported property array
				let exportedProperty = new ExportedProperty.ExportedProperty(statementReferencingExportObject);
				exportedProperty.updatePropertyExportedThroughModuleExports(true);

				//the other bindings to the export object comprise the properties of exportedProperty
				exportedProperty.updateExportedProperty(assignmentsToExportObjectBindings, sourceFile.astRootCollection);

				//convention: in the case that exportedProperty is anonymus, give it the name of the module
				exportedProperty.exportedPropertyName = (exportedProperty.exportedPropertyName === 'anonymus' ? path.basename(sourceFile.fileName).replace(/[^\w\s]/gi, '').replace(/-/g, '') : exportedProperty.exportedPropertyName);

				exportedProperty.exportedPropertyReferences = exportedProperty.exportedPropertyReferences.concat(propertyRefs);

				sourceFile.updateExportedProperties([exportedProperty]);

				// console.log(sourceFile.fileName);
				// sourceFile.exportedProperties.forEach(exportedProperty => {

				// 	console.log(exportedProperty);
				// });

				return;
			}
		}
	});

	//retrieve the definition (variable, function) that is assigned the export object
	let exportedDefinition = sourceFile.retrieveExportedDefinition();

	// console.log(sourceFile.fileName);
	// console.log(exportedDefinition);
	// console.log(assignmentsToExportObjectBindings.length);

	//update exported definitions of sourceFile (bindings to the export object):
	//(i) exportedDefinition is null (there is no assignment of the exported object in a definition): these bindings (properties of the export object) are considered as named exports of properties
	//(ii) exportedDefinition is not null (there is an assignment of the exported object in a definition): these bindings are considered as the definition's properties
	if(exportedDefinition === null) {

		let exportedProperties = [];

		//(i)
		//update each definition (variable/function/object literal) to exported
		assignmentsToExportObjectBindings.forEach(assignmentToExportObjectBinding => {

			//module.exports.<identifier> = <value> || exports.<identifier> = <value>

			//an assignment to the export object does not exist
			//all functions bound to the export object comprise exported properties
			let leftOperand = assignmentToExportObjectBinding.value.left;
			let rightOperand = assignmentToExportObjectBinding.value.right;

			// console.log(assignmentToExportObjectBinding.value);

			let exportedProperty = new ExportedProperty.ExportedProperty(assignmentToExportObjectBinding);
			exportedProperty.updatePropertyExportedThroughModuleExports(false);
			exportedProperty.updateExportedProperty(assignmentsToExportObjectBindings, sourceFile.astRootCollection);
			existentProperties = exportedProperties.filter(function(property) {

				return property.exportedPropertyASTNode === exportedProperty.exportedPropertyASTNode ||
						property.exportedPropertyName === exportedProperty.exportedPropertyName;
			});

			let moduleDefinition = null;
			if(rightOperand.type === 'Identifier') {
					
				//exports.[<identifier>] = <identifier> || module.exports.[<identifier>] = <identifier>
				moduleDefinition = sourceFile.retrieveModuleDefinition(rightOperand.name);

				// sourceFile.updateExplicitElementToExported(rightOperand.name, assignmentToExportObjectBinding.value, false);
			}
			else if(rightOperand.type === 'FunctionExpression') {
					
				//exports.[<identifier>] = <functionExpression> || module.exports.[<identifier>] = <functionExpression>
				let exportedFunctionName = (rightOperand.id === null ? leftOperand.property.name : rightOperand.id.name);
				
				// console.log(exportedFunctionName);
				moduleDefinition = sourceFile.retrieveModuleDefinition(exportedFunctionName);

				// sourceFile.updateExplicitElementToExported(exportedFunctionName, assignmentToExportObjectBinding.value, false);
			}

			//in the case that exportedProperty is initialized with a function expression
			//or an identifier, map exportedProperty with the actual definition,
			//in order to retrieve information relevant to it (e.g. is it a constructor function?)
			exportedProperty.updateModuleDefinition(moduleDefinition);

			// console.log(exportedProperty);

			if(existentProperties.length === 0 && exportedProperty.exportedPropertyName !== null) {

				//add exported property once
				exportedProperties.push(exportedProperty);
			}

		});

		sourceFile.updateExportedProperties(exportedProperties);

		// console.log(sourceFile.fileName);
		// console.log(sourceFile.explicitGlobals.filter(explicitGlobal => {

		// 	return explicitGlobal.isExported === true;
		// }));

		return;
	}

	//(ii)
	//update each definition (variable/function/object literal) bound to the export object:
	//the definition comprises a property of the definition that is assigned the export object
	assignmentsToExportObjectBindings.forEach(assignmentToExportObjectBinding => {

		//module.exports.<identifier> = <value> || exports.<identifier> = <value>

		//for each value bound to the export object, create a property
		let isDefinitionAFunction = (exportedDefinition instanceof FunctionDeclaration.FunctionDeclaration === true);

		let leftOperand = assignmentToExportObjectBinding.value.left;
		let rightOperand = assignmentToExportObjectBinding.value.right;

		let propertyName;

		//generate an AST of leftOperand and search for references to the export object within it
		//(the property bound to the export object comprises the property of the member expression that is the parent of the export object reference)
		let leftOperandAST = jscodeshift(leftOperand);

		//search for bindings to exports
		//(different to bindings to module.exports)
		let exportsReferences = leftOperandAST.find(jscodeshift.Identifier).filter(path => {

			return path.value.name === 'exports' && 
				   path.parentPath.value.type === 'MemberExpression' && 
				   path.parentPath.value.object === path.value;
		});

		if(exportsReferences.length > 0) {

			let exportsReference = exportsReferences.at(0).get();
			propertyName = exportsReference.parentPath.value.property.name;
		}
		else {

			//search for bindings to module.exports
			let moduleExportsReferences = leftOperandAST.find(jscodeshift.MemberExpression).filter(path => {

				return path.value.object.type === 'Identifier' && path.value.object.name === 'module' &&
					   path.value.property.type === 'Identifier' && path.value.property.name === 'exports';
			});

			if(moduleExportsReferences.length === 0) {

				//no export object bindings at all
				return;
			}

			let moduleExportsReference = moduleExportsReferences.at(0).get();
			propertyName = moduleExportsReference.parentPath.value.property.name;
		}

		// console.log(propertyName);
		// console.log(isDefinitionAFunction);

		if(isDefinitionAFunction === true) {

			//definition assigned with the exported object is a function
			//create a function property
			let functionProperty = new FunctionProperty.FunctionProperty(assignmentToExportObjectBinding);
			functionProperty.updateFunctionProperty();
			// functionProperty.updateIsExported(true);
			// console.log(functionProperty);

			//do not consider properties with invalid names
			if(functionProperty.propertyName == null ||
				isNaN(functionProperty.propertyName) === false) {

				return;
			}

			exportedDefinition.addFunctionPropertyToFunction(functionProperty);
		}
		else {

			let objectProperty = new ObjectProperty.ObjectProperty(propertyName, assignmentToExportObjectBinding);
			// objectProperty.updateIsExported(true);

			let existentProperties = exportedDefinition.objectProperties.filter(function(currentObjectProperty) {
	
				return currentObjectProperty.propertyName === objectProperty.propertyName;
			});

			if(existentProperties.length === 0) {

				//there does not exist such property
				//add objectProperty to array
				exportedDefinition.objectProperties.push(objectProperty);
			}
		}

	});

// 	sourceFile.updateExportedProperties(exportedProperties);

	// console.log(sourceFile.fileName);
	// console.log(sourceFile.definedFunctions.filter(definedFunction => definedFunction.isExported === true));
	// console.log(sourceFile.explicitGlobals.filter(explicitGlobal => explicitGlobal.isExported === true));
	// sourceFile.exportedProperties.forEach(exportedProperty => {

	// 	console.log(exportedProperty);
	// });
}

/**
 * Checks if assignmentExpression represents an assignment of exports to module.exports or vice versa.
 * @param assignmentExpression
 * @returns
 */
function updateExportedElementsThroughNameAliasing(sourceFile, assignmentExpressionNode) {
	
	//assignmentExpression node syntax:
	//(i) module.exports = identifier | object | exports = {}
	
	var assignmentNodeParent = assignmentExpressionNode.parentPath;
	var parentNodeValue;
	var parentNodeType;
	var leftOperand;
	var identifierName;
	var explicitGlobal;
	
	var exportedElements = [];
	while(assignmentNodeParent !== null) {
		
		parentNodeValue = assignmentNodeParent.value;
		parentNodeType = parentNodeValue.type;
		if(parentNodeType === 'VariableDeclarator') {
			
			//parentNode is a VariableDeclarator:
			//exportStatement is assigned to a variable
			identifierName = parentNodeValue.id.name;
//			console.log(parentNodeValue);
			
//			console.log(sourceFile.fileName);
//			console.log(assignmentNodeParent);
//			console.log(assignmentNodeParent.value.type);
			
			explicitGlobal = sourceFile.retrieveExplicitGlobal(identifierName);
			if(explicitGlobal !== null) {
				
				explicitGlobal.updateIsExported(true);
				explicitGlobal.updateExportedVariableNode(assignmentNodeParent.value);
				exportedElements.push(explicitGlobal);
			}
			break;
		}
		else if(parentNodeType === 'AssignmentExpression') {
			
			//parentNode of assignmentExpression is an AssignmentExpression
			//case: exportStatement is assigned to an identifier or a member expression
//			console.log(parentNodeValue);
			leftOperand = parentNodeValue.left;
			if(leftOperand.type === 'Identifier') {
				
				//exportStatement is assigned to an identifier
				identifierName = leftOperand.name;
				exportedElements.push(identifierName);
				
				explicitGlobal = sourceFile.retrieveExplicitGlobal(identifierName);
				if(explicitGlobal !== null) {
					
					explicitGlobal.updateIsExported(true);
					explicitGlobal.updateExportedVariableNode(assignmentNodeParent.node.value);
					exportedElements.push(explicitGlobal);
					
					//proceed to the next identifier (if exists)
					continue;
				}
				
				var definedFunction = sourceFile.retrieveTopLevelScopeFunctionByName(identifierName);
				if(definedFunction !== null) {
					
					//elementName is the top-level defined function represented by definedFunction
					//update definedFunction and proceed to the next exportedElement
					definedFunction.updateIsExported(true);
					definedFunction.updateExportedFunctionNode(assignmentNodeParent.node.value);
					exportedElements.push(definedFunction);
//					console.log(definedFunction);
					
					//proceed to the next identifier (if exists)
					continue;
					
				}
			}
		}
		assignmentNodeParent = assignmentNodeParent.parentPath;
		
	}
	
	return exportedElements;
}

/**
 * Retrieves the imported elements (variables, functions and anonymus object expressions) of a commonJS module,
 * along with the set of the uses of each element.
 * @param sourceFile
 * @param sourceFiles the input file hash map
 * @returns
 */
function retrieveImportedElementsOfCommonJSModule(sourceFiles, sourceFile) {
	
	//find imported elements in commonJS module
	//(i) find commonJS imports (calls to require())
	//(ii) require(<filename>).<exportedElement> (if exportedElement does not exist, all exported elements of filename are imported)
	//(iii) check if exportedElement is an element defined in the top-level scope of filename
	
	//(i) get commonJS imports (calls to require())
	let requireCalls = getImportStatementsOfCommonJSModule(sourceFile);

	if(requireCalls.length === 0) {

		return;
	}
	
	let importedVariables = [];
	let importedFunctions = [];

	let importedNamespaces = [];
	let importedNamespace;
	let importedModules = [];
	let requireCall;

	//all definitions (variables/functions/modules) imported in sourceFile
	//keeps track of the order of require invocations
	let importedElements = [];

	let hrstart = process.hrtime();

	//write require calls that are nested in inner scopes in a json file
	writeNestedStatementsToJSONFile(sourceFile, requireCalls, sourceFiles);

	let hrend = process.hrtime(hrstart);
	
	// console.log(requireCalls.length);

	// console.log('s: ' + sourceFile.fileName);
	// console.log(requireCalls.length);
	for(let callIndex = 0; callIndex < requireCalls.length; callIndex++) {

		requireCall = requireCalls[callIndex];
		
		//exportedElement: find parentPath of requireCall 
		//(and, then, find property of memberExpression node, if exists)
		let parentNode = requireCall.parentPath;
		let parentNodeType = parentNode.value.type;

		let importedSource = requireCall.value.arguments[0];
		
		// console.log(requireCall.value.loc);
		// console.log(importedSource);

		//retrieve the element that is assigned the result of require()
		//along with the referenced module from the input file hashmap
		//the actual name of the namespace cannot be resolved,
		//before its mapping to the definitions of the imported feature
		let {importFile, aliasName} = retrieveImportedModuleAndElementAssignedWithRequireCall(sourceFiles, sourceFile, requireCall);

		// console.log(aliasName);
		// console.log(importFile === null ? null : importFile.fileName);

		//importFile is locally defined but it is not a JS file
		//proceed to the next require() invocation
		if(importedSource.value.startsWith('.') === true &&
			(importFile === null ||
			importFile.fileName.endsWith('.js') === false)) {

			continue;
		}

		// console.log(aliasName)
		let accessedPropertyName;
		let importedElement;
		let namespaceName;

		let impFeatPropOfFeatAssignedWithModObj = importFile == null ? 
													false :
													(importFile.statementsReferencingExportObject === null ?
													 false :
													 (importFile.statementsReferencingExportObject.length > 0 ?
													 true :
													 false));
		
		if(parentNodeType === 'VariableDeclarator' ||
		   parentNodeType === 'CallExpression' ||
		   parentNodeType === 'ReturnStatement' ||
		   parentNodeType === 'Property') {
			
			//parentNode of requireCall is a: 
			//(a) VariableDeclarator, (b) CallExpression, (c) ReturnStatement, (d) Property
			//after the requireCall, there exists no access to a property-
			//the property accessed corresponds to the variable/function/object 
			//assigned to the export object and its properties (if any)
			if(importFile === null) {
				
				//importFile not found in the input file hash map (an external npm package)
				//namespaceName depends on the module's name
				namespaceName = importedSource.value.replace(/.\/-/g, '');
				namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
				// namespaceName = importedSource.value.startsWith('.') === true ? namespaceName + 'js' : namespaceName;
			}
			else {

				namespaceName = path.basename(importFile.fileName, '.js');
				namespaceName = namespaceName.replace(/.\//g, '');
				namespaceName = namespaceName.replace(/-/g, '');
				namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
				namespaceName = namespaceName + 'js';
			}

			//the result of require() is: (i) an object containing all the properties exported through binding to the export object
			//							  (ii) the definition that is exported through assignment to the export object
			importedNamespace = new ImportedNamespace.ImportedNamespace(namespaceName, importedSource.value);
			importedNamespace.aliasName = aliasName;

			importedNamespace.updateImportedElementNodes(requireCall);

			//UPDATE: keeping the type of the imported definition(s) does not suffice for assessing statistics:
			//I actually need to map the imported namespace to the definition
			//retrieve the exported definitions of importFile
			let exportedObject = importFile !== null ? importFile.retrieveExportedDefinitionsOfModule() : {};

			// console.log(exportedObject)
			//map imported namespace with the exported definitions of importFile
			//for statistics assessment (from imported namespace, 
			//retrieve the actual module definitions that are imported)
			importedNamespace.updateModuleDefinitions(exportedObject);

			//update importedNamespace with the fact that it's mapped to properties
			//that are part of a feature assigned with the module object
			importedNamespace.updateIsImportedElementBoundToFeatureAssignedWithModuleObject(impFeatPropOfFeatAssignedWithModObj);

			//what if a module is required multiple times in module?
			//insert importedNamespace if array, if it is not inserted yet (parse.js, cheerio)
			let existingNamespace = importedNamespaces.find(impNamespace => {

				return impNamespace.compare(importedNamespace) === true;
			});

			// console.log(existingNamespace);

			//importedNamespace not introduced in the module's imported namespaces yet
			//importedNamespace is not already inserted in importedNamespaces array
			//insert importedNamespace in array
			if(existingNamespace == null) {

				importedNamespaces.push(importedNamespace);
				importedElements.push(importedNamespace);

				//proceed to the next require invokation
				continue;
			}

			//importedNamespace already resolved
			//case: importedNamespace required multiple times in module
			//only update the existing namespace's import nodes
			existingNamespace.updateImportedElementNodes(requireCall);

			//proceed to the next require invocation
			continue;

		}
		
		if(parentNodeType === 'MemberExpression') {
			
			//parentNode of requireCall is a MemberExpression:
			//after the requireCall, there exists an access to
			//an exported property of importedSource
			//retrieve accessed property
			//syntax: require(<moduleName>).[<elementName>]
			//recall: (i) exported variables/functions: definitions assigned to the export object
			//(ii) exported properties: definitions bound to the export object
			accessedPropertyName = parentNode.value.property.name;

			if(importFile === null) {
				
				//importFile not found in the input file hash map (an external npm package)
				//namespaceName depends on the module's name
				namespaceName = importedSource.value.replace(/.\/-/g, '');
				namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
				// namespaceName = importedSource.value.startsWith('.') === true ? namespaceName + 'js' : namespaceName;
			}
			else {

				namespaceName = path.basename(importFile.fileName, '.js');
				namespaceName = namespaceName.replace(/.\//g, '');
				namespaceName = namespaceName.replace(/-/g, '');
				namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
				namespaceName = namespaceName + 'js';
			}

			//create a namespace in order to insert an ES6 default import referencing an external library
			importedNamespace = new ImportedNamespace.ImportedNamespace(namespaceName, importedSource.value);
			importedNamespace.aliasName = aliasName;
			importedNamespace.updateImportedElementNodes(requireCall);

			if(importFile !== null) {

				//importFile located in the analyzed system
				//map importedNamespace with the exported definitions of importFile
				//retrieve the exported definitions of importFile
				let exportedObject = importFile.retrieveExportedDefinitionsOfModule();

				//map imported namespace with the exported definitions of importFile
				//for statistics assessment (from imported namespace, 
				//retrieve the actual module definitions that are imported)
				importedNamespace.updateModuleDefinitions(exportedObject);
			}

			//update importedNamespace with the fact that it's mapped to properties
			//that are part of a feature assigned with the module object
			importedNamespace.updateIsImportedElementBoundToFeatureAssignedWithModuleObject(impFeatPropOfFeatAssignedWithModObj);
			
			//what if a module is required multiple times in module?
			//insert importedNamespace if array, if it is not inserted yet (parse.js, cheerio)
			let existingNamespace = importedNamespaces.find(impNamespace => {

				return impNamespace.compare(importedNamespace) === true;
			});

			//importedNamespace not introduced in the module's imported namespaces yet
			//importedNamespace is not already inserted in importedNamespaces array
			//insert importedNamespace in array
			if(existingNamespace == null) {

				importedNamespaces.push(importedNamespace);
				importedElements.push(importedNamespace);

				//proceed to the next require() invokation
				continue;
			}

			//importedNamespace already resolved
			//case: importedNamespace required multiple times in module
			//only update the existing namespace's import nodes
			existingNamespace.updateImportedElementNodes(requireCall);

			continue;

		}
		
		if(parentNodeType === 'ExpressionStatement') {

			//parentNodeType is an expression statement (syntax: require(<modulePath>);)
			//introduce an imported module
			importedElement = new ImportedModule.ImportedModule(null, importedSource.value);
			importedElement.updateImportedElementNodes(requireCall);
			importedModules.push(importedElement);
			importedElements.push(importedElement);

			//proceed to the next require invocation
			continue;
		}

		if(importFile === null) {
				
			//importFile not found in the input file hash map (an external npm package)
			//namespaceName depends on the module's name
			namespaceName = importedSource.value.replace(/.\/-/g, '');
			namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
			// namespaceName = importedSource.value.startsWith('.') === true ? namespaceName + 'js' : namespaceName;
		}
		else {

			namespaceName = path.basename(importFile.fileName, '.js');
			namespaceName = namespaceName.replace(/.\//g, '');
			namespaceName = namespaceName.replace(/-/g, '');
			namespaceName = namespaceName.replace(/[^\w\s]/gi, '');
			namespaceName = namespaceName + 'js';
		}

		//requireCall's parent not a statement of the types above - create a namespace
		importedNamespace = new ImportedNamespace.ImportedNamespace(namespaceName, importedSource.value);
		// importedNamespace = new ImportedNamespace.ImportedNamespace(aliasName, importedSource);
		importedNamespace.aliasName = aliasName;
		importedNamespace.updateImportedElementNodes(requireCall);
		if(importFile !== null) {

			//UPDATE: keeping the type of the imported definition(s) does not suffice for assessing statistics:
			//I actually need to map the imported namespace to the definition
			//retrieve the exported definitions of importFile
			let exportedObject = importFile.retrieveExportedDefinitionsOfModule();

			//map imported namespace with the exported definitions of importFile
			//for statistics assessment (from imported namespace, 
			//retrieve the actual module definitions that are imported)
			importedNamespace.updateModuleDefinitions(exportedObject);
		}

		//update importedNamespace with the fact that it's mapped to properties
		//that are part of a feature assigned with the module object
		importedNamespace.updateIsImportedElementBoundToFeatureAssignedWithModuleObject(impFeatPropOfFeatAssignedWithModObj);
		
		//what if a module is required multiple times in module?
		//insert importedNamespace if array, if it is not inserted yet (parse.js, cheerio)
		let existingNamespace = importedNamespaces.find(impNamespace => {

			return impNamespace.compare(importedNamespace) === true;
		});

		//importedNamespace not introduced in the module's imported namespaces yet
		//importedNamespace is not already inserted in importedNamespaces array
		//insert importedNamespace in array
		if(existingNamespace == null) {

			importedNamespaces.push(importedNamespace);

			importedElements.push(importedNamespace);

			//proceed to the next require() invokation
			continue;
		}

		//importedNamespace already resolved
		//case: importedNamespace required multiple times in module
		//only update the existing namespace's import nodes
		existingNamespace.updateImportedElementNodes(requireCall);

		continue;
	}

	// importedNamespaces.map(impNam => {

	// 	console.log(impNam.elementName);
	// 	impNam.importedElementNodes.map(impNode => {

	// 		console.log(impNode.value.loc);
	// 	})
	// })

	//after having retreived sourceFile's imported elements (variables, functions, namespaces, modules)
	//determine whether they are imported in nested scopes
	//needed to determine whether they're going to be imported,
	//regardless of their references
	importedElements.forEach(importedElement => {

		importedElement.updateIsNested();
	});
	
	//update imported variables of sourceFile
	sourceFile.updateImportedVariables(importedVariables);
	
	//update imported functions of sourceFile
	sourceFile.updateImportedFunctions(importedFunctions);

	//update imported namespaces (modules) of sourceFile
	sourceFile.updateImportedNamespaces(importedNamespaces);

	//update imported classes of sourceFile
	// sourceFile.updateImportedClasses(importedClasses);

	//update import modules of sourceFile
	sourceFile.updateImportedModules(importedModules);

	//update imported element list of sourceFile (keep sequential order of import statements)
	sourceFile.updateImportedElements(importedElements);

	//retrieve identifiers representing usages of global (imported) variables in sourceFile
	retrieveUsedGlobalIdentifiersInSourceFile(sourceFile);

	//update the sourceFile's imported elements (variables, functions, modules) with
	//the fact that their values are 
	//(a) bound/assigned to an exported definition, (b) bound/assigned to the export object
	//needed for determining whether these definitions are imported after refactoring,
	//regardless of their usage
	sourceFile.updateImportedElementsBoundOrAssignedToExportedDefinitions();

	//right after retrieving imported elements and their usages,
	//are these elements iterated in the modules they're imported?
	sourceFile.updateObjectReferencedImportedDefinitions();

	//used for debugging purposes (moved to metric utilities for generic use)
	// console.log(sourceFile.fileName);
	// sourceFile.dumpImportedDefinitionsOfSourceFileToFile(sourceFiles);
}

/**
 * Returns the name of the element that is assigned with an invocation of require(),
 * along with the referenced module from the input file hashmap.
 * @param {*} sourceFiles: the input file hashmap.
 * @param {*} sourceFile: the CommonJS module containing the invocation of require().
 * @param {*} requireCall: the invocation of require().
 */
function retrieveImportedModuleAndElementAssignedWithRequireCall(sourceFiles, sourceFile, requireCall) {

	let importFile = null;
	let aliasName = null;
	let requireCallLoc = requireCall.value.loc;

	//(a) retrieve the name of the element that is assigned with the result of require()
	//retrieve the statements containing requireCall (statements that contain requireCall in the ASTs)
	//(maybe I should optimize this segment to use closest() to run faster-
	//traverse the AST upwards, instead of searching the whole AST iteratively)
	//find the closest statement surrounding require() invocation
	let statementCollection = jscodeshift(requireCall).closest(jscodeshift.Statement);

	// let statementCollection = sourceFile.astRootCollection.find(jscodeshift.Statement).filter(stmt => {

	// 	if(stmt.value.type !== 'VariableDeclaration' && stmt.value.type !== 'AssignmentExpression') {

	// 		return false;
	// 	}

	// 	// console.log(stmt);
	// 	let requireCallCollection = jscodeshift(stmt).find(jscodeshift.CallExpression).filter(callExp => {

	// 		let callExpLoc = callExp.value.loc;
	// 		return callExpLoc.start.line === requireCallLoc.start.line && callExpLoc.start.column === requireCallLoc.start.column &&
	// 				callExpLoc.end.line === requireCallLoc.end.line && callExpLoc.end.column === requireCallLoc.end.column;
	// 	});

	// 	if(requireCallCollection.length > 0) {

	// 		return true;
	// 	}

	// 	return false;
	// });

	if(statementCollection.length > 0) {

		let requireCallSurroundingStmt = statementCollection.at(0).get();
		// console.log(requireCallSurroundingStmt);
		// console.log(requireCallSurroundingStmt.value.loc);

		if(requireCallSurroundingStmt.value.type === 'VariableDeclaration') {

			//requireCall located within a variable declaration
			//find the declaration that is initialized with requireCall 
			//or its initialization value contains requireCall (for require() invocations located in member expressions)
			//the name of the element that is assigned requireCall
			//a variable declaration might have a set of declarations
			let declarationInitializedWithRequireCall = requireCallSurroundingStmt.value.declarations.find(declaration => {

				//return only the variable that is either
				//(a) initialized with requireCall
				//(b) is initialized with an assignment containing requireCall (in the case that aliases are used)
				return declaration.init !== null && 
						(declaration.init === requireCall.value ||
						jscodeshift(declaration.init).find(jscodeshift.CallExpression).filter(callExp => {

							return callExp.value === requireCall.value;

						}).length > 0);
			});

			// console.log(declarationInitializedWithRequireCall);
			if(declarationInitializedWithRequireCall != null) {

				// let declarationInitializedWithRequireCall = declarationsInitializedWithRequireCall[0];
				if(declarationInitializedWithRequireCall.id.type === 'Identifier') {

					// console.log(declarationInitializedWithRequireCall);
					aliasName = declarationInitializedWithRequireCall.id.name;
				}
			}
		}
		else if(requireCallSurroundingStmt.value.type === 'ExpressionStatement' &&
				requireCallSurroundingStmt.value.expression.type === 'AssignmentExpression' &&
				requireCallSurroundingStmt.value.expression.left.type === 'Identifier') {

			//requireCall located within an assignment expression
			//find the left operand of the assigment (identifier)
			aliasName = requireCallSurroundingStmt.value.expression.left.name;

			// if(requireCallSurroundingStmt.value.expression.left.type === 'Identifier') {

			// 	aliasName = requireCallSurroundingStmt.value.expression.left.name;
			// }
		}
	}

	//(b) filename: first argument of require()
	// console.log(requireCall.value.arguments);
	let importedSource = requireCall.value.arguments[0];

	//aliasName not found (requireCall not located on a variable declaration
	//or an assignment expression)
	if(aliasName === null) {

		aliasName = path.basename(importedSource.value, '.js');
		aliasName = aliasName.replace(/[^\w\s]/gi, '')
		aliasName = (importedSource.value.startsWith('.') === true ? aliasName + 'js': aliasName);
	}

	//retrieve the imported module from the input file hashmap
	if(importedSource.value.startsWith('.') === true) {

		//importedSource contains a local path - search file in inputFiles list
		//case (commander.js): specifiedModulePath different from that specified by the IDE
		let specifiedModulePath = path.resolve(path.dirname(sourceFile.fileName) + path.sep + importedSource.value);

		//retrieve sourceFile
		importFile = fileUtilities.retrieveModuleInList(sourceFiles, specifiedModulePath);

		if((importFile === null && importedSource.value.includes('.') === true) ||
			importFile === sourceFile) {

			//imported source references a locally defined module, 
			//but the referenced module does not exist
			//or importFile is the same sourceFile
			return {

				'importFile' : importFile,
				'aliasName' : aliasName
			};
		}
	}
	else {

		//importedSource contains either the name of an external package
		importFile = null;
	}

	return {

		'importFile' : importFile,
		'aliasName' : aliasName
	};
}

/**
* Retrieves export statements of sourceFile.
*/
function getExportStatementsOfCommonJSModule(sourceFile, sourceFiles) {

	let isPreconditionViolated = false;
	let isInnerStatement = false;

	/**
	  a CommonJS module contains either:
	(a) an assignment referencing the export object
	(b) a module variable initialized with the export object
	(c) bindings to the export object
	(d) a mix of (a)/(b) and (c)
	(d) none of the above

	*/
	
	//(1) find assignments of exports/module.exports (a)
	let assignmentsOfExportObject = retrieveAssignmentOfExportObject(sourceFile);

	//(2) find variables initialized with exports/module.exports 
	//(in the case that module does not have an assignment of exports/module.exports) (b)
	let variableInitializedWithExportObject = retrieveVariableInitializedWithExportObject(sourceFile);

	//statements containing references (not bindings) to the export object
	let statementsReferencingExportObject = (assignmentsOfExportObject.length !== 0 ? assignmentsOfExportObject : (variableInitializedWithExportObject !== null ? [variableInitializedWithExportObject.variableDeclarationNode] : []));
	sourceFile.updateStatementsReferencingExportObject(statementsReferencingExportObject);

	//(3) find assignments to export object bindings (c)
	let assignmentsToExportObjectBindings = retrieveAssignmentsToExportObjectBindings(sourceFile);
	sourceFile.updateAssignmentsToExportObjectBindings(assignmentsToExportObjectBindings);
}

/**
 * Retrives the assignments to export object bindings in sourceFile.
 * Returns these statements.
 * @param {*} sourceFile 
 */
function retrieveAssignmentsToExportObjectBindings(sourceFile) {

	// console.log(sourceFile.fileName);
	let assignmentToExportObjectBindingsCollection = sourceFile.astRootCollection.find(jscodeshift.AssignmentExpression).filter(path => {

		let leftOperand = path.value.left;
		if((leftOperand.type === 'Identifier' && leftOperand.name === 'exports') || 
		   (leftOperand.type === 'MemberExpression' && 
			leftOperand.object.type === 'Identifier' && leftOperand.object.name === 'module' &&
			leftOperand.property.type === 'Identifier' && leftOperand.property.name === 'exports')) {

			//do not consider assignments to export object
			return false;
		}

		//generate an AST of the assignment's left operand and search for export object references within it
		let leftOperandAST = jscodeshift(leftOperand);

		// console.log(leftOperand);

		//search for references to exports (or module.exports, the same query)
		let exportsObjectReferences = leftOperandAST.find(jscodeshift.Identifier).filter(path => {

			return path.value.name === 'exports';
		});

		// console.log(exportsObjectReferences.length);

		if(exportsObjectReferences.length > 0) {

			return true;
		}

		//search for references to module.exports
		// let moduleExportsObjectReferences = leftOperandAST.find(jscodeshift.MemberExpression).filter(path => {

		// 	return path.value.object.type === 'Identifier' && path.value.object.name === 'module' &&
		// 		   path.value.property.type === 'Identifier' && path.value.property.name === 'exports';
		// });

		// console.log(moduleExportsObjectReferences.length);

		// if(moduleExportsObjectReferences.length > 0) {

		// 	return true;
		// }

		return false;
	});

	if(assignmentToExportObjectBindingsCollection.length === 0) {

		return [];
	}

	let assignmentsToExportObjectBindings = [];
	assignmentToExportObjectBindingsCollection.forEach(assignmentToExportObjectBinding => {

		assignmentsToExportObjectBindings.push(assignmentToExportObjectBinding);
	});

	return assignmentsToExportObjectBindings;
}

/**
 * Write statements that are nested in inner scopes in a JSON file 
 * (refactoring of these statements leads to the violation of refactoring preconditions)
 * (for demonstration reasons)
 * @param {*} statementNodes the file's nested imports
 * @param {*} sourceFile the module having nested imports
 * @param {*} inputFiles the input file hash map
 */
function writeNestedStatementsToJSONFile(sourceFile, statementNodes, inputFiles) {

	// let jsonFilePath = './resultFiles/nestedStatements.json';

	//write the nested statements of sourceFile to a new json file (1-1 mapping)
	let filePath = sourceFile.fileName.replace(/\\/g, '_');
	let jsonFilePath = `./resultFiles/${filePath.replace(/:/g, '')}_nestedStatements.json`;
	let innerStatements = [];

	if(statementNodes.length === 0) {

		console.log(`File ${sourceFile.fileName} has no nested statements. Resuming to imported feature retrieval.`);
		return false;
	}

	//don't write on existent file
	if(fs.existsSync(jsonFilePath) === true) {

		console.log(`File ${jsonFilePath} exists. Resuming to imported feature retrieval.`);
		return false;
	}

	statementNodes.forEach(statementNode => {

		//is statement nested in an inner scope?
		//if yes, the precondition is violated after the refactoring
		if(isStatementNestedInInnerBlock(statementNode) === true) {

			//minimize node before writing to file
			innerStatements.push(util.minimizeNode(statementNode));

			// if(isInnerStatementViolatingPrecondition(inputFiles, sourceFile, statementNode) === true) {

			// 	innerStatements.push(statementNode.value);
			// }
			
		}
	});

	if(innerStatements.length === 0) {

		console.log(`File ${sourceFile.fileName} has no nested statements. Resuming to imported feature retrieval.`);
		return false;
	}
	
	let jsonObjectArray = [];
	let jsonFileObject = {

		fileName: sourceFile.fileName,
		innerStatements: []
	};

	jsonObjectArray.push(jsonFileObject);

	innerStatements.forEach(innerStatement => {

		//append innerStatement to the json object
		jsonFileObject['innerStatements'].push(innerStatement);
	});

	console.log(`Writing nested statements to ${jsonFilePath}.`);

	//write JSON object to file
	fs.writeFileSync(jsonFilePath, JSON.stringify(jsonObjectArray, null, 4), 'utf-8');

	return true;
}


// /**
//  * Write statements that are nested in inner scopes in a JSON file 
//  * (refactoring of these statements leads to the violation of refactoring preconditions)
//  * (for demonstration reasons)
//  * @param {*} statementNodes the file's nested imports
//  * @param {*} sourceFile the module having nested imports
//  * @param {*} inputFiles the input file hash map
//  */
// function writeNestedStatementsToJSONFile(sourceFile, statementNodes, inputFiles) {

// 	var jsonFilePath = './resultFiles/nestedStatements.json';
// 	var jsonFileContent;
// 	var jsonObjectArray;
// 	var jsonFileObjectArray = [];
// 	var jsonFileObject;
// 	var innerStatements = [];

// 	statementNodes.forEach(function(statementNode) {

// 		//is statement nested in an inner scope?
// 		//if yes, the precondition is violated after the refactoring
// 		if(isStatementNestedInInnerBlock(statementNode) === true) {

// 			if(isInnerStatementViolatingPrecondition(inputFiles, sourceFile, statementNode) === true) {

// 				innerStatements.push(statementNode.value);
// 			}
			
// 		}
// 	});

// 	if(fs.existsSync(jsonFilePath) === true) {

// 		jsonFileContent = fs.readFileSync(jsonFilePath, 'utf-8');
// 		jsonObjectArray = JSON.parse(jsonFileContent);

// 		jsonFileObjectArray = jsonObjectArray.filter(function(value) {

// 			return value["fileName"].localeCompare(sourceFile.fileName) === 0;
// 		});

// 		if(jsonFileObjectArray.length === 0) {

// 			jsonFileObject = {

// 				fileName: sourceFile.fileName,
// 				innerStatements: []
// 			};
// 			jsonObjectArray.push(jsonFileObject);
// 		}
// 		else {

// 			jsonFileObject = jsonFileObjectArray[0];
// 		}
// 	}
// 	else {

// 		jsonObjectArray = [];
// 		jsonFileObject = {

// 			fileName: sourceFile.fileName,
// 			innerStatements: []
// 		};
// 		jsonObjectArray.push(jsonFileObject);
// 	}

// 	innerStatements.forEach(function(innerStatement) {

// 		//append innerStatement to the json object
// 		jsonFileObject['innerStatements'].push(innerStatement);
// 	});

// 	//write JSON object to file
// 	fs.writeFileSync(jsonFilePath, JSON.stringify(jsonObjectArray, null, 4), 'utf-8');
// }

/**
 * Determines whether a nested call site of require() may affect the program's external
 * behaviour, when refactored.
 * @param {*} sourceFiles 
 * @param {*} inputFile 
 * @param {*} statementNode 
 */
function isInnerStatementViolatingPrecondition(sourceFiles, inputFile, statementNode) {

	// console.log(statementNode.value);

	let callee;
	let callExpressionArguments;
	let callExpressionArg;
	let importedFile;
	let specifiedModulePath;
	let importFile;
	let definedFunctions;
	let definedFunction;
	let functionNode;
	let functionBody;
	let blockStatementBody;
	let statement;
	let stmtExpression;

	if(statementNode.value.type !== 'CallExpression') {

		//nested statement that is not a call expression (a nested export statement)
		return false;
	}

	// console.log(inputFile.fileName);

	callee = statementNode.value.callee;
	if(callee.type === 'Identifier' && callee.name === 'require') {

		//nested statement is a call site of require()
		callExpressionArguments = statementNode.value.arguments;
		if(callExpressionArguments.length > 0) {

			//call site of require() has parameters
			callExpressionArg = callExpressionArguments[0];
			if(callExpressionArg.type === 'Literal') {

				// console.log(callExpressionArg);

				//path to the imported file is the first parameter 
				//(transform only call sites of require() that reference a file with a literal)
				importedFile = callExpressionArg.value;

				//specify absolute path of the imported file by inputFile's directory and the relative path to the imported file
				specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedFile);

				//retrieve the source file specified by importedFile in the source files' list
				importFile = fileUtilities.retrieveModuleInList(sourceFiles, specifiedModulePath);
				if(importFile !== null) {

					definedFunctions = importFile.definedFunctions;

					if(definedFunctions.length === 0) {

						//no functions defined (maybe an IIFE)
						return;
					}

					//retrieve the function 'topLevelScope'
					//(the artificial function that models the module's top-level scope code)
					definedFunction = definedFunctions[0];

					//retrieve the AST node of definedFunction
					functionNode = definedFunction.functionNode;

					// console.log(importFile.fileName);
					// console.log(functionNode.value.body);

					//retrieve the statements within function modelling the top-level scope of importFile
					functionBody = functionNode.value.body;
					if(functionBody.type === 'BlockStatement') {

						blockStatementBody = functionBody.body;

						/**
						 * NOT a precondition:
						 * (i)  assignment of function definition (expression/declaration) to exports/module.exports
						 * (ii) assignment of require to a variable (assignment/variable definition)
						 */

						//iterate over the statements of function
						//if a statement representing an assignment of a value different to a function definition/expression
						//is met, maybe a precondition (?)
						for(let statementIndex = 0; statementIndex < blockStatementBody.length; statementIndex++) {

							statement = blockStatementBody[statementIndex];
							// console.log(statement);
							if(statement.type === 'ExpressionStatement') {

								stmtExpression = statement.expression;

								// console.log(stmtExpression);
								if(doesStatementContainAComputableObject(stmtExpression) === true) {

									// console.log(stmtExpression);

									//importFile contains 1 statement that contains a computable object
									//the transferring of the CommonJS import statement at the module's top-level
									//scope may affect the program's external behaviour 
									//(this statement is violating the 3rd refactoring precondition)
									return true;
								}
							}
							else if(statement.type === 'VariableDeclaration') {

								// console.log(stmtExpression);
								if(doesStatementContainAComputableObject(statement) === true) {

									// console.log(statement);

									//importFile contains 1 statement that contains a computable object
									//the transferring of the CommonJS import statement at the module's top-level
									//scope may affect the program's external behaviour 
									//(this statement is violating the 3rd refactoring precondition)
									return true;
								}
							}
						}
					}
				}

			}
			
		}
	}

	return false;
}

/**
 * Finds if the statement specified by statementNode is either an export statement
 * regarding of a function definition (declaration/expression).
 * @param {*} statementNode 
 */
function doesStatementContainAComputableObject(statementNode) {

	let declarations;
	let declaration;
	let initialValueNode;
	let leftOperand;
	let rightOperand;

	if(statementNode.type === 'AssignmentExpression') {

		leftOperand = statementNode.left;
		rightOperand = statementNode.right;
		
		if(doNodesConstituteAnExportStatement(leftOperand, rightOperand) === true) {

			//export statement with syntax:
			//(i) exports[.<identifier>] = [module.exports] = <object>
			//(ii) module.exports[.<identifier>] = [exports] = <object>
			while(rightOperand.type === 'AssignmentExpression') {

				rightOperand = rightOperand.right;
			}

			if(rightOperand.type !== 'FunctionDeclaration' && 
			   rightOperand.type !== 'FunctionExpression' && 
			   rightOperand.type !== 'Identifier' &&
			   rightOperand.type !== 'Literal' &&
			   rightOperand.type !== 'MemberExpression') {

				//exported element is computable (i.e. a callExpression)
				return true;
			}

			// console.log(rightOperand);
			return false;
		}
		else if(doNodesConstituteAnExportStatement(rightOperand, leftOperand) === true) {

			//export statement with syntax:
			//(i) <object> = exports[.<identifier>] = [module.exports]
			//(ii) <object> = module.exports[.<identifier>] = [exports]
			return false;
		}
		else if(rightOperand.type === 'CallExpression' && rightOperand.callee.type == 'Identifier' && rightOperand.callee.name === 'require') {

			//statement with syntax: <leftOperand> = require(<module>)
			//(we don't search for transitive precondition violations)
			return false;
		}
	}
	else if(statementNode.type === 'Literal') {

		return false;
	}
	else if(statementNode.type === 'VariableDeclaration') {

		declarations = statementNode.declarations;
		for(let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

			declaration = declarations[declarationIndex];
			initialValueNode = declaration.init;
			if(initialValueNode !== null && initialValueNode.type === 'CallExpression' && 
			   initialValueNode.callee.type === 'Identifier' && initialValueNode.callee.name === 'require') {

				//statement with syntax: var/const <variableName> = require(<module>)
				//(we don't search for transitive precondition violations)
				return false;
			}
			// console.log(initialValueNode);
		}
	}
	return true;
}

/**
 * Finds if the statements specified by leftOperand, rightOperand constitute
 * a CommonJS export statement.
 * @param {*} leftOperand 
 * @param {*} rightOperand 
 */
function doNodesConstituteAnExportStatement(leftOperand, rightOperand) {

	let memberExpression = null;
	while(leftOperand.type === 'MemberExpression') {

		memberExpression = leftOperand;
		leftOperand = leftOperand.object;
	}

	if(memberExpression === null) {

		return false;
	}

	// console.log(memberExpression.object);
	if(memberExpression.object.type === 'Identifier' && (memberExpression.object.name === 'exports' || memberExpression.object.name === 'module')) {

		//statementNode represents a statement of syntax:
		//(i) exports[.<identifier>] = [module.exports] = <object>
		//(ii) module.exports[.<identifier>] = [exports] = <object>
		return true;
	}

	return false;
}

/**
 * Determines whether statement specified by statementNode is nested in an inner scope
 * (used in cases that imports/exports are nested in inner scopes -> the application of the refactoring violates preconditions).
 * @param {*} statementNode the ast node modelling a statement
 */
function isStatementNestedInInnerBlock(statementNode) {

	if(statementNode.scope.isGlobal === false) {

		//statement inside function definition
		return true;
	}

	let surrBlockStmts = jscodeshift(statementNode).closest(jscodeshift.BlockStatement);

	//statement is contained in a block
	if(surrBlockStmts.length > 0) {

		return true;
	}

	//statement is not contained in a block, it is located in the top-level scope
	return false;

	// let parentNode = statementNode.parentPath;
	// while(parentNode !== null) {

	// 	if(parentNode.value.type === 'BlockStatement') {

	// 		//statement contained in a block statement
	// 		return true;
	// 	}

	// 	parentNode = parentNode.parentPath;
	// }

	// //statement is not contained in a block, it is located in the top-level scope
	// return false;
}

/**
 * Search for export statement, where module.exports is assigned to a variable.
 */
function retrieveAssignmentsOfModuleExports(sourceFile) {

	//case: a variable may be exported when module.exports is assigned to it
	//retrieve variable declarations (case: user, user.js, generator)
	var variableDeclarationCollection = sourceFile.astRootCollection.find(jscodeshift.VariableDeclaration);
	var declarations;
	var declaration;
	var initValueNode;
	var declarationIndex;
	var accessedObject;
	var accessedProperty;
	var moduleExportsStatements = [];

	// console.log(sourceFile.fileName);
	variableDeclarationCollection.forEach(function(variableDeclaration) {

		// console.log(variableDeclaration);

		//get array of the variables that are initialized within variableDeclaration
		declarations = variableDeclaration.value.declarations;
		for(declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

			declaration = declarations[declarationIndex];

			//get AST node representing initialization value of declaration
			initValueNode = declaration.init;

			//is initValueNode a MemberExpression?
			if(initValueNode !== null && initValueNode.type === 'MemberExpression') {

				accessedObject = initValueNode.object;
				accessedProperty = initValueNode.property;

				//is module.exports assigned to a variable? 
				//(if yes, variableDeclaration should be included in moduleExportsStatements, too)
				if(accessedObject.name === 'module' && accessedProperty.name === 'exports') {

					//export statement syntax: var/const <identifier> = module.exports
					moduleExportsStatements.push(variableDeclaration);
				}
			}
		}

	});

	return moduleExportsStatements;
}

/**
 * Searches the sourceFile's module variable that is initialized with exports/module.exports.
 * Returns the variable if exists, otherwise null.
 */
function retrieveVariableInitializedWithExportObject(sourceFile) {

	let variablesWithInitializationValue = sourceFile.explicitGlobals.filter(explicitGlobal => {

		return explicitGlobal.initializationValueNode !== null;
	});

	//case: a variable may be exported when module.exports/exports is assigned to it
	// console.log(sourceFile.fileName);
	let explicitGlobalsInitializedWithExportObject = variablesWithInitializationValue.filter(explicitGlobal => {

		// console.log(explicitGlobal.initializationValueNode);

		let initializationValueNode = explicitGlobal.initializationValueNode;
		if((initializationValueNode.type === 'Identifier' && initializationValueNode.name === 'exports') ||
			(initializationValueNode.type === 'MemberExpression' && 
			 initializationValueNode.object.type === 'Identifier' && initializationValueNode.object.name === 'module' &&
			 initializationValueNode.property.type === 'Identifier' && initializationValueNode.property.name === 'exports')) {

			//variable initialized with the export object
			return true;
		}

		//also consider initialization values that are assignment expressions including an export onbject reference
		//generate an AST of explicitGlobal's initialization value and search for exports/module.exports references within it
		let initializationValueAST = jscodeshift(explicitGlobal.initializationValueNode);
		let exportsReferences = initializationValueAST.find(jscodeshift.Identifier).filter(path => {

			//do not consider references of exports inside member expressions (variables initialized with bound properties)
			return path.value.name === 'exports' && path.parentPath.value.type !== 'MemberExpression';
		});

		if(exportsReferences.length > 0) {

			//explicitGlobal's initialization value contains a reference to exports
			return true;
		}

		let moduleExportsReferences = initializationValueAST.find(jscodeshift.MemberExpression).filter(path => {

			//do not consider references of module.exports inside member expressions (variables initialized with bound properties)
			return path.value.object.type === 'Identifier' && path.value.object.name === 'module' &&
				   path.value.property.type === 'Identifier' && path.value.property.name === 'exports' && 
				   path.parentPath.value.type !== 'MemberExpression';
		});

		if(moduleExportsReferences.length > 0) {

			//explicitGlobal's initialization value contains a reference to module.exports
			return true;
		}

		return false;
	});

	return explicitGlobalsInitializedWithExportObject.length === 0 ? null : explicitGlobalsInitializedWithExportObject[0];

}

/**
 * Search a statement (assignment, variable declaration) containing an assignment of module.exports/exports in sourceFile.
 *
 * @param sourceFile
 * @returns the assignment of the specific type, if it exists. Otherwise, null.
 */
function retrieveAssignmentOfExportObject(sourceFile) {

	let exportObjectRefsStmts = sourceFile.astRootCollection.find(jscodeshift.ExpressionStatement).filter(stmt => {

		//do not consider variables assigned with the export objects
		// if(stmt.value.type === 'VariableDeclaration') {

		// 	return false;
		// }

		let exportObjRefs = jscodeshift(stmt).find(jscodeshift.MemberExpression).filter(mbExp => {

			return mbExp.value.object.type === 'Identifier' && mbExp.value.object.name === 'module' &&
					mbExp.value.property.type === 'Identifier' && mbExp.value.property.name === 'exports' &&
					mbExp.parentPath.value.type !== 'MemberExpression';
		});

		//statement contains a reference to the export object (module.exports)
		if(exportObjRefs.length > 0) {

			return true;
		}

		exportObjRefs = jscodeshift(stmt).find(jscodeshift.Identifier).filter(id => {

			return id.value.name === 'exports' &&
					id.parentPath.value.type !== 'MemberExpression';
		});

		//statement contains a reference to the export object (exports)
		if(exportObjRefs.length > 0) {

			return true;
		}

		return false;
	});

	// console.log(exportObjectRefsStmts.length)
	// exportObjectRefsStmts = exportObjectRefsStmts.filter(expObjRefStmt => {

		
	// });

	//multiple assignments to the export object might exist
	//case: conditional export
	// console.log(sourceFile.fileName)
	// console.log(exportObjectRefsStmts.length)
	return exportObjectRefsStmts;

}

/**
 * Retrieves the type of the element exported through an assignment of exports to module.exports (or vice versa)
 * @param moduleExportsAssignment
 * @returns the exported element.
 */
function retrieveExportedElementThroughAssignmentOfModuleExportsToExports(sourceFile, moduleExportsAssignment) {
	
	//operands of moduleExportsAssignment
	var rightOperand;
	var rightOperandType;

	// console.log(sourceFile.fileName);
	
	//operands of the assignment contained in moduleExportsAssignment (contained assignment comprises the right operand of moduleExportsAssignment)
	var assignmentRightOperand;
	var assignmentRightOperandName;
	
	//moduleExportsAssignment node syntax: exports = module.exports or module.exports = exports;
	//moduleExportsAssignment syntax: (i) [<variableDeclarator> | <identifier> =] exports = module.exports [= <identifier> | <objectLiteral>]
	var parentNode = moduleExportsAssignment.parentPath;
	var parentNodeType = parentNode.value.type;
	
	var explicitGlobal;
	var definedFunction;
	
	var moduleExportsObject = {};
	moduleExportsObject.moduleExportsAssignment = moduleExportsAssignment;
	moduleExportsObject.isExportedElementViaModuleExportsAVariable = false;
	
	if(parentNodeType === 'VariableDeclarator') {
		
		//case 1: moduleExportsAssignment is assigned to a variable
		//syntax: (i)  var <variableName> = exports = module.exports = ...
		//		  (ii) var <variableName> = module.exports = exports = ...
		
		//the exported element is a variable
		moduleExportsObject.exportedElement = sourceFile.retrieveExplicitGlobal(parentNode.value.id.name);
		moduleExportsObject.isExportedElementViaModuleExportsAVariable = true;
		return moduleExportsObject;
	}
	
	//case 2: moduleExportsAssignment is not assigned to a variable
	//syntax: (i)  exports = module.exports = <identifier>
	//		  (ii) module.exports = exports = <identifier>

	// console.log(sourceFile.fileName);
	// console.log(moduleExportsAssignment.value.loc);
	
	rightOperand = moduleExportsAssignment.value.right;
	rightOperandType = rightOperand.type;
	assignmentRightOperand = rightOperand;
	
	// if(rightOperandType === 'AssignmentExpression') {
		
	// 	assignmentRightOperand = rightOperand.right;
	// 	assignmentRightOperandName = assignmentRightOperand.name;
		
	// 	//is assignmentRightOperandName a reference to a variable?
	// 	explicitGlobal = sourceFile.retrieveExplicitGlobal(assignmentRightOperandName);
	// 	if(explicitGlobal !== null) {
			
	// 		moduleExportsObject.exportedElement = explicitGlobal;
	// 		moduleExportsObject.isExportedElementViaModuleExportsAVariable = true;
	// 		return moduleExportsObject;
	// 	}
		
	// 	//assignmentRightOperandName is a reference to a function
	// 	definedFunction = sourceFile.retrieveTopLevelScopeFunctionByName(assignmentRightOperandName);
	// 	if(definedFunction !== null) {
			
	// 		moduleExportsObject.exportedElement = definedFunction;
	// 		moduleExportsObject.isExportedElementViaModuleExportsAVariable = false;
	// 		return moduleExportsObject;
	// 	}
		
	// }

	while(rightOperandType === 'AssignmentExpression') {
		
		assignmentRightOperand = rightOperand.right;
		// assignmentRightOperandName = assignmentRightOperand.name;
		
		rightOperandType = assignmentRightOperand.type;
	}

	// console.log(rightOperandType);

	if(rightOperandType === 'Identifier') {

		//is assignmentRightOperand a reference to a variable?
		explicitGlobal = sourceFile.retrieveExplicitGlobal(assignmentRightOperand.name);
		if(explicitGlobal !== null) {
			
			moduleExportsObject.exportedElement = explicitGlobal;
			moduleExportsObject.isExportedElementViaModuleExportsAVariable = true;
			return moduleExportsObject;
		}
		
		//assignmentRightOperand is a reference to a function
		definedFunction = sourceFile.retrieveTopLevelScopeFunctionByName(assignmentRightOperand.name);
		if(definedFunction !== null) {
			
			moduleExportsObject.exportedElement = definedFunction;
			moduleExportsObject.isExportedElementViaModuleExportsAVariable = false;
			return moduleExportsObject;
		}
	}
	else if(rightOperandType === 'FunctionExpression') {

		//assignmentRightOperand is a function expression
		definedFunction = sourceFile.retrieveDefinedFunctionByNode(assignmentRightOperand);
		if(definedFunction !== null) {
			
			moduleExportsObject.exportedElement = definedFunction;
			moduleExportsObject.isExportedElementViaModuleExportsAVariable = false;
			return moduleExportsObject;
		}
	}
	else {

		//update: what if the exported element is a call expression?
		moduleExportsObject.exportedElement = rightOperand;
		moduleExportsObject.isExportedElementViaModuleExportsAVariable = false;
		return moduleExportsObject;
	}
	
	return null;
}

/**
 * Retrieves the import statements of a CommonJS module
 * @returns an array with the module's imports
 */
function getImportStatementsOfCommonJSModule(sourceFile) {
	
	//retrieve callexpressions to require()
	let callExpressions = sourceFile.astRootCollection.find(jscodeshift.CallExpression).filter(callExpression => {

		// console.log(callExpression.scope.isGlobal);
		let rqArguments = callExpression.value.arguments;
		if(rqArguments.length === 0) {

			return false;
		}

		let rqArg = rqArguments[0];
		if(rqArg.type !== 'Literal') {

			return false;
		}
		
		//retrieve name of callee function of callExpression
		//also keep imports through external packages (e.g. proxyquire)
		let callee = callExpression.value.callee;

		//callee not a function (identifier) or a method (member expression)
		if(callee.type !== 'Identifier' && callee.type !== 'MemberExpression') {

			return false;
		}

		if(callee.type === 'Identifier' &&
			callee.name !== 'require' &&
			callee.name !== 'proxyquire') {

			return false;
		}

		if(callee.type === 'MemberExpression' &&
			(callee.property.type !== 'Identifier' ||
			 callee.property.name !== 'require')) {

			return false;
		}

		let callArgs = callExpression.value.arguments;

		if(callArgs.length === 0) {

			return false;
		}

		let modPath = callArgs[0];

		//exclude invocations that import json files
		return modPath.type === 'Literal' && modPath.value.endsWith('.json') === false;

		// return (callee.type === 'Identifier' && (callee.name === 'require' || callee.name === 'proxyquire')) ||
		// 		(callee.type === 'MemberExpression' && callee.property.name === 'require');

	});
	
	let importStatements = [];
	callExpressions.forEach(callExp => {

		importStatements.push(callExp);
	});
	
	//update the distinct imported (internal and external) modules for the analyzed system
	//(used for evaluation information)
	// updateDistinctImportedModules(sourceFile, importStatements);
	
	sourceFile.updateImportStatements(importStatements);
	return importStatements;
}

/**
 * Updates the distinct imported (internal and external) modules for the analyzed system
 * (used for evaluation information).
 * @param {*} inputFile 
 * @param {*} importStatements 
 */
function updateDistinctImportedModules(inputFile, importStatements) {

	importStatements.forEach(function(importStatement) {

		//update the CommonJS import statements located in the analyzed system (#call sites of require())
		systemImportStatements.push(importStatement);

		let importStatementArgs = importStatement.value.arguments;
		if(importStatementArgs[0].type !== 'Literal') {
			
			//argument of call site of require() is not a literal (it is not the name of a module)
			return;
		}

		let requiredModulePath = importStatementArgs[0].value;
		try {

			let specifiedModulePath = require.resolve(path.resolve(path.dirname(inputFile.fileName) + path.sep + requiredModulePath));
			if((specifiedModulePath.includes('node_modules') === true || requiredModulePath.startsWith('.') === false) &&
			   distinctImportedExternalModules.includes(path.basename(requiredModulePath)) === false) {

				//npm package that is included in the node_modules directory or is globally installed (external module)
				//add it to the array of the external imported modules and proceed to the next
				//import statement
				distinctImportedExternalModules.push(path.basename(requiredModulePath));
				return;
			}

			if(distinctImportedModules.includes(specifiedModulePath) === false) {

				//add each imported module to the array once
				distinctImportedModules.push(specifiedModulePath);
			}
		}
		catch(err) {

			//module specified by requiredModulePath could not be resolved
			//add it to the external imported modules array
			if(distinctImportedExternalModules.includes(requiredModulePath) === false) {

				distinctImportedExternalModules.push(requiredModulePath);
			}
		}
	});
}

/**
 * Calculates the afferent coupling of a CommonJS module (#modules dependent on the given module).
 * @param astRootCollection
 * @param fileList
 * @param sourceFile
 * @returns
 */
function calculateAfferentCouplingOfCommonJSModule(inputFiles, sourceFile, directory) {
	
	//CommonJS: exported elements are assigned
	//retrieve assignments of module
	
	getExportStatementsOfCommonJSModule(sourceFile);
	
	if(sourceFile.statementReferencingExportObject === null && sourceFile.assignmentsToExportObjectBindings.length === 0) {
		
		//common js module does not contain export statements
		//return empty array
		return [];
	}
	
	//module has export statements
	//retrieve modules dependent on module
	return retrieveModulesDependentOnModule(sourceFile, inputFiles, directory).length;
}

/**
 * Retrieves modules dependent on module specified by sourceFile.
 * @param file
 * @returns
 */
function retrieveModulesDependentOnModule(sourceFile, inputFiles, directory) {
	
	//file has export statements
	//find files that import elements from this file
	var dependentModules = [];
	
	inputFiles.forEach(function(inputFile) {
		
		if(inputFile.fileName === sourceFile.fileName) {
			
			return;
		}
		
		//get modules with elements required in inputFile
		var requiredModules = retrieveModulesRequiredInCommonJSModule(inputFiles, inputFile);
		
		//is inputFile dependent on sourceFile?
		//(are there any elements that are required in inputFile and are defined in sourceFile?)
		for(var requiredModuleIndex = 0; requiredModuleIndex < requiredModules.length; requiredModuleIndex++) {
			
			var requiredModuleName = requiredModules[requiredModuleIndex];
			
			//normalize path (replace \\ with \)
			requiredModuleName = requiredModuleName.replace(/\\\\/g, '\\');
			var requiredModule = fileUtilities.retrieveModuleInList(inputFiles, requiredModuleName);

			
			//if required module corresponds to sourceFile,
			//then inputFile is dependent on sourceFile
			if(requiredModule !== null && sourceFile.fileName === requiredModule.fileName && 
			   dependentModules.indexOf(inputFile.fileName) === -1) {
				
				dependentModules.push(path.resolve(inputFile.fileName));
				return;
			}
		}
		
	});
	
	sourceFile.updateDependentModules(dependentModules);
	return dependentModules;
}

/**
 * Retrieves the modules required in a CommonJS module
 * @returns
 */
function retrieveModulesRequiredInCommonJSModule(inputFiles, file) {
	
	//case: file's required modules are retrieved
	//in order to find another file's dependent modules
	//example: file A requires an element from file B
	//required modules of A can be retrieved in either stages:
	//(1) when efferent coupling of A is assessed
	//(2) when afferent coupling of B is assessed
	//case: afferent coupling of B is assessed before
	//the assessment of efferent coupling of A
	if(file.requiredFiles !== null) {
		
		return file.requiredFiles;
	}
	
	//retrieve callexpressions to require() (commonJS import statements)
	var importStatements = getImportStatementsOfCommonJSModule(file);

	var requiredModules = [];
	
	importStatements.forEach(function(importStatement) {
		
		//retrieve module whose element is required (find argument to require())
		var specifiedModule = importStatement.value.arguments[0].value;
		
		if(specifiedModule === undefined) {
			
			//case: require called with a non-string argument
			//proceed to the next importStatement
			return;
		}
		
		var specifiedModulePath;
		if(specifiedModule.startsWith('.') === false) {
			
			//no relative path is given
			//specifiedModule points to either a built-in or a downloaded npm package
			//do not search package in input files' list
			try {
				
				//retrieve absolute path to specifiedModule
				specifiedModulePath = require.resolve(specifiedModule);
			}
			catch(err) {
				
				specifiedModulePath = specifiedModule;
			}
			
		}
		else {
			
			//relative path - search required module in input files' list
			//resolve absolute path based on the path of file and the name of specifiedModule (module required in file)
			// specifiedModulePath = path.resolve(path.dirname(file.fileName) + "\\" + specifiedModule);

			specifiedModulePath = path.resolve(path.dirname(file.fileName) + path.sep + specifiedModule);
			
			var requiredFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
			
			if(requiredFile !== null && requiredModules.indexOf(requiredFile.fileName) === -1) {
				
				requiredModules.push(requiredFile.fileName);
			}
		}
		
	});
	
	file.addModuleDependencies(requiredModules);
	return requiredModules;
}

/**
 * Calculates the efferent coupling of a CommonJS module (#modules a CommonJS module depends on)
 * @returns
 */
function calculateEfferentCouplingOfCommonJSModule(inputFiles, file) {
	//retrieve callexpressions to require()
	var requiredModules = retrieveModulesRequiredInCommonJSModule(inputFiles, file);
	
	return requiredModules.length;
}

function retrieveUsedGlobalIdentifiersInSourceFile(sourceFile) {

	//elements (variables/functions/objects/modules) imported in sourceFile
	//exclude modules (they're imported for their side effects)
	let importedDefinitions = sourceFile.importedElements.filter(importedEl => {

		return importedEl instanceof ImportedModule.ImportedModule === false;
	});

	// console.log(sourceFile.fileName + ' impDefs: ' + importedDefinitions.length)

	//update each definition with its references
	importedDefinitions.forEach(importedDef => {

		retrieveUsagesOfImportedElementInSourceFile(sourceFile, importedDef);
	});

}

/**
 * Retrieves usages of importedElement in sourceFile (def-use algorithm with ternjs)
 * Module system-specific function (imported elements in CommonJS modules are defined,
 * since they are the definitions assigned the result of require().)
 * @param sourceFile
 * @param importedElement
 * @returns 
 */
function retrieveUsagesOfImportedElementInSourceFile(sourceFile, importedElement) {
	
	// console.log(importedElement);
	// console.log(sourceFile.fileName + ' ' + importedElement.aliasName + ' ' + importedElement.isNested);
	let elementDeclNodes = importedElement.importedElementNodes;
	let arrayExpElNodes = elementDeclNodes.filter(elemNode => {

		// console.log(elemNode.parentPath.parentPath.value.type)
		return elemNode.parentPath.parentPath.value.type === 'ArrayExpression';
	});

	// console.log(arrayExpElNodes.length);

	//importedElement defined in nested scope or
	//inside an array
	if(importedElement.isNested === true &&
		arrayExpElNodes.length > 0) {

		return [];
	}
	
	//importedElement not an implied global
	if(elementDeclNodes.length === 0) {

		return [];
	}

	console.log(sourceFile.fileName + ' ' + importedElement.aliasName + ' ' + elementDeclNodes.length);
	// console.log(elementDeclNodes.length);

	//importedElement references (counted once for all the initial imports,
	//since ES6 does not allow duplicate imports/exports)
	//do not search with the element's alias (an imported element might be imported
	//multiple times under multiple aliases)
	// let aliasName = importedElement.aliasName;
	let elementRefIdentifiers = [];
	
	//find the range of the identifier defining importedElement
	//(identifier inside its definition)
	elementDeclNodes.forEach(elementDeclNode => {

		// console.log(elementDeclNode.value.loc)

		let aliasName;

		//elementDeclNode: require() invocation
		//update: retrieve the Statement that is closest to elementDeclNode
		//(ExpressionStatement that contains an AssignmentExpression, VariableDeclaration)
		//(do not find all statements that surround elementDeclNode)
		let surrStmts = jscodeshift(elementDeclNode).closest(jscodeshift.Statement);

		//retrieve the statement containing it (AssignmentExpression, VariableDeclaration)
		// let surrStmts = sourceFile.astRootCollection.find(jscodeshift.Statement).filter(stmt => {

		// 	let stmtAST = jscodeshift(stmt);
		// 	let requireCalls = stmtAST.find(jscodeshift[elementDeclNode.value.type]).filter(callExp => {

		// 		return callExp.value === elementDeclNode.value;
		// 	});

		// 	if(requireCalls.length > 0) {

		// 		return true;
		// 	}

		// 	return false;
		// });

		if(surrStmts.length === 0) {

			return;
		}

		// console.log('s: ' + surrStmts.length)

		//retrieve the element's definition range 
		//(range of the identifier inside definition)
		let elementDefLoc;
		let elementDefRange;
		let surrStmt = surrStmts.at(0).get();
		// console.log(surrStmt.value.type);
		if(surrStmt.value.type === 'ExpressionStatement') {

			//require() invocation inside an expression statement 
			//(consider only assignments)
			let expression = surrStmt.value.expression;
			if(expression.type !== 'AssignmentExpression') {

				return;
			}

			let leftOperand = expression.left;
			if(leftOperand.type !== 'Identifier') {

				return;
			}

			aliasName = leftOperand.name;
			elementDefLoc = leftOperand.loc;
			elementDefRange = leftOperand.range;
		}
		else if(surrStmt.value.type === 'VariableDeclaration') {

			//require() invocation inside a variable declaration
			//find the declaration initialized with elementDeclNode (it is 1)
			//or whose initialization value contains elementDeclNode (e.g. MemberExpression)
			let surrDeclarator = surrStmt.value.declarations.find(decl => {

				if(decl.init === null) {

					return false;
				}
				
				let initNode = decl.init;

				//declarator initialized with elementDeclNode
				if(initNode === elementDeclNode.value) {

					return true;
				}

				//does declarator's initial value contain elementDeclNode (member expression)?
				let surrInitStmts = jscodeshift(initNode).find(jscodeshift[elementDeclNode.value.type]).filter(elNode => {

					return elNode.value === elementDeclNode.value;
				});

				if(surrInitStmts.length > 0) {

					return true;
				}

				return false;
			});

			// console.log(`surrDec: ${surrDeclarator}`)
			if(surrDeclarator == null) {

				return;
			}

			// console.log('surr declarators: ' + surrDeclarators.length);

			// let surrDeclarator = surrDeclarators[0];
			// console.log(surrDeclarator);
			if(surrDeclarator.id.type !== 'Identifier') {

				return;
			}

			aliasName = surrDeclarator.id.name;
			elementDefLoc = surrDeclarator.id.loc;
			elementDefRange = surrDeclarator.id.range;
		}
		else {

			return;
		}

		//prepare Tern request 
		//(def-use chain, since importedElement is defined within module)
		ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

		let referenceObjs = [];
		let referenceIdentifiers = [];

		//in the case aliasName is undefined,
		//keep importedElement's alias
		//(case: importedElement is imported multiple times under multiple aliases-
		//importedElement is unique (by the imported module), 
		//but contains multiple elementDeclNodes-
		//search references using all aliases,
		//but put them in the importedElement object)
		aliasName = aliasName || importedElement.aliasName;

		// console.log(elementDefRange)

		let requestDetails = {
			query: {
	
				type: "refs",
				file: sourceFile.fileName,
				start: elementDefRange[0],
				end: elementDefRange[1],
				variable: aliasName
			},
			timeout: 1000
		};

		// console.log('Query refs for ' + aliasName);
	
		ternServer.request(requestDetails, function(error, success) {
	
			// console.log(error);
			// console.log(success);
			if(error !== null || Object.keys(success).length === 0) {
	
				return;
			}
			
			//retrieve range of declaration
			let refs = success.refs;
			refs.forEach(ref => {

				let refStart = ref.start;
				let refEnd = ref.end;
	
				referenceObjs.push({
	
					'refStart': refStart,
					'refEnd' : refEnd
				});
			});
		});

		// console.log('ref objs: ' + referenceObjs.length);

		//retrieve references in the AST (jscodeshift)
		referenceObjs.forEach(refObj => {

			let refStart = refObj.refStart;
			let refEnd = refObj.refEnd;

			let refIdentifiers = sourceFile.astRootCollection
								.find(jscodeshift.Identifier).filter(id => {

											// console.log(refObj);
											// console.log(id.value.loc);
											// console.log(elementDefLoc);
											// console.log(id.value.range);

				//id not referencing aliasName
				if(aliasName !== id.value.name) {

					return false;
				}

				//exclude references modelling the re-definition of importedElement
				//(e.g. definition of a shadow variable with the same name)
				if(id.parentPath.value.type === 'VariableDeclarator' &&
					id.parentPath.value.id === id.value) {

					return false;
				}

				// console.log(id.value.loc);

				//brings the closest scope declaring feature aliasName
				// console.log(id.scope.lookup(id.value.name));
				// console.log(id.scope.node);
				// console.log(id.scope.bindings);

				/**
				 * Exclude references of parameters named aliasName
				 * (or references of features that share the same name,
				 * but are declared in non-global surrounding scopes).
				 * Needed for (except finding imported feat refs)
				 * specifying the imported feats used apart from their properties
				 * (e.g. function invocation args)
				 * 
				 * NOTICE: scope bindings don't always work properly
				 * case (mathjs): references of parameter (latex) 
				 * inside the same function (calculateNecessaryParentheses())
				 * and block nesting level (l. 150/236), different result with bindings
				 * (erroneous consideration of 1st reference as an imported feat reference, 
				 * while 2nd is correctly filtered out - didn't find out why)
				 */

				//(a)
				let idScope = id.scope;
				let scopeBindings = idScope.bindings;

				// console.log(scopeBindings[id.value.name]);

				if(scopeBindings[id.value.name] != undefined &&
					scopeBindings[id.value.name][0] != undefined &&
					scopeBindings[id.value.name][0].parentPath.name != undefined &&
					scopeBindings[id.value.name][0].parentPath.name === 'params') {

					return false;
				}

				// (b) exclude references inside scopes (functions) that shadow aliasName
				// through parameters (or identifiers modelling the parameters themselves)
				// console.log(idScope.node);
				if((idScope.node.type === 'FunctionDeclaration' ||
					idScope.node.type === 'FunctionExpression') &&
					idScope.node.params.find(param => {

						// console.log(param);
						// console.log('\nid');
						// console.log(id.value);

						return param === id.value || param.name === id.value.name;

					}) != undefined) {

					// console.log(`Filtering out`);
					return false;
				}

				//exclude shadow definition references
				//find variable declarator of id
				let varDecls = jscodeshift(id).getVariableDeclarators(id => id.value.name);
				// varDecls.forEach(varDecl => console.log(varDecl.value.loc));

				// console.log(varDecls.length);

				//no variables in the scope of id (consider id in the uses of importedElement)
				if(varDecls.length === 0) {

					return true;
				}

				// console.log(varDecls);

				//there are >0 variables with importedElement's name in the scope of id
				//(shadow variables or nested import statements)
				//find the variables initialized with (a) elementDeclNode
				//(b) an expression containing elementDeclNode (for member expressions)
				let idDecls = varDecls.filter(varDecl => {

					if(varDecl.value.init == null) {

						return false;
					}

					if(varDecl.value.init === elementDeclNode.value) {

						return true;
					}

					let initValueAST = jscodeshift(varDecl.value.init);
					let initValues = initValueAST.find(jscodeshift[elementDeclNode.value.type]).filter(elDecNode => {

						return elDecNode.value === elementDeclNode.value;
					});

					if(initValues.length === 0) {

						return false;
					}

					return true;
				});

				// console.log('i: ' + idDecls.length);
				// // idDecls.forEach(idDecl => console.log(idDecl.value.loc));

				if(idDecls.length === 0) {

					return false;
				}

				// console.log(id.value.loc);

				//do not compare with the element's alias name
				//(importedElement might be imported multiple times
				//under another alias - case: planck.js, MathTest.js)
				if(id.value.loc == null) {

					return false;
				}

				let idLoc = id.value.loc;

				//exclude references inside the imported definition's definition node
				// if(idLoc.start.line === elementDefLoc.start.line && idLoc.start.column === elementDefLoc.start.column &&
				// 	idLoc.end.line === elementDefLoc.end.line && idLoc.end.column === elementDefLoc.end.column) {

				// 	return false;
				// }
				
				//ASTs of Tern and jscodeshift
				//differ on some identifier's ranges
				//also keep identifiers named aliasName
				return ((id.value.range[0] === refStart && id.value.range[1] === refEnd) ||
						id.value.name === aliasName);
			});

			if(refIdentifiers.length === 0) {

				return;
			}

			// console.log('r: ' + refIdentifiers.length);

			//exclude importedElement references 
			//inside importedElement's definition
			//and references inside member expressions
			//where importedElement is not the object
			refIdentifiers = refIdentifiers.filter(refId => {

				if(refId.parentPath.value.type === 'MemberExpression') {

					// console.log(refId.parentPath.value.object);
					// console.log(refId.value);
					if(refId.parentPath.value.object === refId.value) {

						return true;
					}
					
					return false;
				}

				if(refId.parentPath.value.type === 'Property') {

					if(refId.parentPath.value.value === refId.value) {

						return true;
					}

					return false;
				}

				return true;
				
				// return refId.value.range[0] !== elementDefRange[0] &&
				// 		refId.value.range[1] !== elementDefRange[1];
			});

			refIdentifiers.forEach(refId => {

				if(referenceIdentifiers.includes(refId) === false) {

					referenceIdentifiers.push(refId);
				}
			});

		});

		elementRefIdentifiers = elementRefIdentifiers.concat(referenceIdentifiers);
	});

	//delete file from Tern server
	//(importedElement is defined in the CommonJS module,
	//thus prevent searching in other files)
	ternServer.delFile(sourceFile.fileName);

	// console.log('usages: ' + elementRefIdentifiers.length);

	//update usages of importedElement
	importedElement.updateElementUsages(elementRefIdentifiers);

	//importedElement accessed dynamically (through bracket notation)
	//used in order to prevent object destructuring
	importedElement.updateIsAccessedDynamically();
	// console.log(elementRefIdentifiers.map(elementRefId => elementRefId.value.loc))

	//in the case of an imported namespace,
	//retrieve the references of each namespace property
	if(importedElement instanceof ImportedNamespace.ImportedNamespace === true) {

		importedElement.updateAccessedProperties();
	}
}

exports.isSourceFileACommonJSModule = isSourceFileACommonJSModule;
exports.calculateAfferentCouplingOfCommonJSModule = calculateAfferentCouplingOfCommonJSModule;
exports.calculateEfferentCouplingOfCommonJSModule = calculateEfferentCouplingOfCommonJSModule;
exports.retrieveExportedElementsOfCommonJSModule = retrieveExportedElementsOfCommonJSModule;
exports.retrieveImportedElementsOfCommonJSModule = retrieveImportedElementsOfCommonJSModule;