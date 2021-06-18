/**
 * http://usejsdoc.org/
 */

var path = require('path');
var fs = require('fs');

var jscodeshift = require('../../../../node_modules/jscodeshift');

//used for def-use algorithm
var tern = require('../../../../node_modules/tern');
var inferenceEngine = require('../../../../node_modules/tern/lib/infer.js');

//used for implied global identification
var jshint = require('../../../../node_modules/jshint').JSHINT;

var fileUtilities = require('../../../io/fileUtilities.js');

var reservedWords = require('./reservedWords.js');
var enums = require('./enums.js');

var ImpliedGlobalVariable = require('../model/impliedGlobalVariable.js');
var ImportedNamespace = require('../model/importedNamespace.js');
var ImportedModule = require('../model/importedModule.js');
var FunctionProperty = require('../model/functionProperty.js');
var ObjectProperty = require('../model/objectProperty.js');
var Variable = require('../model/variable.js');
var FunctionDeclaration = require('../model/functionDeclaration.js');

var ternServer = new tern.Server({});

/**
 * Loads the ASTs specified in inputFiles in the server of Tern.
 * (Utility function that loads each file once in Tern, thus reducing query execution time.)
 * @param {*} inputFiles 
 */
function loadFilesOnTernServer(inputFiles) {

	for(let bucketIndex = 0; bucketIndex < inputFiles.buckets.length; bucketIndex++) {

		let fileList = inputFiles.buckets[bucketIndex];
		if(fileList === undefined) {

			continue;
		}
		for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

			//fileList stores an array of [key, value] for each file
			let inputFile = fileList[fileIndex][1];

			ternServer.addFile(inputFile.fileName, inputFile.astRootCollection.toSource());
		}
	}
}

/**
 * Removes the ASTs specified in inputFiles from the server of Tern.
 * (Utility function that removes the ASTs from Tern right after the analysis is done,
 * while preventing file loading for each query.)
 * @param {*} inputFiles 
 */
function removeFilesFromTernServer(inputFiles) {

	for(let bucketIndex = 0; bucketIndex < inputFiles.buckets.length; bucketIndex++) {

		let fileList = inputFiles.buckets[bucketIndex];
		if(fileList === undefined) {

			continue;
		}
		for(let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {

			//fileList stores an array of [key, value] for each file
			let inputFile = fileList[fileIndex][1];

			ternServer.delFile(inputFile.fileName);
		}
	}
}

/**
 * In the case that the CommonJS module specified in inputFile exports an object literal
 * through assigning it to exports/module.exports, 
 * the function retrieves the exported object's properties usages
 * (in order to determine whether the object must be destructured during the module's transformation)
 */
function retrieveReferencesOfPropertiesOfExportedObjectLiteral(inputFile) {

	if(inputFile.exportedProperties.length === 0 ||
	   inputFile.fileName.includes('test') === true) {

		//inputFile does not assign object literal to exports/module.exports
		return;
	}

	let astRootCollection = inputFile.astRootCollection;

	//inputFile assigns object literal to exports/module.exports
	//update the object's properties with their usages within the object 
	//(useful in order to destructure it during transformation)
	inputFile.exportedProperties.forEach(function(exportedProperty) {

		//for each object literal, retrieve the uses of its defined properties
		let objectProperties = exportedProperty.objectProperties;
		objectProperties.forEach(function(objectProperty) {

			// console.log(inputFile.fileName + ' ' + objectProperty.propertyName)
			// console.log(objectProperty.propertyDefinitionNode);
			let objectPropertyDefinitionNode = objectProperty.propertyDefinitionNode;
			if(objectPropertyDefinitionNode.type !== 'Property') {

				//object property not defined within object
				//these properties' references are resolved during the surrounding object's property retrieval 
				//(iteration over the export statements)
				return;
			}
			let objectPropertyDefinitionStart = objectPropertyDefinitionNode.key.range[0];
			let objectPropertyDefinitionEnd = objectPropertyDefinitionNode.key.range[1];

			//retrieve def-use chains for each property (ternjs)
			//add timeout (each query needs a finite time to be executed)
			let requestDetails = {
				query: {
					type: "refs",
					file: inputFile.fileName,
					end: objectPropertyDefinitionEnd
				},
				timeout: 1000
			};
		
			let objectPropertyReferenceRanges = [];

			try {

				//what if ternjs cannot find uses of the object's properties
				//within the object context?
				ternServer.request(requestDetails, function(error, success){
				
					// console.log(error);
					// console.log(success);
			
					if(error != null) {
			
						return;
					}
			
					//retrieve the ranges of the usages (references) of variable
					objectPropertyReferenceRanges = success.refs.map(reference => {
			
						return {
			
							start: reference.start,
							end: reference.end
						};
					});
				});
	
				//exclude uses within the property's definition
				objectPropertyReferenceRanges = objectPropertyReferenceRanges.filter(propertyReference => {
	
					return propertyReference.start !== objectPropertyDefinitionStart && propertyReference.end !== objectPropertyDefinitionEnd;
				});
	
				//ternjs returns identifiers
				//update objectProperty with its full uses (member expressions)
				let propertyUsages = [];
				objectPropertyReferenceRanges.forEach(function(propertyReference) {
	
					//retrieve reference (identifier range) returned from ternjs in the AST
					let propertyUsageIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(node => {
	
						return node.value.range[0] === propertyReference.start && node.value.range[1] === propertyReference.end;
					});
	
					// console.log(propertyUsages.length);
	
					if(propertyUsageIdentifiers.length === 0) {
	
						//no uses are retrieved
						return;
					}
	
					//keep the member expressions representing usages of objectProperty
					propertyUsageIdentifiers.forEach(function(propertyUsageIdentifier) {
	
						propertyUsages.push(propertyUsageIdentifier.parentPath.value);
					});
				});
	
				objectProperty.updateObjectPropertyUsages(propertyUsages);
			}
			catch(err) {

				console.log('Problem finding refs of property within object\nFile: ' + inputFile.fileName + '\nProperty: ' + objectProperty.propertyName);
			}
			

			// console.log(propertyUsages);
		});
	});

	// console.log(inputFile.fileName);
	// inputFile.exportedProperties.forEach(exportedProperty => {

	// 	console.log(exportedProperty);
	// })
}

/**
 * Retrieves usages of importedElement in sourceFile (def-use algorithm with ternjs)
 * TODO: divide in system-specific functions (different methods for each module system).
 * @param sourceFile
 * @param importedElement
 * @returns
 */
function retrieveUsagesOfImportedElementInSourceFile(sourceFiles, sourceFile, importedElement) {
	
	let referenceIdentifiers = [];

	// console.log(importedElement)

	//retrieve name of importedElement (the name that is used in its usages)
	var identifierName = importedElement.aliasName === null ? importedElement.elementName : importedElement.aliasName;
	var declaredSource = importedElement.declaredSource.value === undefined ? importedElement.declaredSource : importedElement.declaredSource.value;
	var importedElementDeclarationNode = importedElement.elementDeclarationNode;

	// console.log(importedElement.elementName);
	// console.log(sourceFile.fileName + " " + identifierName);

	if(identifierName === undefined && 
	   (importedElement instanceof ImportedModule.ImportedModule === true || importedElement instanceof ImportedNamespace.ImportedNamespace === true)) {

		identifierName = importedElement.declaredSource.value;
	}

	//importedElementNode: AST node representing import of importedElement
	// console.log(sourceFile.fileName + " " + identifierName);
	// console.log(importedElement.importedElementNodes);
	var importedElementNode = importedElement.importedElementNodes.length === 0 ? null : importedElement.importedElementNodes[0];
	var importedElementNodeRange;

	// console.log(importedElement);
	// console.log(importedElementNode.parentPath.parentPath.value)

	//importedElementNode nested in an array
	//do not retrieve usages, since it may be used along with other imported module objects
	//the index of its array reference is needed in order to determine if it references importedElement
	if(importedElement.isNested === true &&
		importedElementNode.parentPath.parentPath.value.type === 'ArrayExpression') {

		return [];
	}

	//search for identifiers representing usages of importedElement in sourceFile
	var astRootCollection = sourceFile.astRootCollection;
	
	var parentNode;
	var usageName;

	var identifierUsages = [];
	var identifiers = [];
	var isLocal;
	var identifierStart;
	var identifierEnd;
	var defStart;
	var defEnd;

	//false when a reference is mapped to no definition
	//consider that this reference points to importedElement due to its name (overapproximation)
	let isReferencedMappedToDefinition = true;

	// var ternServer;

	// console.log(sourceFile.fileName + " " + importedElement.elementName + ' ' + importedElement.aliasName + ' ' + identifierName);

	//return the AST nodes where usages of importedElement are met
	//(astRootCollection represents the source code of sourceFile)
	identifiers = astRootCollection.find(jscodeshift.Identifier).filter(nodePath => {

		//return the AST nodes that represent usages of importedElement in sourceFile
		if(nodePath.value.name !== identifierName) {

			return false;
		}

		// console.log(nodePath.value);

		//update: what if identifier represents a property of exports (do not consider these identifiers)
		parentNode = nodePath.parentPath;
		// console.log(parentNode.value.type);
		if(parentNode.value.type === 'MemberExpression') {

			if(parentNode.value.object.type === 'Identifier' && parentNode.value.object.name === identifierName) {

				// console.log(nodePath.value);
				return true;
			}
			
			if(parentNode.value.object.type === 'ThisExpression' ||
				(parentNode.value.property.type === 'Identifier' && parentNode.value.property.name !== identifierName) ||
				(parentNode.value.object.type === 'Identifier' && parentNode.value.object.name !== identifierName) ||
				parentNode.value.object.type !== 'Identifier') {

				//do not consider identifiers within this expressions (i.e. this.<identifier>)
				return false;
			}
			
		}
		else if(parentNode.value.type === 'Property' && 
				(parentNode.value.value.type !== 'Identifier' || parentNode.value.value !== nodePath.value)) {

			//value located inside a property, but it's not its value
			//(it's the property's name)
			return false;
		}
		else {

			//update: what if identifier is included in a VariableDeclarator? (do not consider these identifiers)
			while(parentNode !== null && parentNode.value.type !== 'VariableDeclarator') {

				parentNode = parentNode.parentPath;
			}

			// if(parentNode !== null) {

			// 	console.log(parentNode.value.id);
			// 	console.log(nodePath.value);
			// 	console.log(parentNode.value.id !== nodePath.value);
			// }
			if(parentNode !== null && parentNode.value.id.type === 'Identifier' && parentNode.value.id === nodePath.value) {

				//identifier is not included in a variable declarator
				//or it is not the identifier of the defined variable (syntax: <variable> = <init_value>)
				// console.log(nodePath.value.name);
				// console.log(nodePath.value);
				return false;
			}

			// console.log(parentNode);
			return true;
		}
		return true;
	});

	// console.log(sourceFile.fileName + " " + importedElement.elementName + " " + identifiers.length);
	if(identifiers.length === 0) {

		//no uses of importedElement are met
		//no need to proceed
		return [];
	}

    ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

	//decide whether each identifier represents a usage
	//of a global variable or a top-level scope function through a query to ternjs
	identifiers.forEach(function(identifier) {

		// console.log(identifier.parentPath);
		// console.log(identifier.value.name + " " + reservedWords.ReservedWords.indexOf(identifierName) + " " + identifier.parentPath.value.type);
		// console.log(identifier.value.name + " " + identifier.parentPath.value.type);
		// console.log(identifier.parentPath.value.type);
		// console.log(identifier.value);
		// console.log(identifier.value.range);
		
		identifierStart = identifier.value.range[0];
		identifierEnd = identifier.value.range[1];
		// console.log(identifier.value.range);
		// console.log(identifier.value.name + " " + identifierEnd);
		// console.log(identifier.value.loc);

		// let analysisFiles = sourceFiles.convertHashMapToArray();
		// analysisFiles = analysisFiles.filter(function(analysisFile) {

		// 	return analysisFile.name !== sourceFile.fileName;
		// });

		// analysisFiles.unshift({

		// 	type: "full",
		// 	name: sourceFile.fileName,
		// 	text: sourceFile.astRootCollection.toSource()
		// });
		

		//find definition of identifier through a query in ternjs
		//(stop request after 1 sec)
		//update: search sourceFile first, after the other files (in the case that the element is not defined in the module)
        let requestDetails = {
            query: {

                type: "definition",
                file: sourceFile.fileName,
				end: identifierEnd,
				variable: identifier.value.name
			},
			timeout: 1000
		};

		// //update: search sourceFile first, after the other files (in the case that the element is not defined in the module)
        // let requestDetails = {
        //     query: {

        //         type: "definition",
        //         file: sourceFile.fileName,
		// 		end: identifierEnd,
		// 		variable: identifier.value.name
		// 	},
		// 	timeout: 1000,
		// 	files: analysisFiles
		// };
		
		let definitionFile;
		ternServer.request(requestDetails, function(error, success) {

			// console.log(identifier.value.loc);
			// // // console.log(identifier.value.range);
			// console.log(error);
			// console.log(success);
            if(error !== null || Object.keys(success).length === 0) {

				//tern did not manage to retrieve the used element's definition (overapproximation)
				//consider that identifier represents a use of importedElement
				isReferencedMappedToDefinition = true;
				identifierUsages.push(identifier);
                return;
			}
			
			//retrieve range of declaration
			definitionFile = success.origin;
			defStart = success.start;
			defEnd = success.end;

		//    console.log(success);
		//    console.log(defStart + " " + defEnd);
		});

		if(definitionFile === undefined) {

			//definitionFile not modified with ternjs's results
			return;
		}

		let defIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(node => {

			let nodeRange = node.value.range;
			return nodeRange[0] === defStart && nodeRange[1] === defEnd;
		});

		// console.log(defIdentifiers.length);
		if(defIdentifiers.length === 0) {

			//identifier's definition not found in the AST
			return;
		}

		let defIdentifier = defIdentifiers.at(0).get();
		// console.log(defIdentifier.parentPath.value);

		let defIdParentNode = defIdentifier.parentPath;
		while(defIdParentNode !== null &&
			  defIdParentNode.value.type !== 'VariableDeclaration' &&
			  defIdParentNode.value.type !== 'ExpressionStatement') {

				defIdParentNode = defIdParentNode.parentPath;
		}

		// console.log(importedElement.elementName);
		// console.log(sourceFile.fileName);
		// console.log(defIdentifier.value);
		// console.log(defIdParentNode);

		if(defIdParentNode === null) {

			//the identifier specified as a result from ternjs
			//is not located within a variable declaration or an
			//expression statement (and, thus, not initialized with an invokation of require)
			return;
		}

		//does definitionIdentifier model a definition of importedElement?
		//(is defIdentifier located within a statement containing one of
		//the imports with respect to importedElement?)
		let isImportedElementDefinedInDefIdentifier = false;
		let defInitNodes = importedElement.importedElementNodes.filter(importedElementNode => {

			let importStmts = jscodeshift(defIdParentNode).find(jscodeshift.CallExpression).filter(callExp => {

				return callExp === importedElementNode;
			});

			if(importStmts.length === 0) {

				return false;
			}

			return true;
		});

		// console.log(importedElement.elementName);
		// console.log(defInitNodes.length);
		if(defInitNodes.length === 0) {

			//defIdentifier not initialized with one of the import statements
			//with respect to importedElement
			return;
		}

		// console.log(defIdentifiers.at(0).get());

		// console.log('d:' + definitionFile + " " + importedElement.elementName);
		// console.log(require.resolve(sourceFile.fileName) !== require.resolve(definitionFile));
		// console.log(importedElement.referencesImpliedGlobal);
		// console.log(sourceFile.moduleFramework);
		// console.log(defStart !== identifierStart && defEnd !== identifierEnd);

		//in AMD/CommonJS modules, imported declarations are the parameters of the callback function/assigned to other declarations
		//(so, uses of parameters/declarations are considered only in AMD/CommonJS modules, not in non-modular ES5 (where there's not a formal mechanism for importing declarations))
		if((sourceFile.moduleFramework.includes(enums.ModuleFramework.plain) === false && importedElement.referencesImpliedGlobal === false || 
		    require.resolve(sourceFile.fileName) !== require.resolve(definitionFile)) && 
			(defStart !== identifierStart && defEnd !== identifierEnd)) {

				// console.log(identifier);

			//location of identifier is not in the range of its definition
			//consider that use
			isIdentifierOfTopLevelScopeAssignedACallsiteOfRequire(importedElement, identifier);
			if(identifierUsages.includes(identifier) === false) {

				//add identifier once
				identifierUsages.push(identifier);
			}
			
		}
		
		// console.log(importedElementNode === null);
		// if(importedElementNode !== null) {

		// 	// let importedElementParentNodeRange = importedElementNode.parentPath.value.range;

		// 	//importedElement is imported via an explicit import (it is not i.e. an implied global)
		// 	//do not consider variable declarators as usages
		// 	// console.log(importedElementNode.parentPath.value.range);
		// 	if(require.resolve(sourceFile.fileName) !== require.resolve(definitionFile) &&(identifierEnd < defStart || identifierEnd > defEnd)) {

		// 		//location of identifier is not in the range of its definition
		// 		//consider that use
		// 		isIdentifierOfTopLevelScopeAssignedACallsiteOfRequire(importedElement, identifier);
		// 		if(identifierUsages.includes(identifier) === false) {

		// 			//add identifier once
		// 			identifierUsages.push(identifier);
		// 		}
				
		// 	}

		// }
		// else {

		// 	// console.log(require.resolve(sourceFile.fileName) !== require.resolve(definitionFile));
		// 	if(require.resolve(sourceFile.fileName) !== require.resolve(definitionFile) && (identifierEnd < defStart || identifierEnd > defEnd)) {

		// 		isIdentifierOfTopLevelScopeAssignedACallsiteOfRequire(importedElement, identifier);
		// 		if(identifierUsages.includes(identifier) === false) {

		// 			//add identifier once
		// 			identifierUsages.push(identifier);
		// 		}
		// 	}
			
		// }	
	});

	ternServer.delFile(sourceFile.fileName);

	// console.log(sourceFile.fileName + " " + importedElement.elementName);
	// console.log(identifierUsages.length)
	
	//update usages of importedElement
	importedElement.updateElementUsages(identifierUsages);

	// console.log(importedElement);

	//update: is importedElement accessed dynamically (through bracket notation)
	//used in order to prevent object destructuring
	importedElement.updateIsAccessedDynamically();

	// console.log(sourceFile.fileName + " " + identifierName + " " + identifierUsages.length);
	// console.log(sourceFile.fileName);
	// console.log(identifierUsages.length);
	return identifierUsages;
}

/**
 * In the case that the identifier represents a variable assigned a call site of require(),
 * importedElement's name is specified by importedFile's name.
 * @param {*} importedElement 
 * @param {*} identifier 
 */
function isIdentifierOfTopLevelScopeAssignedACallsiteOfRequire(importedElement, identifier) {

	var isElementAssignedARequireCallResult = false;
	var isElementExported = false;

	//identifier represents a local variable's usage (what if this variable is assigned the result of a require call?)
	//(case: body-parser, index.js)
	if(identifier.parentPath.value.type === 'AssignmentExpression') {

		let rightOperand = identifier.parentPath.value.right;
		let leftOperand = identifier.parentPath.value.left;
		// console.log(rightOperand);

		if(rightOperand.type === 'CallExpression' && rightOperand.callee.name === 'require') {

			isElementAssignedARequireCallResult = true;

			if(rightOperand.arguments[0].value === importedElement.declaredSource.value) {

				let declaredSourceTokens = importedElement.declaredSource.value.split("/");

				//the alias of the importedNamespace is the base name of the file 
				//(the variable is assigned the alias, instead of the result of the call to require())
				importedElement.elementName = importedElement.elementName === undefined ? declaredSourceTokens[declaredSourceTokens.length-1] : importedElement.elementName;
				importedElement.aliasName = importedElement.aliasName === undefined ? declaredSourceTokens[declaredSourceTokens.length-1] : importedElement.aliasName;
			
				return true;
			}

		}
		// else if(leftOperand.type === 'MemberExpression' &&
		// 		leftOperand.object.name === 'module' &&
		// 		leftOperand.property.name === 'exports') {

		// 		isElementExported = true;
		// }
	}
				
	// return isElementAssignedARequireCallResult || isElementExported;
	return false;
}

// /**
//  * Retrieves usages of importedElement in sourceFile.
//  * @param sourceFile
//  * @param importedElement
//  * @returns
//  */
// function retrieveUsagesOfImportedElementInSourceFile(sourceFile, importedElement) {
	
// 	var usedGlobalIdentifiers = [];
// 	var identifierName;
// 	var parentNode;
// 	var usageName;

// 	// console.log(sourceFile.fileName + " " + importedElement.elementName + " " + importedElement.aliasName);
	
// 	//find identifiers in each definedFunction of module
// 	sourceFile.definedFunctions.forEach(function(definedFunction) {
		
// 		var usagesWithinFunction = [];
// 		var identifiers = [];
// 		var astRootCollection;
		
// 		//search for identifiers representing usages of importedElement in definedFunction
// 		if(definedFunction.functionName === 'topLevelScope'){
			
// 			//topLevelScope is an artificially created node representing
// 			//code in the top-level scope (search identifiers in the whole AST)
// 			astRootCollection = sourceFile.astRootCollection;
// 		}
// 		else {
			
// 			//create the AST representing the source code of definedFunction
// 			astRootCollection = jscodeshift(definedFunction.functionNode);
// 		}

// 		// console.log(importedElement);

// 		if(importedElement.aliasName === null) {

// 			//importedElement has not an alias
// 			//search identifiers by importedElement.elementName
// 			identifierName = importedElement.elementName;
// 		}
// 		else {

// 			//importedElement has an alias
// 			//search identifiers by importedElement.aliasName
// 			identifierName = importedElement.aliasName;
// 		}

// 		// console.log(sourceFile.fileName);

// 		//return the AST nodes where usages of importedElement are met
// 		//(astRootCollection represents the source code of definedFunction)
// 		identifiers = astRootCollection.find(jscodeshift.Identifier).filter(nodePath => {

// 			//return the AST nodes that represent usages of importedElement in the scope represented by definedFunction
// 			//update: what if identifier represents a property of exports (do not consider these identifiers)

// 			var parentNode = nodePath.parentPath;
// 			if(parentNode.value.type === 'MemberExpression') {

// 				// console.log(parentNode.value.property.name + " " + identifierName);
// 				// parentPath = nodePath.parentPath;
// 				// console.log(parentNode.value.type);
// 				// if(parentNode.value.object.type === 'Identifier') {

// 				// 	var accessedObject = parentNode.value.object.name;
// 				// 	if(accessedObject !== identifierName) { // && accessedObject === 'exports' || accessedObject === 'this') {

// 				// 		//identifier represents a property of exports or this (do not consider this identifier)
// 				// 		return false;
// 				// 	}
// 				// }
// 				if(parentNode.value.object.type === 'Identifier' && parentNode.value.object.name === identifierName) {

// 					return nodePath.value.name === identifierName;
// 				}
// 				if(parentNode.value.object.type === 'ThisExpression' ||
// 				  (parentNode.value.property.type === 'Identifier' && parentNode.value.property.name === identifierName) ||
// 				   (parentNode.value.object.type === 'Identifier' && parentNode.value.object.name !== 'exports') ||
// 				   parentNode.value.object.type !== 'Identifier') {

// 					//do not consider identifiers within this expressions (i.e. this.<identifier>)
// 					return false;
// 				}
// 				// console.log(parentPath);
// 			}
// 			else if(parentNode.value.type === 'Property') {

// 				return false;
// 			}
// 			else {

// 				//update: what if identifier is included in a VariableDeclarator? (do not consider these identifiers)
// 				while(parentNode !== null && parentNode.value.type !== 'VariableDeclarator') {

// 					parentNode = parentNode.parentPath;
// 				}

				
// 				// console.log(identifierName);
// 				// console.log(parentNode);

// 				if(parentNode === null) {

// 					//identifier is not included in a variable declarator
// 					// console.log(nodePath.value.name);
// 					return nodePath.value.name === identifierName;
// 				}
// 			}
// 			return nodePath.value.name === identifierName;
// 		});

// 		// console.log(sourceFile.fileName);
// 		// console.log(identifierName + " " + identifiers.length);
		
// 		//decide whether each identifier represents a usage
// 		//of a global variable or a top-level scope function
// 		identifiers.forEach(function(identifier) {

// 			// console.log(identifier.parentPath);
// 			// console.log(identifier.value.name + " " + reservedWords.ReservedWords.indexOf(identifierName) + " " + identifier.parentPath.value.type);
// 			// console.log(identifier.value.name + " " + identifier.parentPath.value.type);
// 			// console.log(identifier.parentPath.value.type);
// 			// console.log(identifier.value.loc);

// 			var isLocal;
// 			parentNode = identifier.parentPath;
// 			identifierName = identifier.value.name;
			
// 			if(reservedWords.ReservedWords.indexOf(identifierName) === -1) {

// 				// console.log(parentNode);

// 				if(parentNode.value.type === 'MemberExpression') {

// 					//does identifier represent the object of a MemberExpression?
// 					usageName = parentNode.value.object.name;
// 				}
// 				else if (parentNode.value.type === "VariableDeclarator") {

// 					if(parentNode.value.id.name === identifierName) {

// 						//exclude usages of elementName in variable declarations (in cases identifierName is defined)
// 						return;
// 					}

// 					//(do not exclude usages in statements with syntax: var <variableName> = require(<modulePath>)[.<elementName>];)
// 					usageName = parentNode.value.id.name;
// 				}
				
// 				//case: identifier is defined locally in an inner function (scope)
				
// 				// console.log(identifierName);
// 				// console.log(parentNode.value.type);
// 				while(parentNode !== null) {
					
// 					parentNodeType = parentNode.value.type;
					
// 					if(parentNodeType === 'FunctionExpression' || parentNodeType === 'FunctionDeclaration') {
						
// 						// console.log(definedFunction.functionName + " " + importedElement.aliasName + " " + identifiers.length);
// 						// console.log(definedFunction.functionNode.value.loc);
// //						console.log();
// 						// console.log(parentNode.value.loc);
// 						// console.log(definedFunction.functionNode !== parentNode);
// //						console.log();
// //						console.log(identifier.value.loc);
// //						console.log();

// 						// console.log(parentNode);
						
// 						//identifier represents a usage in an inner function of (different to) definedFunction
// 						//proceed to the next identifier (the usage in the inner function has been resolved)
// 						//(case: express, router/route.js, importedElement: Layer)
// 						if(definedFunction.functionNode !== parentNode) {
							
// 							return;
// 						}
// 						else {
							
// 							//identifier represents a usage in the scope created by definedFunction
// 							break;
// 						}

// 					}
					
// 					parentNode = parentNode.parentPath;
					
// 				}

// 				// console.log(definedFunction.functionName);

// 				// console.log(definedFunction.functionNode.value.loc);
				
// 				//identifier is not a reserved word
// 				//does identifier represent a usage of importedElement?
// 				isLocal = isIdentifierLocalInFunctionHierarchy(definedFunction, identifier);

// 				// console.log(importedElement);
// 				// console.log(definedFunction.functionNode.value.loc);
// 				// console.log(identifier.value.loc);
// 				// console.log(identifier.value.name + " " + identifierName + " " + isLocal);

// 				var isElementAssignedARequireCallResult = false;
// 				var isElementExported = false;

// 				//identifier represents a local variable's usage (what if this variable is assigned the result of a require call?)
// 				//(case: body-parser, index.js)
// 				if(identifier.parentPath.value.type === 'AssignmentExpression') {

// 					var rightOperand = identifier.parentPath.value.right;
// 					var leftOperand = identifier.parentPath.value.left;
// 					// console.log(rightOperand);
// 					if(rightOperand.type === 'CallExpression' && 
// 					   rightOperand.callee.name === 'require') {

// 						isElementAssignedARequireCallResult = true;

// 						if(rightOperand.arguments[0].value === importedElement.declaredSource.value) {

// 							var declaredSourceTokens = importedElement.declaredSource.value.split("/");

// 							//the alias of the importedNamespace is the base name of the file 
// 							//(the variable is assigned the alias, instead of the result of the call to require())
// 							importedElement.elementName = importedElement.elementName === undefined ? declaredSourceTokens[declaredSourceTokens.length-1] : importedElement.elementName;
// 							importedElement.aliasName = importedElement.aliasName === undefined ? declaredSourceTokens[declaredSourceTokens.length-1] : importedElement.aliasName;
// 						}

// 					}
// 					else if(leftOperand.type === 'MemberExpression' &&
// 							leftOperand.object.name === 'module' &&
// 							leftOperand.property.name === 'exports') {

// 						isElementExported = true;
// 					}
// 				}

// 				// console.log(identifierName + " " + definedFunction.functionName + " " + isLocal);
				
// 				//if identifier is not defined in the function hierarchy of definedFunction 
// 				//(or it is located with topLevelScope - topLevelScope is an artificially created definedFunction containing the code in the top-level scope of the JS file)
// 				//it is a used global identifier
// 				// if(isLocal === false || definedFunction.functionName === 'topLevelScope' || isElementAssignedARequireCallResult === true) {
// 				if(isLocal === false || isElementAssignedARequireCallResult === true || isElementExported === true) {
					
// 					// console.log(identifier);
// 					usedGlobalIdentifiers.push(identifier);

// 					//update: update definedFunction's identifiers (importedElement usages)
// 					usagesWithinFunction.push(identifier);
// 				}
// 			}
			
// 		});

// 		if(usagesWithinFunction.length > 0) {

// 			//if importedElement is used within definedFunction at least once, definedFunction is depended on importedElement)
// 			definedFunction.updateUsedElements(importedElement);
// 		}
		
// 	});
	
// 	//update usages of importedElement
// 	importedElement.updateElementUsages(usedGlobalIdentifiers);
// 	// console.log(sourceFile.fileName + " " + importedElement.elementName + " " + usedGlobalIdentifiers.length);
// 	return usedGlobalIdentifiers;
// }

function retrieveUsedGlobalIdentifiersInSourceFile(inputFiles, sourceFile) {
	
	var usedGlobalIdentifiers = [];
	
	var importedVariables = sourceFile.importedVariables;
	var importedFunctions = sourceFile.importedFunctions;

	//retrieve usages of each imported namespace in sourceFile
	var importedNamespaces = sourceFile.importedNamespaces;

	//retrieve sourceFile's imported modules (imported modules that are creating without using commonjs/amd, i.e. IIFE modules)
	var importedModules = sourceFile.importedModules;
	
	var importedElementUsages;

	// console.log(sourceFile.fileName);
	
	importedVariables.forEach(importedVariable => {
		
		importedElementUsages = [];

		//retrieve usages of imported variable
		// console.log(importedVariable.elementName);
		importedElementUsages = retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedVariable);
		
		usedGlobalIdentifiers = usedGlobalIdentifiers.concat(importedElementUsages);
	});
	
	// console.log(sourceFile.fileName);
	importedFunctions.forEach(importedFunction => {
		
		importedElementUsages = [];

		//retrieve usages of imported function
		// console.log(importedFunction.elementName);
		importedElementUsages = retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedFunction);
		
		// console.log(importedFunction.elementName);
		// console.log(importedElementUsages);

		usedGlobalIdentifiers = usedGlobalIdentifiers.concat(importedElementUsages);
	});

	importedNamespaces.forEach(importedNamespace => {

		importedElementUsages = [];

		// console.log(importedNamespace);

		//retrieve usages of imported namespace (only if it is from a local file)
		if(importedNamespace.declaredSource.startsWith('.') === true) {

			importedElementUsages = retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedNamespace);

			//in addition to namespace uses, retrieve namespace property uses
			importedNamespace.updateAccessedProperties(importedElementUsages);

			// console.log(importedNamespace);
		}
		

		// console.log(sourceFile.fileName);
		// console.log(importedNamespace.aliasName);
		// importedElementUsages.forEach(function(importedElementUsage) {

		// 	console.log(importedElementUsage.value.name);
		// 	console.log(importedElementUsage.value.loc);
		// });

		usedGlobalIdentifiers = usedGlobalIdentifiers.concat(importedElementUsages);
	});

	importedModules.forEach(importedModule => {

		importedElementUsages = [];

		//retrieve usages of importedModule  (only if it is from a local file)
		if(importedModule.declaredSource.startsWith('.') === true) {

			importedElementUsages = retrieveUsagesOfImportedElementInSourceFile(inputFiles, sourceFile, importedModule);
		}

		usedGlobalIdentifiers = usedGlobalIdentifiers.concat(importedElementUsages);
	});
	
	// console.log(sourceFile.fileName);
	// console.log(usedGlobalIdentifiers);
	sourceFile.updateUsedGlobalIdentifiers(usedGlobalIdentifiers);
}

/**
 * Ιs identifier defined locally in definedFunction?
 * @param definedFunction
 * @param identifier
 * @returns
 */
function isIdentifierLocalInFunctionHierarchy(definedFunction, identifier) {
	
	var isLocal = false;
	var inputFunction = definedFunction;
	while(inputFunction !== null && isLocal === false) {
		
		// isLocal = isIdentifierDefinedAsLocalInFunction(definedFunction, identifier);
		isLocal = isIdentifierDefinedAsLocalInFunction(inputFunction, identifier);
		if(isLocal === false) {
			
			//identifierName is not defined locally in definedFunction
			//search in definedFunction's scope
			// console.log(inputFunction);
			inputFunction = inputFunction.functionScope;
		}
	}
	
//	console.log(identifier.value.name);
//	console.log(inputFunction);
	
	return isLocal;
}

/**
 * Is identifier defined within definedFunction?
 * @param definedFunction
 * @param identifier
 * @returns
 */
function isIdentifierDefinedAsLocalInFunction(definedFunction, identifier) {
	
	var localVariables = definedFunction.localVariables;
	var identifierName;
	
	if(identifier.value !== undefined) {

		identifierName = identifier.value.name;
	}
	else {

		identifierName = identifier.name;
	}
	
	// console.log(definedFunction.functionName + " " + identifierName);
	// console.log(identifierName);
	// console.log(localVariables);

	// console.log(definedFunction.functionNode.value.loc);
	
	//(i) is identifierName a local variable?
	//update: (case) require() inside function declaration/expression
	//and use of variable that is assigned the result of a require() call
	//the identifier represents a usage of an imported element and, thus, should be considered
	for(var localVariableIndex = 0; localVariableIndex < localVariables.length; localVariableIndex++) {
		
		
		var localVariable = localVariables[localVariableIndex];
		if(localVariable.variableName === identifierName &&
		   isLocalVariableAssignedARequireCallResult(localVariable) === false) {
		
			//identifierName is included in localVariables' array
			//identifierName is local to definedFunction
			return true;
		
		}
	}

	// console.log(definedFunction.functionName);
	
	//(ii) is identifierName a functionProperty?
	var functionConstructorProperties = definedFunction.functionConstructorProperties;
	for(var propertyIndex = 0; propertyIndex < functionConstructorProperties.length; propertyIndex++) {
		
		var functionProperty = functionConstructorProperties[propertyIndex];
		if(functionProperty.propertyName === identifierName) {
			
//			console.log(definedFunction.functionName);
//			console.log(identifierName);
		
			//identifierName is included in functionConstructorProperties' array
			//identifierName is local to definedFunction
			return true;
		}
	}

	// console.log(definedFunction.functionName);
	
	//(iii) is identifierName a nested function?
	var nestedFunctions = definedFunction.nestedFunctions;
	for(var nestedFunctionIndex = 0; nestedFunctionIndex < nestedFunctions.length; nestedFunctionIndex++) {
		
		// console.log(nestedFunction);
		var nestedFunction = nestedFunctions[nestedFunctionIndex];
		if(nestedFunction.functionName === identifierName) {
		
			//identifierName is a function nested in definedFunction
			//identifierName is local to definedFunction
			return true;
		}
	}

	//(iv) is identifierName a function parameter?
	//case: what if identifier is a parameter of the function callback of require() or define()?
	//(1) 2nd parameter of require() is a function callback that takes the dependent modules as parameters
	//(2) 3rd parameter of define() is a function callback that takes the dependent modules as parameters
	
//	console.log(definedFunction.functionName);
	// console.log(identifierName);
////	console.log(identifier);
//	console.log(identifier.value.loc);
////	console.log(definedFunction.functionParameters);
//	console.log("\n");
	var isFunctionParameter = false;
	var functionParameters = definedFunction.functionParameters;
	// console.log(functionParameters);
	for(var functionParameterIndex = 0; functionParameterIndex < functionParameters.length; functionParameterIndex++) {
		
		var functionParameter = functionParameters[functionParameterIndex];
		// console.log(functionParameter.name + " " + identifierName);
		// console.log(functionParameter.name === identifierName);
		if(functionParameter.name === identifierName) {
		
			// console.log(definedFunction.functionName + " " + identifierName);
//			console.log(identifier.value.loc);
			
			//identifierName is included in functionParameter array
			//identifierName is local to definedFunction
			isFunctionParameter = true;
			break;
		}
	}
	
	// console.log(identifierName);
//	console.log();
	// console.log(identifier.loc);
	// console.log("functionParameter: " + isFunctionParameter);
//	console.log("\n\n");

// console.log(identifierName + " " + definedFunction.functionName + " " + isFunctionParameter);
	
	//identifierName is a function parameter
	//identifierName is local to definedFunction
	if(isFunctionParameter === true &&
	   isFunctionCallBackOfRequireOrDefine(definedFunction) === false) {
		
		return true;
	}
	
	//is identifier a property of a local-defined object?
	// if(isIdentifierAnObjectProperty(identifier) === true) {
		
	// 	//identifier is a property of a local-defined object
	// 	//identifier is defined locally in definedFunction
		
	// 	// console.log(identifierName + ' object property');
	// 	return true;
	// }
	
	//is identifier the name of definedFunction?
	if(definedFunction.functionName === identifierName) {
		
		return true;
	}
	
	// console.log(identifier.value.loc);
	// console.log(identifier.loc);
	// console.log(identifierName + " " + definedFunction.functionName);
//	console.log();
	
	// console.log(identifierName);
	// console.log(definedFunction.functionNode.value.loc);
	return false;
}

/**
 * Determines whether a local variable is assigned the result of a require call.
 * (Needed in cases when require() calls are met within function declarations/expressions).
 */
function isLocalVariableAssignedARequireCallResult(localVariable) {

	var calleeName;

	//initializationValueNode represents the expression, whose value is assigned to localVariable
	var initializationValueNode = localVariable.initializationValueNode;

	if(initializationValueNode !== null && 
	   initializationValueNode.type === 'CallExpression') {

		//the expression represents a function call
		calleeName = initializationValueNode.callee.name;

		if(calleeName === 'require') {

			//the expression represents a call to require()
			//resolved a require() call within a function declaration/expression
			return true;
		}
	}

	//localVariable is not assigned the result of a call to require()
	return false;
}

/**
 * Is function a callback of require() or define()?
 * @param definedFunction
 * @returns
 */
function isFunctionCallBackOfRequireOrDefine(definedFunction) {
	
	//(1) 2nd parameter of require() is a function callback that takes the dependent modules as parameters
	//(2) 3rd parameter of define() is a function callback that takes the dependent modules as parameters
	var parentNode = definedFunction.functionNode.parentPath.parentPath;
	
	// console.log(definedFunction.functionName);
	// console.log(definedFunction.functionNode.parentPath.parentPath.value.type);
	var parentNodeValue = parentNode.value;
	if(parentNodeValue.type === 'CallExpression') {
		
		//if parentNode represents a call statement
		//update: require() can be accessed with the name requirejs, too
		var calleeName = parentNodeValue.callee.name;
		if(calleeName === 'require' || calleeName === 'requirejs' || calleeName === 'define') {
			
			//if callee is require(), definedFunction is a callback of require() or define()
			return true;
		}
	}
	
	return false;
}

/**
 * Is identifier a property of an object?
 * @param identifier
 * @returns
 */
function isIdentifierAnObjectProperty(identifier) {
	
	// console.log(identifier.value.name);
	var parentNode = identifier.parentPath;
	if(parentNode === undefined) {

		return false;
	}
	var parentNodeValue = parentNode.value;
	var parentNodeValueType = parentNode.value.type;
	// console.log(parentNodeValueType);
	if(parentNodeValueType === 'MemberExpression') {
		
		//case: identifier is a property of an object different to window or this
		var accessedObject = parentNodeValue.object;

		// console.log(accessedObject);

		if(accessedObject.name !== 'window' &&
		   accessedObject.name !== 'this' &&
		   accessedObject.name !== identifier.value.name) {
			
			//case: identifier is not the accessed object of a member expression
			//identifier may not represent a global variable usage
			return true;
		}
	}
	else if(parentNodeValueType === 'Property') {
		
		//case: identifier is a property of an object literal
		var grandParent = parentNode.parentPath.parentPath.value;
		
		if(grandParent.type === 'ObjectExpression') {
			
			return true;
		}
	}

	return false;
}

/**
 * Determines whether usedElement corresponds to a function definition (needed in the metric
 * assessment procedure).
 * @param usedElement 
 */
function isUsedElementAFunction(usedElement) {

	var usedElement;
	var elementDeclarationNode;
	var declarations;
	var declarationIndex;
	var declaration;

	// console.log(usedElement);

	//retrieve the AST node representing the definition of imported element
	elementDeclarationNode = usedElement.elementDeclarationNode;

	if(elementDeclarationNode === undefined || elementDeclarationNode === null) {

		//case: usedElement represents the value exported from a module defined using a way different to a call to define
		//(i.e. IIFE, case: jquery)
		return;
	}

	// console.log(elementDeclarationNode.type);
	if(elementDeclarationNode.type === 'FunctionExpression' || elementDeclarationNode.type === 'FunctionDeclaration') {

		//usedElement is defined using a FunctionExpression or a FunctionDeclaration AST node
		return true;
	}
	else if(elementDeclarationNode.type === 'VariableDeclaration') {

		//usedElement is defined using a VariableDeclaration AST node-
		//is it initialized with a FunctionExpression AST node?
		declarations = elementDeclarationNode.declarations;

		for(declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {

			declaration = declarations[declarationIndex];
			// console.log(declaration.init.type);
			if(declaration.init.type === 'FunctionExpression') {

				//usedElement is initialized with a FunctionExpression AST node
				//no need to process the other declarations
				return true;
			}

		}

	}

	//usedElement is not initialized with an AST node representing a function definition
	return false;
}

/**
 * Returns true if secondFunction is a property of firstFunction.
 * @param firstFunction
 * @param secondFunction
 * @returns
 */
function isFunctionPropertyOfFunction(firstFunction, secondFunction) {
	
	var firstFunctionConstructorProperties = firstFunction.functionConstructorProperties;
	for(var propertyIndex = 0; propertyIndex < firstFunctionConstructorProperties.length; propertyIndex++) {
		
		var functionProperty = firstFunctionConstructorProperties[propertyIndex];
		
		//functionNode corresponding to secondFunction is assigned
		//to a property of firstFunction
		if(functionProperty.propertyDefinitionNode === secondFunction.functionNode.value) {
			
			return true;
		}
	}
	
	return false;
}

/**
 * Returns true if secondFunction is nested in firstFunction.
 */
function isFunctionNestedInFunction(firstFunction, secondFunction) {
	
	var firstFunctionNestedFunctions = firstFunction.nestedFunctions;
	for(var nestedFunctionIndex = 0; nestedFunctionIndex < firstFunctionNestedFunctions.length; nestedFunctionIndex++) {
		
		var nestedFunction = firstFunctionNestedFunctions[nestedFunctionIndex];
		
		//secondFunction is nested in firstFunction
		if(nestedFunction.functionNode === secondFunction.functionNode) {
			
			return true;
		}
	}
	
	return false;
}

/**
 * Returns true if firstFunction and secondFunction are declared 
 * within the same function of sourceFile, otherwise false.
 * @param sourceFile
 * @param firstFunction
 * @param secondFunction
 * @returns
 */
function areFunctionsDeclaredWithinTheSameFunction(sourceFile, firstFunction, secondFunction) {
	
//	console.log(firstFunction.functionName + " " + secondFunction.functionName);
//	console.log(firstFunction.functionScope === secondFunction.functionScope);
	
	var firstFunctionScope = firstFunction.functionScope;
	var secondFunctionScope = secondFunction.functionScope;
	var enclosingScopeOfFirstFunction = null;
	var enclosingScopeOfSecondFunction = null;
	var objectLiteralContainingFirstFunction = null;
	var objectLiteralContainingSecondFunction = null;
	
//	console.log(firstFunction.functionName);
//	console.log(firstFunctionScope);
//	console.log();
//	console.log(secondFunction.functionName);
//	console.log(secondFunctionScope);
//	console.log(firstFunctionScope === secondFunctionScope);
//	console.log();
//	console.log();
	
	//the two functions share the same scope
	if(firstFunctionScope === secondFunctionScope) {
		
		//cases: function properties, function expressions (includes function expressed inside objects), function declarations
//		console.log(firstFunction.functionNode.value.type + " " + secondFunction.functionNode.value.type);
		
//		console.log(firstFunction.functionName);
//		console.log(firstFunctionScope);
//		console.log();
//		console.log(secondFunction.functionName);
//		console.log(secondFunctionScope);
		
		//case: 2 functions declared at the global scope of module
		//do not take these cases into account
		if(firstFunctionScope === null) {
			
			return false;
		}
		
		var firstFunctionType = firstFunction.functionNode.value.type;
		var secondFunctionType = secondFunction.functionNode.value.type;
		
//		console.log(firstFunctionType + " " + secondFunctionType);
		
		//both functions are declared using FunctionDeclaration statements in the same scope
		//these functions may share instance variables
//		if(firstFunctionType === 'FunctionDeclaration' && secondFunctionType === 'FunctionDeclaration') {
//			
//			return true;
//		}
		
//		console.log(firstFunction.functionName + " " + secondFunction.functionName);
		
		if(firstFunctionType === 'FunctionExpression') {
			
			//firstFunction is declared using a FunctionExpression statement
			//check if firstFunction is defined within an object literal inside firstFunctionScope
			
//			console.log(sourceFile.definedFunctions);
//			console.log();
//			console.log(firstFunctionScope.functionNode);
			
//			console.log(firstFunctionScope);
			
//			sourceFile.retrieveDefinedFunctionByNode(firstFunctionScope.functionNode.value);
			
			enclosingScopeOfFirstFunction = sourceFile.retrieveDefinedFunctionByNode(firstFunctionScope.functionNode.value);
			
//			console.log(enclosingScopeOfFirstFunction);
			
			objectLiteralContainingFirstFunction = retrieveObjectLiteralContainingFunctionDefinition(enclosingScopeOfFirstFunction, firstFunction);
			
//			console.log(objectLiteralContainingFirstFunction);
		}
		
		
		if(secondFunctionType === 'FunctionExpression') {
			
			//secondFunction is declared using a FunctionExpression statement
			//check if secondFunction is defined within an object literal inside secondFunctionScope
			
			enclosingScopeOfSecondFunction = fileUtilities.retrieveDefinedFunctionByNode(sourceFile.definedFunctions, secondFunctionScope.functionNode.value);
			
//			console.log(enclosingScopeOfSecondFunction);
			
			objectLiteralContainingSecondFunction = retrieveObjectLiteralContainingFunctionDefinition(enclosingScopeOfSecondFunction, secondFunction);
			
//			console.log(objectLiteralContainingSecondFunction);
			
		}
		
//		console.log(firstFunction.functionName + " " + secondFunction.functionName);
//		console.log(objectLiteralContainingFirstFunction);
//		console.log(objectLiteralContainingSecondFunction);
//		console.log(objectLiteralContainingFirstFunction !== objectLiteralContainingSecondFunction);
		
		if(objectLiteralContainingFirstFunction !== objectLiteralContainingSecondFunction) {
			
			return false;
		}
		
//		console.log(objectLiteralContainingFirstFunction);
//		console.log(objectLiteralContainingSecondFunction);
//		console.log(firstFunction.functionNode.value.type + " " + secondFunction.functionNode.value.type);
	}
	else {
		
		return false;
	}
	
	return true;
}

/**
 * Returns the object literal containing the definition of declaredFunction if it exists,
 * otherwise null.
 * @param declaredFunction
 * @returns
 */
function retrieveObjectLiteralContainingFunctionDefinition(definitionFunction, declaredFunction) {
	
//	console.log(definitionFunction.functionName + " " + declaredFunction.functionName);
	
	var definitionFunctionRootCollection = jscodeshift(definitionFunction.functionNode);
	
	//declaredFunction: function nested in definitionFunction
	var objectExpressions = definitionFunctionRootCollection.find(jscodeshift.ObjectExpression);
	
	//is declaredFunction defined within an object literal of definitionFunction?
	for(var objectExpressionIndex = 0; objectExpressionIndex < objectExpressions.length; objectExpressionIndex++) {
		
		var objectExpression = objectExpressions[objectExpressionIndex];
		
		//get properties of current literal
		var properties = objectExpression.value.properties;
		
		//check if declaredFunction corresponds to the value
		//of a property of the object literal represented by objectExpression
		for(var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
			
			var objectProperty = properties[propertyIndex];
			if(objectProperty.value === declaredFunction.functionNode.value) {
			
				return objectExpression;
			}
		}
	}
	
	return null;
}

/**
 * Retrieves the implied global variables created in inputFile (using jshint).
 * @param {*} inputFile 
 * @param {*} inputFiles 
 */
function retrieveImpliedGlobalsOfSourceFile(inputFile, inputFiles) {

	// console.log(inputFile.fileName)
	if(inputFile.moduleType === enums.ModuleType.library) {

		return false;
	}

	//an implied global is created when a value is assigned to it
	//impliedGlobalCreationStatements will store the AST nodes representing these assignments
	let impliedGlobalsOfModule = [];
	let statementCollection;
	let impliedGlobalVariable;

	let source = inputFile.astRootCollection.toSource();

	//parameterize request to JSHint API (v2.x)
	//search for implied globals (undefined variables)
	//and do not limit response to the first errors
	let options = {

		globals: true,
		undef : true,
		maxerr: global.Infinity
	};

	// console.log(inputFile.moduleFramework.includes(enums.ModuleFramework.plain) === true);

	//predef: the objects that are implicitly (in other JS files) defined in the environment
	let predef = {};

	if(inputFile.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

		predef.module = true;
		predef.exports = true;
		predef.require = true;
		predef.console = true;
		predef.document = true;
		predef.window = true;
		predef.global = true;
		predef.__dirname = true;

	}
	else {

		//in the case that the module has top-level declarations,
		//add top-level scope variables and functions (names) in the predef option
		inputFiles.buckets.forEach(fileList => {

			fileList.filter(file => {

				return file[1] !== inputFile;

			}).forEach(sourceFile => {

				let explicitGlobals = sourceFile[1].explicitGlobals.filter(explicitGlob => {

					return explicitGlob.isExported === true;
				});
				
				explicitGlobals.forEach(explicitGlobal => {

					// console.log(sourceFile.fileName + " " + explicitGlobal.variableName + " " + explicitGlobal.isExported);
					// console.log(explicitGlobal.variableDeclarationNode.parentPath.value instanceof Array);

					//exclude top-level variables from implied global set
					predef[explicitGlobal.variableName] = true;
				});

				let definedFunctions = sourceFile[1].definedFunctions.filter(definedFunction => {

					return definedFunction.functionScope === null &&
							definedFunction.isExported === true;
				});

				definedFunctions.forEach(definedFunction => {

					//exclude functions comprising the right operands of assignments
					//from top-level scope functions
					
					// console.log(sourceFile.fileName + " " + definedFunction.functionName);
					predef[definedFunction.functionName] = true;
				});
			});
		});

		// console.log(inputFile.moduleFramework)
		if(inputFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

			//inputFile is implemented using AMD
			//add define/require/requirejs in the predef option
			predef.$ = true;
			predef.define = true;
			predef.require = true;
			predef.requirejs = true;
			predef.window = true;
		}
		else {

			predef.$ = true;
			predef.window = true;
		}
	}

	//add language builtin objects from dictionaries
	reservedWords.globalObjectBuiltInProperties.forEach(globalObjProp => {

		predef[globalObjProp] = true;
	});

	reservedWords.DOMBuiltinObjects.forEach(domObj => {

		predef[domObj] = true;
	});

	reservedWords.esBuiltinObjects.forEach(esObj => {

		predef[esObj] = true;
	});

	reservedWords.testBuiltinObjects.forEach(testObj => {

		predef[testObj] = true;
	});

	//update: the definition module of an implied global is not determined
	//during analysis, but right before the refactoring (MDG traversal) -
	//its definition is located in the module with the minimum fan-out
	//however, update impliedGlobal with the fact that is assigned a value

	// console.log(predef);

	jshint(source, options, predef);
	let impliedGlobals = jshint.data().implieds;

	if(impliedGlobals == null || impliedGlobals.length === 0) {

		console.log(`File ${inputFile.fileName} does not contain implied globals. Resuming to module code hierarchy retrieval.`)

		inputFile.updateImpliedGlobals([]);
		return false;
	}

	// console.log(jshint.data())

	let jshintResultFilePath = './resultFiles/' + inputFile.fileName.replace(/\\/g, '_').replace(/:/g, '') + '_implieds.json';
	
	//prevent circular dependencies (Graphr)
	let jsonCache = [];
	// let jsonContent = JSON.stringify(jshint.data(), (key, value) => {

	// 	if (typeof value === 'object' && value !== null) {
			
	// 		if (jsonCache.includes(value) === true) {

	// 			return;
	// 		}
		
	// 		jsonCache.push(value);
	// 	}
		  
	// 	return value;
	// });

	let jsonContent = JSON.stringify(jshint.data(), null, 4);

	fs.writeFileSync(jshintResultFilePath, jsonContent, 'utf-8');

	// fs.writeFileSync(jshintResultFilePath, JSON.stringify(jsonContent, null, 4), 'utf-8');

	console.log('Generated ' + jshintResultFilePath);

	//no implieds found
	// if(impliedGlobals === undefined) {

	// 	inputFile.updateImpliedGlobals([]);
	// 	return false;
	// }

	impliedGlobals.forEach(impliedGlobal => {

		if(reservedWords.ReservedWords.includes(impliedGlobal.name) === true) {

			//implied global's name is a reserved word
			return;
		}

		// console.log(impliedGlobal);

		//retrieve the closest statement containing the definition of impliedGlobal (its first reference)-
		//needed in order to introduce the declaration of impliedGlobal right before it
		//(exclude block statements, call expressions etc)
		let impliedGlobalName = impliedGlobal.name;
		let impliedGlobalLines = impliedGlobal.line;

		//an implied global might be used before its definition statement
		impliedGlobalLines.forEach(impliedGlobalLine => {

			let impliedGlobalDefIds = inputFile.astRootCollection.find(jscodeshift.Identifier).filter(id => {

				return id.value.name === impliedGlobalName && id.value.loc.start.line === impliedGlobalLine;
			});
	
			if(impliedGlobalDefIds.length === 0) {
	
				return;
			}
	
			let impliedGlobalDefId = impliedGlobalDefIds.at(0).get();
			statementCollection = jscodeshift(impliedGlobalDefId).closest(jscodeshift.Statement);
	
			// console.log(`stmts: ${statementCollection.length}`);
			if(statementCollection.length === 0) {
	
				//statement is not found
				return;
			}
	
			let creationStatement = statementCollection.at(0).get();

			// console.log(creationStatement)
			//implied referenced in a call expression
			//(not a definition)
			if(creationStatement.value.type === 'ExpressionStatement' &&
				creationStatement.value.expression.type === 'CallExpression') {

				return;
			}
	
			//consider all implied globals
			//the variables defined in inputFile are filtered
			//after the implieds of all modules are retrieved
			//however, update impliedGlobal with the fact that it is assigned
			impliedGlobalVariable = new ImpliedGlobalVariable.ImpliedGlobalVariable(impliedGlobalName);
			impliedGlobalVariable.updateCreationStatement(creationStatement);
			impliedGlobalVariable.updateIsAssigned();

			//add implied global object once (prevent duplicates)
			if(impliedGlobalsOfModule.some(impliedGlob => {

				return impliedGlob.variableName === impliedGlobalVariable.variableName;

			}) === false) {

				impliedGlobalsOfModule.push(impliedGlobalVariable);
			}

		});

	});

	inputFile.updateImpliedGlobals(impliedGlobalsOfModule);
	// console.log(inputFile.fileName + " " + inputFile.impliedGlobals.length);
	// console.log(inputFile.impliedGlobals);

	return true;
}

/**
 * Retrieves properties defined within object specified in objectLiteral, 
 * through analyzing the statement that returns it (specified in objectExpressionASTNode)
 * (Applies to AMD modules).
 * @param {*} objectLiteral 
 * @param {*} returnStatementArgumentNode 
 */
function retrievePropertiesOfObjectLiteral(objectLiteral, objectExpressionASTNode) {

	let objectProperties = [];
	let objectExpressionProperties = objectExpressionASTNode.properties;
	objectExpressionProperties.forEach(function(objectExpressionProperty) {

		let propertyKey = objectExpressionProperty.key;
		let propertyName = propertyKey.type === 'Identifier' ? propertyKey.name : propertyKey.value;

		//initialize object property
		let objectProperty = new ObjectProperty.ObjectProperty(propertyName, objectExpressionProperty);
		objectProperties.push(objectProperty);
	});

	// console.log(objectProperties);
	objectLiteral.updateObjectProperties(objectProperties);
}

// /**
//  * Retrieves the properties bound to the variable definition specified in explicitGlobal
//  * (applies to CommonJS modules).
//  * Also, for each property, it retrieves its usages (through finding references to the variable
//  * either through the variable itself or to 'this' inside a method property).
//  * Notice: cannot be merged with retrievePropertiesOfFunction (see below).
//  * @param {*} explicitGlobal 
//  */
// function retrievePropertiesOfVariable(sourceFile, explicitGlobal) {

// 	// console.log(sourceFile.fileName);
// 	// console.log(explicitGlobal.variableName);

// 	//search properties of explicitGlobal, regardless of the fact that 
// 	//explicitGlobal is not initialized with an object literal
// 	//(retrieve the properties bound to its prototype)

// 	//sourceFile holds a property determining if its is a component or test module
// 	//(need to find object properties only in component modules)
// 	if(sourceFile.moduleType === enums.ModuleType.testFile) {

// 		return;
// 	}

// 	let isObjectReferenced = false;

// 	ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

// 	let astRootCollection = sourceFile.astRootCollection;
// 	let variableName = explicitGlobal.variableName;
// 	let variableDeclarationNode = explicitGlobal.variableDeclarationNode;
// 	let declarations = variableDeclarationNode.value.declarations;

// 	// let declarationStart = null;
// 	// let declarationEnd = null;

// 	// console.log(variableDeclarationNode);

// 	//for each variable declaration (notice, 1 variable declaration may define multiple definitions)
// 	//retrieve its properties through (a) detecting explicit properties inside the object that is assigned to the variable or
// 	// (b) resolving its uses (in the case that they are bound to the variable) or (c) a combination of (a), (b)
// 	declarations.forEach(function(declaration) {

// 		// console.log(declaration.id.range);

// 		let declarationStart = declaration.id.range[0];
// 		let declarationEnd = declaration.id.range[1];

// 		if(declarationStart === null || declarationEnd === null) {

// 			//no range resolved - abort
// 			return;
// 		}

// 		// console.log(declaration);

// 		let objectProperties = [];

// 		//also, resolve properties bound to the object's prototype (case b)
// 		//separate them from objectProperties
// 		let objectPrototypeProperties = [];

// 		//(a) resolve properties bound to variable once it is defined 
// 		//(properties defined within its initialization value)
// 		let initValueNode = declaration.init;
		
// 		// console.log(initValueNode);

// 		if(initValueNode !== null && initValueNode.type === 'ObjectExpression') {

// 			let initializationValueProperties = initValueNode.properties;

// 			initializationValueProperties.forEach(function(initializationValueProperty) {

// 				// console.log(initializationValueProperty);

// 				//a property's name may be either a literal (a string) or an identifier
// 				let propertyName = initializationValueProperty.key.type === 'Identifier' ? initializationValueProperty.key.name : initializationValueProperty.key.value;

// 				let objectProperty = new ObjectProperty.ObjectProperty(propertyName, initializationValueProperty);

// 				let existentProperties = objectProperties.filter(function(currentObjectProperty) {

// 					return currentObjectProperty.propertyName === objectProperty.propertyName;
// 				});

// 				// console.log(existentProperties.length);

// 				if(existentProperties.length === 0) {

// 					//there does not exist such property
// 					//add objectProperty to array
// 					objectProperties.push(objectProperty);
// 				}
// 			});
// 		}

// 		// console.log(objectProperties.length);

// 		//(b) resolve uses of declaration (in order to resolve properties bound to declaration)
// 		let requestDetails = {
// 			query: {
// 				type: "refs",
// 				file: sourceFile.fileName,
// 				start: declarationStart,
// 				end: declarationEnd
// 			}
// 		};
	
// 		let referenceRanges = [];
// 		ternServer.request(requestDetails, function(error, success){
			
// 			// console.log(error);
// 			// console.log(success);
	
// 			if(error != null) {
	
// 				return;
// 			}
	
// 			//retrieve the ranges of the usages (references) of variable
// 			referenceRanges = success.refs.map(reference => {
	
// 				return {
	
// 					start: reference.start,
// 					end: reference.end
// 				};
// 			});
// 		});

// 		// console.log(referenceRanges.length);

// 		//exclude declaration references included in the variable's definition statement
// 		referenceRanges = referenceRanges.filter(function(referenceRange) {

// 			return referenceRange.start !== declarationStart && referenceRange.end !== declarationEnd;
// 		});

// 		//for each reference, retrieve the member expression containing it 
// 		//(the complete reference to the property: ternjs returns the reference to the property identifier without the object)
// 		//find identifier represented by reference and then retrieve its parent (prevent confusion in cases when multiple property references are used)
// 		let propertyReference;
// 		let propertyReferenceMemberExpressions = [];

// 		// console.log(sourceFile.fileName);
// 		// console.log(referenceRanges.length);

// 		let objectReferenceIdentifiers = referenceRanges.map(referenceRange => {

// 			//retrieve the identifiers pointed by ternjs query result (find refs of variable in the AST)
// 			let referenceIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(identifier => {

// 				// console.log(identifier);
// 				return identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end;
// 			});

// 			// console.log(declaration);
// 			// console.log(referenceIdentifiers.length);

// 			if(referenceIdentifiers.length === 0) {

// 				//no references found - abort
// 				return null;
// 			}

// 			return referenceIdentifiers.at(0).get();
// 		});

// 		//remove null array values
// 		objectReferenceIdentifiers = objectReferenceIdentifiers.filter(objectReference => {

// 			return objectReference !== null;
// 		});
		
// 		referenceRanges.forEach(function(referenceRange) {

// 			// console.log(referenceRange);
// 			//retrieve the identifiers pointed by ternjs query result (find refs of variable in the AST)
// 			let referenceIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(identifier => {

// 				// console.log(identifier);
// 				return identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end;
// 			});

// 			// console.log(declaration);
// 			// console.log(referenceIdentifiers.length);

// 			if(referenceIdentifiers.length === 0) {

// 				//no references found - abort
// 				return;
// 			}

// 			let propertyReferenceMemberExpression = referenceIdentifiers.at(0).get().parentPath;
// 			if(propertyReferenceMemberExpression.value.type !== 'MemberExpression') {

// 				//the retrieved identifier is not located within a member expression - abort
// 				// console.log(propertyReferenceMemberExpression.value.loc)
// 				// console.log(propertyReferenceMemberExpression.value.type);
// 				isObjectReferenced = true;
// 				return;
// 			}

// 			// console.log(propertyReferenceMemberExpression.value)
// 			let objectPropertyIdentifier;
// 			let isPrototypeProperty = false;
// 			let propertyDefinitionNode;
// 			if(propertyReferenceMemberExpression.value.property.type === 'Identifier' && propertyReferenceMemberExpression.value.property.name === 'prototype') {

// 				//property is bound to prototype (its name is the property bound to propertyReferenceMemberExpression)
// 				isPrototypeProperty = true;
// 				propertyDefinitionNode = propertyReferenceMemberExpression.parentPath;
// 				explicitGlobal.updateIsInitializedWithFunctionConstructor(true);
				
// 			}
// 			else {

// 				propertyDefinitionNode = propertyReferenceMemberExpression;
// 			}

// 			// console.log(propertyDefinitionNode.value)
// 			objectPropertyIdentifier = propertyDefinitionNode.value.property;

// 			if(objectPropertyIdentifier === undefined || objectPropertyIdentifier.type !== 'Identifier' || propertyDefinitionNode.parentPath.value.type !== 'AssignmentExpression') {

// 				//object property is not defined in the object's prototype
// 				return;
// 			}

// 			// console.log(propertyReferenceMemberExpression.value.type);

// 			// console.log(propertyReferenceMemberExpression.value);

// 			// console.log(referenceIdentifiers.at(0).get());

// 			// console.log(propertyDefinitionNode.value);
// 			let objectProperty = new ObjectProperty.ObjectProperty(objectPropertyIdentifier.name, propertyDefinitionNode.parentPath.value);
// 			if(isPrototypeProperty === true) {

// 				let existentPrototypeProperties = objectPrototypeProperties.filter(function(currentObjectProperty) {

// 					return currentObjectProperty.propertyName === objectProperty.propertyName;
// 				});

// 				// console.log(objectProperty)
	
// 				// console.log(existentProperties.length);
	
// 				if(existentPrototypeProperties.length === 0) {
	
// 					//there does not exist such property
// 					//add objectProperty to array
// 					objectPrototypeProperties.push(objectProperty);
// 				}
// 			}
// 			else {

// 				let existentProperties = objectProperties.filter(function(currentObjectProperty) {

// 					return currentObjectProperty.propertyName === objectProperty.propertyName;
// 				});
	
// 				// console.log(existentProperties.length);
	
// 				if(existentProperties.length === 0) {
	
// 					//there does not exist such property
// 					//add objectProperty to array
// 					objectProperties.push(objectProperty);
// 				}
// 			}
			
// 		});

// 		explicitGlobal.updateIsObjectReferenced(isObjectReferenced);

// 		// console.log(objectProperties.length);

// 		//for each object or prototype property, retrieve its uses
// 		objectProperties.forEach(function(objectProperty) {

// 			let propertyUsages = retrieveUsesOfProperty(sourceFile, objectProperty, objectReferenceIdentifiers);

// 			//update the reference array of objectProperty
// 			objectProperty.updateObjectPropertyUsages(propertyUsages);
// 		});

// 		objectPrototypeProperties.forEach(function(prototypeProperty) {

// 			// console.log(prototypeProperty);
// 			let propertyUses = retrieveUsesOfProperty(sourceFile, prototypeProperty, objectReferenceIdentifiers);

// 			//update the reference array of prototypeProperty
// 			prototypeProperty.updateObjectPropertyUsages(propertyUses);
// 		});

// 		// console.log(objectPrototypeProperties.length);

// 		explicitGlobal.updateObjectProperties(objectProperties);

// 		explicitGlobal.updatePrototypeProperties(objectPrototypeProperties);

// 		// if(objectPrototypeProperties.length > 0) {

// 		// 	//properties are assigned to the object prototype
// 		// 	//object is likely to be used in a hierarchy
// 		// 	explicitGlobal.updateIsInitializedWithFunctionConstructor(true);
// 		// }
// 	});

// 	ternServer.delFile(sourceFile.fileName);

// 	// console.log(explicitGlobal);
// }

/**
 * Retrieves the properties bound to the function definition specified in definedFunction.
 * Also, for each property, it retrieves its usages (through finding references to the function object
 * either through the function object itself or to 'this' inside a method property).
 * Notice: cannot be merged with retrievePropertiesOfVariable 
 * (tern cannot find references of function, it yields an error since it
 * is not provided the range of a variable/property)
 * Update: it CAN be merged
 * (tern can find references of function, if the variable name field
 * is added in the query)
 * @param {*} definedFunction 
 */
function retrievePropertiesOfFunction(sourceFile, definedFunction) {

	// console.log(sourceFile.fileName + " " + definedFunction.functionName);

	let isObjectReferenced = false;

	//sourceFile holds a property determining if its is a component or test module
	//(need to find function properties only in component modules)
	if(sourceFile.moduleType === enums.ModuleType.testFile) {

		return;
	}

	let functionName = definedFunction.functionName;

	let astRootCollection = sourceFile.astRootCollection;

	//functionProperties: properties bound to the function (syntax: <functionName>.<identifier> = <initialization_value>)
	let functionProperties = [];

	//properties bound to the function's prototype (syntax: <functionName>.prototype.<propertyIdentifier> = <initialization_value>)
	let functionPrototypeProperties = [];
	let parentPath;
	let functionIdentifierStart = null;
	let functionIdentifierEnd = null;
	let leftOperand;

	// console.log(definedFunction.functionName);

	if(definedFunction.functionName === 'topLevelScope') {

		//topLevelScope is an artificial node that models top-level scope
		return;
	}

	ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

	//retrieve uses (calls) of definedFunction in sourceFile
	// console.log(definedFunction.functionNode.value);
	// console.log(definedFunction.functionName);

	//retrieve definedFunction's name identifier location, according to the AST node's type
	if(definedFunction.functionNode.value.type === 'FunctionExpression') {

		parentPath = definedFunction.functionNode.parentPath;
		if(parentPath.value.type === 'AssignmentExpression') {

			//syntax: <expression> = <function_expression>
			leftOperand = parentPath.value.left;

			if(leftOperand.type === 'Identifier') {

				functionIdentifierStart = leftOperand.range[0];
				functionIdentifierEnd = leftOperand.range[1];
			}
			else if(leftOperand.type === 'MemberExpression') {

				functionIdentifierStart = leftOperand.property.range[0];
				functionIdentifierEnd = leftOperand.property.range[leftOperand.property.range.length-1];
			}

			// console.log(leftOperand);
			// console.log(functionIdentifierEnd);
		}
	}
	else if(definedFunction.functionNode.value.type === 'FunctionDeclaration') {

		functionIdentifierStart = definedFunction.functionNode.value.id.range[0];
		functionIdentifierEnd = definedFunction.functionNode.value.id.range[1];
	}

	// console.log(functionIdentifierStart + " " + functionIdentifierEnd);

	if(functionIdentifierStart === null || functionIdentifierEnd === null) {

		//the function's location in the AST is null (do not proceed)
		return;
	}

	// find references of identifier through a query in ternjs
    let requestDetails = {
        query: {

            type: "refs",
			file: sourceFile.fileName,
			end: functionIdentifierEnd,
			start: functionIdentifierStart
			// variable: definedFunction.functionName
		}
	};

	let referenceRanges = [];
	ternServer.request(requestDetails, function(error, success){
			
		// console.log(error);
		// console.log(success);
	
		if(error != null) {
	
			return;
		}
	
		//retrieve the ranges of the usages (references) of variable
		referenceRanges = success.refs;

		// referenceRanges = success.refs.map(reference => {
	
		// 	return {
	
		// 		start: reference.start,
		// 		end: reference.end
		// 	};
		// });
	});

	//do not search references that model the function's definition
	referenceRanges = referenceRanges.filter(referenceRange => {

		return referenceRange.start !== functionIdentifierStart && 
			   referenceRange.end !== functionIdentifierEnd;
	});

	// console.log(referenceRanges.length)
	// console.log(referenceRanges);

	//ternjs retrieves the ranges of the function's references
	//retrieve these uses in the AST provided by jscodeshift
	let referenceIdentifiers = [];
	referenceRanges.forEach(referenceRange => {

		// console.log(referenceRange);
		let usageIdentifiers = sourceFile.astRootCollection.find(jscodeshift.Identifier).filter(usageIdentifier => {

			// if(usageIdentifier.value.name === definedFunction.functionName) {

			// 	console.log(usageIdentifier.value.range);
			// }

			// console.log( require.resolve(referenceRange.file) === require.resolve(sourceFile.fileName) &&
			// usageIdentifier.value.range[0] === referenceRange.start && 
			// usageIdentifier.value.range[1] === referenceRange.end)

			let isFunctionAssignedToExportsModuleExports = false;

			let parentNode = usageIdentifier.parentPath;
			while(parentNode !== null) {

				if(parentNode.value.type && parentNode.value.type === 'AssignmentExpression') {

					break;
				}

				parentNode = parentNode.parentPath;
			}

			if(parentNode !== null && (parentNode.value.type === 'AssignmentExpression' && 
			  (parentNode.value.left.type === 'MemberExpression' && parentNode.value.left.object.type === 'Identifier' && parentNode.value.left.object.name === 'module'
			   && parentNode.value.left.property.type === 'Identifier' && parentNode.value.left.property.name === 'exports') ||
			  (parentNode.value.left.type === 'Identifier' && parentNode.value.left.name === 'exports') ||
			  (parentNode.value.left.type === 'MemberExpression' && parentNode.value.left.object.type === 'Identifier' && parentNode.value.left.object.name === 'exports'))) {

				isFunctionAssignedToExportsModuleExports = true;
				return false;
			}
			
			//ternjs may not retrieve the function's properties soundly
			//consider uses of function, but not within the function's definition (also, do not consider assignments to exports/module.exports)
			return (require.resolve(referenceRange.file) === require.resolve(sourceFile.fileName) &&
				   usageIdentifier.value.range[0] === referenceRange.start && 
				   usageIdentifier.value.range[1] === referenceRange.end) || 
				   (definedFunction.functionName === usageIdentifier.value.name && 
					usageIdentifier.value.range[0] !== functionIdentifierStart &&
					usageIdentifier.value.range[1] !== functionIdentifierEnd);
		});

		// console.log(referenceRange);
		// console.log(usageIdentifiers);
		if(usageIdentifiers.length === 0) {

			return null;
		}

		for(let identifierIndex = 0; identifierIndex < usageIdentifiers.length; identifierIndex++) {

			let usageIdentifier = usageIdentifiers.at(identifierIndex).get();
			if(referenceIdentifiers.indexOf(usageIdentifier) < 0) {

				referenceIdentifiers.push(usageIdentifier);
				return;
			}
		}
	});

	// let referenceIdentifiers = referenceRanges.map(referenceRange => {

	// 	console.log(referenceRange);
	// 	let usageIdentifiers = sourceFile.astRootCollection.find(jscodeshift.Identifier).filter(usageIdentifier => {

	// 		if(usageIdentifier.value.name === definedFunction.functionName) {

	// 			console.log(usageIdentifier.value.range);
	// 		}

	// 		// console.log( require.resolve(referenceRange.file) === require.resolve(sourceFile.fileName) &&
	// 		// usageIdentifier.value.range[0] === referenceRange.start && 
	// 		// usageIdentifier.value.range[1] === referenceRange.end)
			
	// 		return (require.resolve(referenceRange.file) === require.resolve(sourceFile.fileName) &&
	// 			   usageIdentifier.value.range[0] === referenceRange.start && 
	// 			   usageIdentifier.value.range[1] === referenceRange.end);
	// 	});

	// 	// console.log(referenceRange);
	// 	// console.log(usageIdentifiers.length);
	// 	if(usageIdentifiers.length === 0) {

	// 		return null;
	// 	}

	// 	return usageIdentifiers;
	// });

	// console.log(referenceIdentifiers.length)

	// referenceIdentifiers = referenceIdentifiers.filter(referenceIdentifier => {

	// 	return referenceIdentifier !== null;
	// });

	// console.log(referenceIdentifiers.length)

	referenceIdentifiers.forEach(referenceIdentifier => {

		// console.log(functionIdentifierStart + " " + functionIdentifierEnd);

		//each reference identifier may be within a function's property definition
		//(function property definition syntax: (<functionName> | <this>).<propertyName> = <initializationValue>)
		let parentNode = referenceIdentifier.parentPath;

		// console.log(parentNode.value.type)
		if(referenceIdentifier.value.name === definedFunction.functionName && 
		   parentNode.value.type !== 'MemberExpression') {

			// console.log(parentNode.value.type)
			if(parentNode.value.type === 'AssignmentExpression') {

				let exportObjRefs = jscodeshift(parentNode).find(jscodeshift.Identifier).filter(identifier => {

					return identifier.value.name === 'exports';
				});

				// console.log(exportObjRefs.length);
				if(exportObjRefs.length > 0) {

					isObjectReferenced = false;
					return;
				}

				exportObjRefs = jscodeshift(parentNode).find(jscodeshift.MemberExpression).filter(memberExpression => {

					return memberExpression.object.type === 'Identifier' && memberExpression.object.name === 'module' &&
						   memberExpression.property.type === 'Identifier' && memberExpression.property.name === 'exports';
				});

				// console.log(exportObjRefs.length);
				if(exportObjRefs.length > 0) {

					isObjectReferenced = false;
					return;
				}
			}

			if(parentNode.value.type === 'NewExpression' ||
			parentNode.value.type === 'CallExpression') {

				//reference inside an invocation or a new expression
				//not object referenced (e.g. iterated)
				isObjectReferenced = false;
				return;
			}

			//reference not in a member expression - proceed to the next reference
			// console.log(parentNode.value.type)
			// console.log(parentNode.value)
			isObjectReferenced = true;
			return;
		}
		else if((parentNode.parentPath.value.type === 'MemberExpression' && 
				parentNode.parentPath.value.object.type === 'MemberExpression' &&
				parentNode.parentPath.value.object.property.type === 'Identifier' && 
				(parentNode.parentPath.value.object.property.name !== 'prototype' &&
				 parentNode.parentPath.value.object.property.name !== definedFunction.functionName)) ||
				parentNode.value.type !== 'MemberExpression') {

				//reference within member expression,
				//but the expression's object is a property of definedFunction (nested property)
				//definedFunction's properties are resolved, not its properties' properties
				return;
		}

		//reference in a member expression - along with its name, 
		//find out whether it is a prototype or an object expression
		let isPrototypeProperty = false;
		let propertyName;
		while(parentNode.value.type === 'MemberExpression') {

			if(parentNode.value.property.type === 'Identifier') {

				if(parentNode.value.property.name === 'prototype') {

					isPrototypeProperty = true;
				}
				
				propertyName = parentNode.value.property.name;
			}
			else if(parentNode.value.type === 'Literal') {

				propertyName = parentNode.value.property.value;
			}

			parentNode = parentNode.parentPath;
		}

		// console.log(propertyName);
		// console.log(parentNode.value);

		if(parentNode.value.type !== 'AssignmentExpression') {

			//property not assigned - not a property definition
			return;
		}

		//property is defined through assignment - find its initialization value
		let propertyDefinitionNode = parentNode.value;
		let propertyInitializationValueNode = propertyDefinitionNode.right;

		//property initialized with another assignment - 
		//the actual initialization value is the rightmost operand
		while(propertyInitializationValueNode.type === 'AssignmentExpression') {

			propertyInitializationValueNode = propertyInitializationValueNode.right;
		}

		// let functionProperty = new FunctionProperty.FunctionProperty(propertyName);
		// functionProperty.updatePropertyType(propertyInitializationValueNode);
		// functionProperty.updatePropertyDefinitionNode(propertyDefinitionNode);

		let functionProperty = new FunctionProperty.FunctionProperty(propertyDefinitionNode);
		functionProperty.updateFunctionProperty();

		// console.log(functionProperty.propertyName);

		//do not consider properties with invalid names
		if(functionProperty.propertyName == null ||
			isNaN(functionProperty.propertyName) === false) {

			return;
		}

		if(isPrototypeProperty === true) {

			//functionProperty bound to the function's prototype
			//add to the respective array once
			let existentPrototypeProperties = functionPrototypeProperties.filter(prototypeProperty => {

				return prototypeProperty.propertyName === functionProperty.propertyName;
			})

			if(existentPrototypeProperties.length === 0) {

				functionPrototypeProperties.push(functionProperty);
			}
		}
		else {

			//functionProperty bound to the function object
			//add to the respective array once
			let existentProperties = functionProperties.filter(definedFunctionProperty => {

				return definedFunctionProperty.propertyName === functionProperty.propertyName;
			});

			if(existentProperties.length === 0) {

				functionProperties.push(functionProperty);
			}
		}
	});

	definedFunction.updateIsObjectReferenced(isObjectReferenced);

	// console.log(functionProperties);

	// console.log(functionPrototypeProperties.length);
	// console.log(functionProperties.length);

	//for each function property, retrieve its usages (references)
	//syntax: <functionName>.<propertyName> (everywhere in the module) || 
	//		  this.<propertyName> (inside a method property)
	//(find references to the function object itself or 'this')
	//(if function is a function object, its destructuring requires the replacement of property usages with usages of the respective variables)
	functionProperties.forEach(function(functionProperty) {

		let propertyUses = retrieveUsesOfProperty(sourceFile, functionProperty, referenceIdentifiers);

		//update the reference array of functionProperty
		functionProperty.updateFunctionPropertyUsages(propertyUses);
	});

	//retrieve uses of each prototype property
	functionPrototypeProperties.forEach(function(prototypeProperty) {

		let propertyUses = retrieveUsesOfProperty(sourceFile, prototypeProperty, referenceIdentifiers);

		//update the reference array of prototypeProperty
		prototypeProperty.updateFunctionPropertyUsages(propertyUses);
	});

	ternServer.delFile(sourceFile.fileName);

	// console.log('functionName: ' + definedFunction.functionName + ' functionProperties length: ' + functionProperties.length);
	definedFunction.updateFunctionProperties(functionProperties);

	//update prototype properties of definedFunction (prototype properties are bound in the object's prototype,
	//not in the object itself)
	definedFunction.updatePrototypeProperties(functionPrototypeProperties);

	// console.log(functionProperties);
	// console.log(functionPrototypeProperties);
}

// /**
//  * Retrieves the properties bound to the function definition specified in definedFunction.
//  * Also, for each property, it retrieves its usages (through finding references to the function object
//  * either through the function object itself or to 'this' inside a method property).
//  * Notice: cannot be merged with retrievePropertiesOfVariable 
//  * (tern cannot find references of function, it yields an error since it
//  * is not provided the range of a variable/property)
//  * @param {*} definedFunction 
//  */
// function retrievePropertiesOfFunction(sourceFile, definedFunction) {

// 	console.log(sourceFile.fileName + " " + definedFunction.functionName);

// 	//sourceFile holds a property determining if its is a component or test module
// 	//(need to find function properties only in component modules)
// 	if(sourceFile.moduleType === enums.ModuleType.testFile) {

// 		return;
// 	}

// 	let functionName = definedFunction.functionName;

// 	let astRootCollection = sourceFile.astRootCollection;

// 	//functionProperties: properties bound to the function (syntax: <functionName>.<identifier> = <initialization_value>)
// 	let functionProperties = [];

// 	//properties bound to the function's prototype (syntax: <functionName>.prototype.<propertyIdentifier> = <initialization_value>)
// 	let functionPrototypeProperties = [];
// 	let parentPath;
// 	let functionIdentifierStart = null;
// 	let functionIdentifierEnd = null;
// 	let leftOperand;

// 	// console.log(definedFunction.functionName);

// 	if(definedFunction.functionName === 'topLevelScope') {

// 		//topLevelScope is an artificial node that models top-level scope
// 		return;
// 	}

// 	ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

// 	//retrieve uses of definedFunction in sourceFile
// 	// console.log(definedFunction.functionNode.value);
// 	// console.log(definedFunction.functionName);

// 	//retrieve definedFunction's name identifier location, according to the AST node's type
// 	if(definedFunction.functionNode.value.type === 'FunctionExpression') {

// 		parentPath = definedFunction.functionNode.parentPath;
// 		if(parentPath.value.type === 'AssignmentExpression') {

// 			//syntax: <expression> = <function_expression>
// 			leftOperand = parentPath.value.left;

// 			if(leftOperand.type === 'Identifier') {

// 				functionIdentifierStart = leftOperand.range[0];
// 				functionIdentifierEnd = leftOperand.range[1];
// 			}
// 			else if(leftOperand.type === 'MemberExpression') {

// 				functionIdentifierStart = leftOperand.property.range[0];
// 				functionIdentifierEnd = leftOperand.property.range[leftOperand.property.range.length-1];
// 			}

// 			// console.log(leftOperand);
// 			// console.log(functionIdentifierEnd);
// 		}
// 	}
// 	else if(definedFunction.functionNode.value.type === 'FunctionDeclaration') {

// 		functionIdentifierStart = definedFunction.functionNode.value.id.range[0];
// 		functionIdentifierEnd = definedFunction.functionNode.value.id.range[1];
// 	}

// 	console.log(functionIdentifierStart + " " + functionIdentifierEnd);

// 	if(functionIdentifierStart === null || functionIdentifierEnd === null) {

// 		//the function's location in the AST is null (do not proceed)
// 		return;
// 	}

// 	//find identifiers that represent references to definedFunction (in order to retrieve its properties)
// 	let functionIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(path => {

// 		return path.value.name === functionName;
// 	});

// 	// let identifierUsages = [];

// 	// console.log(functionIdentifiers.length);

// 	//decide whether each identifier represents a usage
// 	//of definedFunction
// 	functionIdentifiers.forEach(function(identifier) {

// 		// console.log(identifier.parentPath);
// 		// console.log(identifier.value.name + " " + reservedWords.ReservedWords.indexOf(identifierName) + " " + identifier.parentPath.value.type);
// 		// console.log(identifier.value.name + " " + identifier.parentPath.value.type);
// 		// console.log(identifier.parentPath.value.type);
// 		// console.log(identifier.value.range);
		
// 		let identifierStart = identifier.value.range[0];
// 		let identifierEnd = identifier.value.range[1];
// 		// console.log(identifier.value.name + " " + identifierEnd);
// 		// console.log(identifier.value.loc);

// 		//if identifier is exactly at the function's definition
// 		//do not perform query
// 		if(identifierStart === functionIdentifierStart && identifierEnd === functionIdentifierEnd) {

// 			//proceed to the next identifier that could model a usage of definedFunction
// 			return;
// 		}

// 		// console.log(identifier.value);

// 		//find definition of identifier through a query in ternjs
//         let requestDetails = {
//             query: {

//                 type: "definition",
//                 file: sourceFile.fileName,
//                 end: identifierEnd
// 			}
// 		};

// 		let defStart = null;
// 		let defEnd = null;
		
// 		ternServer.request(requestDetails, function(error, success) {

// 			console.log(error);
// 			// console.log(identifier.value.loc);
// 			// console.log(success);
// 			// console.log(error);
//             if(error !== null) {

//                 return;
// 			}
			
// 			//retrieve range of declaration
// 			defStart = success.start;
// 			defEnd = success.end;

// 		   console.log(success);
// 		//    console.log(defStart + " " + defEnd);
// 		});

// 	// 	// console.log(definedFunction.functionNode);
	
// 		if(definedFunction.functionNode.value.id !== null && definedFunction.functionNode.value.id.type === 'Identifier' &&
// 		   definedFunction.functionNode.value.id.range[0] !== defStart && definedFunction.functionNode.value.id.range[1] !== defEnd) {

// 			//definedFunction is defined through a FunctionDeclaration,
// 			//but the use's def is not identical to definedFunction
// 			//(TODO: extension with FunctionExpression)
// 			return;
// 		}
		
		
// 		if(identifierEnd < defStart || identifierEnd > defEnd) {

// 			//location of identifier is not in the range of its definition
// 			//consider that use
// 			// identifierUsages.push(identifier);

// 			// console.log(identifier.value.loc);

// 			let identifierParentNode = identifier.parentPath;

// 			console.log(identifierParentNode.value.type);

// 			if(identifierParentNode.value.type !== 'MemberExpression') {

// 				//identifier is not contained in a member expression
// 				//don't consider it
// 				return;
// 			}

// 			// console.log(identifierParentNode);

// 			let functionPropertyName;

// 			//what if property is bound to the function's prototype?
// 			// console.log(identifierParentNode.value);

// 			let isPrototypeProperty = false;
// 			if(identifierParentNode.value.property.type === 'Identifier' && identifierParentNode.value.property.name === 'prototype') {

// 				if(identifierParentNode.parentPath.value.type !== 'MemberExpression') {

// 					//direct assign to the object's prototype
// 					//proceed to the next identifier
// 					return;
// 				}
// 				isPrototypeProperty = true;
// 				functionPropertyName = identifierParentNode.parentPath.value.property.name;
// 			}
// 			else {

// 				functionPropertyName = identifierParentNode.value.property.name;
// 			}

// 			// console.log(isPrototypeProperty);

// 			// console.log(functionPropertyName);
// 			let initializationValueNode;
// 			let usageStatementNode = identifierParentNode.parentPath;

// 			console.log(usageStatementNode.value.type);
// 			if(usageStatementNode.value.type !== 'MemberExpression' && usageStatementNode.value.type !== 'AssignmentExpression') {

// 				//use not part of a member expression and not assigned
// 				//proceed to the next use
// 				return;
// 			}

// 			// console.log(usageStatementNode.value.type);
// 			while(usageStatementNode !== null && usageStatementNode.value.type !== 'AssignmentExpression') {

// 				//retrieve the property's definition statement
// 				usageStatementNode = usageStatementNode.parentPath;
// 			}

// 			// console.log(usageStatementNode);
// 			if(usageStatementNode === null) {

// 				//use of definedFunction not in an assignment
// 				//proceed to the next use
// 				return;
// 			}

// 			// console.log(usageStatementNode.value) 
// 			let rightOperand = usageStatementNode.value.right;
// 			while(rightOperand.type === 'AssignmentExpression') {

// 				rightOperand = rightOperand.right;
// 			}

// 			// console.log(usageStatementNode.value.right.type);

// 			initializationValueNode = rightOperand;

// 			// console.log(initializationValueNode);

// 			let definedProperty = new FunctionProperty.FunctionProperty(functionPropertyName);
// 			definedProperty.updatePropertyType(rightOperand);
// 			definedProperty.updatePropertyDefinitionNode(usageStatementNode.value);
// 			// if(initializationValueNode.value == null) {
						
// 			// 	definedProperty.updatePropertyDefinitionNode(usageStatementNode);
// 			// }
// 			// else {
// 			// 	definedProperty.updatePropertyDefinitionNode(usageStatementNode.value);
// 			// }

// 			console.log(definedProperty);
// 			// console.log(isPrototypeProperty);
			
// 			if(isPrototypeProperty === false) {

// 				// console.log(definedProperty);

// 				//functionProperty is not bound to prototype
// 				//update functionProperties
// 				let existentProperties = functionProperties.filter(function(functionProperty) {

// 					return functionProperty.propertyName === definedProperty.propertyName;
// 				});

// 				if(existentProperties.length === 0) {

// 					//there does not exist such property
// 					//add definedProperty to array
// 					functionProperties.push(definedProperty);
// 				}
// 			}
// 			else {

// 				// console.log(definedProperty);
// 				let existentPrototypeProperties = functionPrototypeProperties.filter(function(functionProperty) {

// 					return functionProperty.propertyName === definedProperty.propertyName;
// 				});

// 				if(existentPrototypeProperties.length === 0) {

// 					//there does not exist such property
// 					//add definedProperty to array
// 					functionPrototypeProperties.push(definedProperty);
// 				}
// 			}

			
// 		}
	
// 	});

// 	// console.log(functionPrototypeProperties);


// 	// console.log(functionProperties.length);
// 	// console.log(functionPrototypeProperties.length);

// 	//for each function property, retrieve its usages (references)
// 	//syntax: <functionName>.<propertyName> (everywhere in the module) || 
// 	//		  this.<propertyName> (inside a method property)
// 	//(find references to the function object itself or 'this')
// 	//(if function is a function object, its destructuring requires the replacement of property usages with usages of the respective variables)
// 	functionProperties.forEach(function(functionProperty) {

// 		let propertyUses = retrieveUsesOfProperty(sourceFile, functionProperty);

// 		//update the reference array of functionProperty
// 		functionProperty.updateFunctionPropertyUsages(propertyUses);
// 	});

// 	//retrieve uses of each prototype property
// 	functionPrototypeProperties.forEach(function(prototypeProperty) {

// 		let propertyUses = retrieveUsesOfProperty(sourceFile, prototypeProperty);

// 		//update the reference array of prototypeProperty
// 		prototypeProperty.updateFunctionPropertyUsages(propertyUses);
// 	});

// 	ternServer.delFile(sourceFile.fileName);

// 	// console.log('functionName: ' + definedFunction.functionName + ' functionProperties length: ' + functionProperties.length);
// 	definedFunction.updateFunctionProperties(functionProperties);

// 	//update prototype properties of definedFunction (prototype properties are bound in the object's prototype,
// 	//not in the object itself)
// 	definedFunction.updatePrototypeProperties(functionPrototypeProperties);

// 	// console.log(functionProperties);
// 	// console.log(functionPrototypeProperties);
// }

/**
 * Retrieves the uses of the property (specified in property)
 * that is defined in the module specified in sourceFile.
 * Update: Ternjs cannot soundly resolve all property reference
 * (combine Ternjs results with the object definition's references)
 * @param {*} property 
 */
function retrieveUsesOfProperty(sourceFile, functionProperty, objectReferences) {

	let astRootCollection = sourceFile.astRootCollection;
	let propertyName = functionProperty.propertyName;

	// console.log(sourceFile.fileName + " " + propertyName)

	//for property references, consider:
	//(a) the results returned from ternjs (perform a query for the property's references)
	//(b) the query results with respect to the object's references (tern cannot soundly determine a property's references)

	//(a)
	//the assignment comprising the statement where the property is initialized (defined)
	//(syntax: <property_expression> = <initialization_value>)
	let propertyDefinitionStatementNode = (functionProperty.propertyDefinitionNode.value === undefined ? functionProperty.propertyDefinitionNode : functionProperty.propertyDefinitionNode.value);

	if(propertyDefinitionStatementNode.type !== 'AssignmentExpression') {

		return;
	}

	//the member expression representing a reference to functionProperty within its initialization statement
	//(syntax: <property_expression>)
	let propertyDefinitionMemberExpressionNode = propertyDefinitionStatementNode.left;

	// console.log(propertyDefinitionMemberExpressionNode);

	let propertyDefinitionStart = propertyDefinitionMemberExpressionNode.range[0];
	let propertyDefinitionEnd = propertyDefinitionMemberExpressionNode.range[1];

	let propertyReferenceMemberExpressions = [];

	// console.log(propertyDefinitionStart + " " + propertyDefinitionEnd);
	if(propertyDefinitionStart == null || propertyDefinitionEnd == null) {

		//location of functionProperty null/undefined
		return [];
	}

	//find usages (refs) of functionProperty
	//retrieves: (a) property references through the function object (syntax: <definedFunction>.<propertyName>)
	//			 (b) property references through referencing 'this' (only inside method properties, syntax: this.<propertyName>)
	let requestDetails = {
	query: {
		type: "refs",
		file: sourceFile.fileName,
		end: propertyDefinitionEnd,
		start: propertyDefinitionStart
		}
	};

	let referenceRanges = [];
	ternServer.request(requestDetails, function(error, success){
		
		// console.log(error);
		// console.log(success);

		if(error != null) {

			return;
		}

		//retrieve the ranges of the usages (references) of functionProperty
		referenceRanges = success.refs.map(reference => {

			return {

				start: reference.start,
				end: reference.end
			};
		});
	});

	// console.log(propertyName)
	// console.log(referenceRanges.length);
	// console.log(referenceRanges);

	//exclude the reference within the definition of functionProperty
	referenceRanges = referenceRanges.filter(referenceRange => {

		return referenceRange.start !== propertyDefinitionStart && referenceRange.end !== propertyDefinitionEnd;
	});

	// console.log(referenceRanges.length);

	//for each reference, retrieve the member expression containing it 
	//(the complete reference to the property: ternjs returns the reference to the property without the object)
	//find identifier represented by reference and then retrieve its parent (prevent confusion in cases when multiple property references are used)
	let propertyReference;
	referenceRanges.forEach(function(referenceRange) {

		let referenceIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(identifier => {

			return identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end;
		});

		// console.log(referenceIdentifiers.length);

		if(referenceIdentifiers.length === 0) {

			//no references found - abort
			return;
		}

		let propertyReferenceMemberExpression = referenceIdentifiers.at(0).get().parentPath.value;

		//add the full property reference to the array of the references of functionProperty
		propertyReferenceMemberExpressions.push(propertyReferenceMemberExpression);
	});

	// console.log(propertyReferenceMemberExpressions);

	//(b) consider query results with respect to the surrounding object (with respect to the specific property)
	//(ternjs cannot soundly resolve a property's references)
	let objectPropertyReferences = objectReferences.filter(objectReference => {

		// console.log(objectReference);

		return objectReference.parentPath.value.type === 'MemberExpression' &&
			   (objectReference.parentPath.value.property.type === 'Identifier' && objectReference.parentPath.value.property.name === propertyName) &&
			   objectReference.parentPath.value !== propertyDefinitionMemberExpressionNode;
	}).map(propertyReference => {

		return propertyReference.parentPath.value;
	});

	objectPropertyReferences.forEach(objectPropertyReference => {

		if(propertyReferenceMemberExpressions.indexOf(objectPropertyReference) < 0) {

			//consider property reference in the case that it is not returned as a result
			//of the ternjs query with respect to the property
			propertyReferenceMemberExpressions.push(objectPropertyReference);
		}
	});

	// console.log(propertyReferenceMemberExpressions.length);

	return propertyReferenceMemberExpressions;
}

// /**
//  * Retrieves the implied global variables created in inputFile.
//  * @param {*} inputFile 
//  * @param {*} inputFiles 
//  */
// function retrieveImpliedGlobalsOfSourceFile(inputFile, inputFiles) {

// 	// console.log(inputFile.fileName);

// 	//an implied global is created when a value is assigned to it
// 	//impliedGlobalCreationStatements will store the AST nodes representing these assignments
// 	var impliedGlobalsOfModule = [];
// 	var impliedGlobalsOfFunction = [];

// 	var explicitGlobal;
// 	var variableIndex;
// 	var currentVariable;

// 	inputFile.definedFunctions.forEach(function(definedFunction) {

// 		//search for implied globals in each of the functions defined in inputFile
// 		impliedGlobalsOfFunction = retrieveImpliedGlobalsInDefinedFunction(inputFile, definedFunction);

// 		//concat implied globals of definedFunction with the implied globals of inputFile (add each implied global once)
// 		for(variableIndex = 0; variableIndex < impliedGlobalsOfFunction.length; variableIndex++) {

// 			currentVariable = impliedGlobalsOfFunction[variableIndex];

// 			//is implied global candidate an explicit global of inputFile?
// 			explicitGlobal = inputFile.retrieveExplicitGlobal(currentVariable.variableName);

// 			if(explicitGlobal === null &&
// 			   impliedGlobalsOfModule.some(impliedGlobal => impliedGlobal.variableName === currentVariable.variableName) === false) {

// 				//if there is not an implied global with currentVariable's name in impliedGlobalsOfModule,
// 				//insert currentVariable
// 				impliedGlobalsOfModule.push(currentVariable);
// 			}
// 		}
		
// 	});

// 	inputFile.updateImpliedGlobals(impliedGlobalsOfModule);
// 	// console.log(inputFile.fileName);
// 	// console.log(inputFile.impliedGlobals);
// }

// /**
//  * Retrieves implied globals created in definedFunction.
//  * @param {*} definedFunction 
//  */
// function retrieveImpliedGlobalsInDefinedFunction(inputFile, definedFunction) {

// 	var impliedGlobals = [];
// 	var impliedGlobal;
// 	var variableIndex;
// 	var astRootCollection;

// 	var leftOperand;
// 	var identifier;
// 	var isLocal;
// 	var enclosingScope;
// 	var impliedGlobalIntroduced = false;

// 	if(definedFunction.functionName === 'topLevelScope') {

// 		//topLevelScope is an artificially created node that models the code in the top-level scope
// 		//search implied globals in the AST (no, may retrieve a locally-defined variable and detected as an implied global)
// 		// return;
// 		astRootCollection = inputFile.astRootCollection;
// 	}
// 	else {
		
// 		//search implied globals in the AST representing definedFunction
// 		astRootCollection = jscodeshift(definedFunction.functionNode);
// 	}

// 	// console.log(astRootCollection.find(jscodeshift.Statement).length);

// 	// console.log(inputFile.fileName + definedFunction.functionName);

// 	//statements where a value is assigned in a variable that is not defined
// 	//search assignment expressions in the AST (statements where a value is assigned in a variable that is not defined)
// 	var assignmentExpressionCollection = astRootCollection.find(jscodeshift.AssignmentExpression);
// 	impliedGlobals = impliedGlobals.concat(retrieveImpliedGlobalsIntroducedInStatements(assignmentExpressionCollection, definedFunction));

// 	// console.log(impliedGlobals);
	
// 	//retrieve implied globals in for-in loops
// 	var forInStatementCollection = astRootCollection.find(jscodeshift.ForInStatement);
// 	impliedGlobals = impliedGlobals.concat(retrieveImpliedGlobalsIntroducedInStatements(forInStatementCollection, definedFunction));

// 	//retrieve implied globals in for-of loops
// 	var forOfStatementCollection = astRootCollection.find(jscodeshift.ForOfStatement);
// 	// console.log(inputFile.fileName);
// 	// console.log(definedFunction.functionNode.value.loc);
// 	// console.log(forOfStatementCollection.length);
// 	impliedGlobals = impliedGlobals.concat(retrieveImpliedGlobalsIntroducedInStatements(forOfStatementCollection, definedFunction));
// 	return impliedGlobals;
// }

// function retrieveImpliedGlobalsIntroducedInStatements(statementCollection, definedFunction) {

// 	var impliedGlobals = [];
// 	var introducedImpliedGlobal;
// 	var variableIndex;
// 	statementCollection.forEach(function(statement) {

// 		introducedImpliedGlobal = retrieveImpliedGlobalIntroducedInStatement(statement, definedFunction);
// 		// console.log(introducedImpliedGlobal);
// 		if(introducedImpliedGlobal !== null) {

// 			for(variableIndex = 0; variableIndex < impliedGlobals.length; variableIndex++) {

// 				if(impliedGlobals[variableIndex].compare(introducedImpliedGlobal) === true) {

// 					//impliedGlobal exists - proceed to the next assignment expression
// 					return;
// 				}
// 			}

// 			impliedGlobals.push(introducedImpliedGlobal);

// 			// console.log(assignmentExpression.parentPath);
// 			// console.log(assignmentExpression.value.loc);
// 			// console.log(definedFunction.functionName + " " + identifier.name);
// 		}
// 	});

// 	// console.log(definedFunction.functionName);
// 	// console.log(impliedGlobals);
// 	return impliedGlobals;
// }

// /**
//  * Determines whether the execution of the statements represented by astNode results in the introduction of an implied global.
//  */
// function retrieveImpliedGlobalIntroducedInStatement(astNode, definedFunction) {

// 	// console.log(assignmentExpression.value.right);

// 		//what if assignment expression is located within a nested function definition?
// 		//search code hierarchy from closest enclosing scope and not from scope formed by definedFunction
// 		var enclosingScope = astNode.parentPath;
// 		// var enclosingScopeLoc = enclosingScope.value.loc !== undefined ? enclosingScope.value.loc : enclosingScope.loc;
// 		var definedFunctionLoc = definedFunction.functionNode.value !== undefined ? definedFunction.functionNode.value.loc : definedFunction.functionNode.loc;
// 		// console.log(definedFunctionLoc);
// 		// console.log();
// 		while(enclosingScope.value.type !== 'Program') {

// 			if(enclosingScope.value.type === 'FunctionDeclaration' || 
// 			   enclosingScope.value.type === 'FunctionExpression' || 
// 			   enclosingScope.value.type === 'ArrowFunctionExpression') {

// 				break;
// 			}
// 			enclosingScope = enclosingScope.parentPath;
// 		}

// 		// console.log(enclosingScope);
// 		// console.log(enclosingScope.value.type === 'Program' && definedFunction.functionName !== 'topLevelScope');
// 		if(definedFunction.functionName !== 'topLevelScope' && enclosingScope.value.loc !== definedFunctionLoc) {

// 			//the closest enclosing scope of the assignment expression is not the scope formed by definedFunction
// 			//(not considered for topLevelScope, because it is an artificial node representing the module's top-level scope)
// 			return null;
// 		}

// 		// console.log(astNode);

// 		// console.log(enclosingScope.value.loc === definedFunction.functionNode.value.loc);
// 		// console.log(definedFunction.functionNode.value.loc);
// 		// console.log(enclosingScope !== definedFunction.functionNode);
		
// 		// console.log(assignmentExpression.value.loc);

// 		var leftOperand = astNode.value.left;
// 		var identifier;
// 		// console.log(leftOperand.type);

// 		//retrieve the name of the element that is assigned a value
// 		if(leftOperand.type === 'Identifier') {

// 			// console.log(assignmentExpression.value.loc);
// 			// console.log(assignmentExpression);
// 			// console.log(leftOperand);

// 			identifier = leftOperand;
			
// 		}
// 		else if(leftOperand.type === 'UpdateExpression') {

// 			// assignedVariableName = leftOperand.argument.name;
// 			identifier = leftOperand.argument;
// 		}
// 		else {

// 			//the left operand does not represent either an identifier or an update expression
// 			return null;
// 		}

// 		//is element defined locally in the code hierarchy containing definedFunction?
// 		var isLocal = isIdentifierLocalInFunctionHierarchy(definedFunction, identifier);

// 		// console.log(definedFunction.functionName + " " + identifier.name + " " + isLocal);

// 		if(isLocal === false) {

// 			//element represented by identifier is not defined locally in the code hierarchy containing definedFunction
// 			var impliedGlobal = new ImpliedGlobalVariable.ImpliedGlobalVariable(identifier.name);
			
// 			//the statement where impliedGlobal's creation is detected is an expression statement (an assignment expression)
// 			// console.log(definedFunction.functionName + " " + identifier.name);

// 			if(astNode.parentPath.value instanceof Array === true) {

// 				impliedGlobal.updateCreationStatement(astNode.value);
// 			}
// 			else {

// 				impliedGlobal.updateCreationStatement(astNode.parentPath.value);
// 			}

// 			// impliedGlobal.updateCreationStatement(astNode.parentPath.value);
// 			return impliedGlobal;

// 		}
	
// 	return null;
// }

// exports.retrieveCodeHierarchyOfModule = retrieveCodeHierarchyOfModule;
exports.loadFilesOnTernServer = loadFilesOnTernServer;
exports.removeFilesFromTernServer = removeFilesFromTernServer;
exports.retrieveUsedGlobalIdentifiersInSourceFile = retrieveUsedGlobalIdentifiersInSourceFile;
exports.isUsedElementAFunction = isUsedElementAFunction;
exports.retrieveImpliedGlobalsOfSourceFile = retrieveImpliedGlobalsOfSourceFile;
exports.retrieveUsagesOfImportedElementInSourceFile = retrieveUsagesOfImportedElementInSourceFile;
exports.retrievePropertiesOfFunction = retrievePropertiesOfFunction;
exports.retrievePropertiesOfObjectLiteral = retrievePropertiesOfObjectLiteral;
// exports.retrievePropertiesOfVariable = retrievePropertiesOfVariable;
exports.retrieveReferencesOfPropertiesOfExportedObjectLiteral = retrieveReferencesOfPropertiesOfExportedObjectLiteral;