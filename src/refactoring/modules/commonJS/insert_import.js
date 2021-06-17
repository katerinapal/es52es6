/**
 * 
 * Insert Import Declaration.
 * Replaces CommonJS import statement to an ES6 import statement.
 */

var path = require('path');
const cloneDeep = require('../../../../node_modules/lodash.clonedeep');

var exports = module.exports = {};
exports.description = "insert_import";

exports.refactoring = function (jscodeshiftAPI, astRootCollection, transformationInfo) {

	let importedElement = transformationInfo.importedElement;
	let importedElNodes = importedElement.importedElementNodes;
	let usageSet = importedElement.usageSet;

	let filePath = transformationInfo.filePath;

	if(transformationInfo.dependencyType === 'ImpliedGlobalModification') {

		let variableIdentifier = jscodeshiftAPI.identifier(importedElement.elementName);
		let variableDeclarator = jscodeshiftAPI.variableDeclarator(variableIdentifier, null);
		let variableDeclaration = jscodeshiftAPI.variableDeclaration("var", [variableDeclarator]);

		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(variableDeclaration);

		return {};
	}

	if(transformationInfo.dependencyType === 'ImpliedGlobalImport') {

		//ImpliedGlobalImport
		let importIdentifier = jscodeshiftAPI.identifier(importedElement.elementName);
		let importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, importIdentifier);
		let importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], jscodeshiftAPI.literal(importedElement.definitionModuleName));

		introduceImportDeclarationInModule(jscodeshiftAPI, astRootCollection, importDeclaration);
		return {};
	}

	//locate importedElement's references in the AST (need to be modified, along with the ES6 import introduction)
	//filter out element references for each require() invocation
	//importedElement might be imported multiple times (under a different alias)
	/**
	 * {impElNode: <AST node>,
		elementRefIdentifiers: <AST node>}
	 */
	let elemRefObjs = locateImportedElementReferencesInAST(jscodeshiftAPI, astRootCollection, importedElement);

	// elemRefObjs.map(elemRefObj => console.log(elemRefObj))

	// let elementRefIdentifiers = locateImportedElementReferencesInAST(jscodeshiftAPI, astRootCollection, importedElement);

	//(i) remove commonJS require statement, but keep info about the imported element
	//(needed in the ES6 import statement that will be inserted)
	// {
	// 	isNested: any;
	// 	isNestedInMemberExpression: boolean;
	// 	definitionModule: any;
	// 	importedModuleProperty: any;
	// 	importedModulePropertyAlias: any;
	// 	importedElementAssignedToProperty: boolean;
	// 	comments: any;
	// 	parentNodeValueType: any;
	// 	propertyOfIteratedObjectAccessed: boolean;
	// }
	let importedElementObjects = removeCommonJSRequireStatement(jscodeshiftAPI, astRootCollection, transformationInfo);

	// console.log(astRootCollection.toSource())

	//is importedElement assigned to a property?
	//(if yes, it should be imported)
	let importedElementAssignedToProperty = importedElementObjects.some(importedElementObject => {

		return importedElementObject.importedElementAssignedToProperty === true;
	});

	//DO proceed in the case that importedElement either:
	//(a) models a module import (module imported for its side-effects) - introduced regardless of references
	//(b) is defined in an external/npm module - introduced regardless of references (not considered in statistics)
	//(-) it corresponds to 1 or multiple exported definitions of its definition module 
	//(do not import from a module with no exported definitions - 
	//update ((-) not considered): the cases when an imported element is not mapped to exported definitions is when 
	//(1) the specified module is in an external npm package (precondition 2) and 
	//(2) when the module is imported for its side-effects (precondition 1)) 
	
	//(d) (for a locally defined module) it is used at least once in the module it is imported - introduced depending on references -
	//or it is imported and re-exported from the transformed module
	//or it's imported in a nested scope
	//or it's assigned to a property
	if(transformationInfo.dependencyType !== 'ModuleImport' && 
	   importedElement.definitionModuleName.startsWith('.') === true &&
	   (importedElement.boundToExportedDefinition === false &&
		importedElement.isNested === false && 
	   usageSet.length === 0) &&
	   importedElementAssignedToProperty === false) {

		return {};
	}

	//also don't proceed when importedElement:
	//(a) is mapped to an imported and re-exported definition and
	//(b) is not bound to the module object (re-exported from this module) and
	//(c) is not bound to a feat assigned with the module object (re-exported from this module) and
	//(d) is not nested and
	//(e) has no refs
	if(importedElement.isMappedToImportedAndReexportedDefinitions === true &&
		importedElement.boundToExportedDefinition === false &&
		importedElement.impElBoundToFeatAssignedWithModObj === false &&
		importedElement.isNested === false &&
		importedElement.usageSet.length === 0) {

		return {};
	}
	

	// console.log(transformationInfo);
	// console.log(astRootCollection.toSource());
	// console.log(importedElement.elementName);
	// console.log(importedElementObjects);

	let importDeclaration = null;
	let isInitialImportADefault = importedElement.isImportedElementExportedViaModuleExports;
	let isNamedImportIntroduced = false;

	for(let objectIndex = 0; objectIndex < importedElementObjects.length; objectIndex++) {

		let importedElementObject = importedElementObjects[objectIndex];
		let impElNode = importedElNodes[objectIndex];
		let impElNodeLoc = impElNode.loc;

		//find the usages of importedElement under the alias (variable) where impElNode is assigned
		let elemRefObj = elemRefObjs.find(elemRefObj => {

			let impElASTNodeLoc = elemRefObj.impElNode.value.loc;

			// console.log(elemRefObj)
			// console.log(impElASTNodeLoc);

			// if(impElASTNodeLoc == null) {

			// 	return false;
			// }
			
			return impElASTNodeLoc.start.line === impElNodeLoc.start.line &&
					impElASTNodeLoc.start.column === impElNodeLoc.start.column &&
					impElASTNodeLoc.end.line === impElNodeLoc.end.line &&
					impElASTNodeLoc.end.column === impElNodeLoc.end.column;
		});

		let elementRefIdentifiers;
		if(elemRefObj === undefined) {

			elementRefIdentifiers = [];
		}
		else {

			elementRefIdentifiers = elemRefObj.elementRefIdentifiers;
		}

		// console.log(importedElementObject);

		let isImportStatementNested = importedElementObject.isNested;

		let importedElementAlias = importedElementObject.importedModulePropertyAlias;
		
		//TODO: in the created ImportDeclaration, add the comments of the deleted import declaration
		let comments = importedElementObject.comments;

		//find the type of the import declaration that needs to be introduced for importedElement
		//along with the renamings that need to be performed in order to prevent bugs
		importDeclaration = generateImportStatementOfImportedElement(jscodeshiftAPI, astRootCollection, transformationInfo, importedElementObject, elementRefIdentifiers);

		// console.log(importDeclaration);
		if(importDeclaration !== null) {

			// console.log(astRootCollection.toSource());

			//don't introduce ES6 import if it is already introduced
			//prevent bugs due to duplicate imports
			introduceImportDeclarationInModule(jscodeshiftAPI, astRootCollection, importDeclaration);

			//case: variable declaration named importedElementAlias exists
			//(it is inserted due to the introduction of an ES6 export statement of a property)
			updateVariableDeclarationStatement(jscodeshiftAPI, astRootCollection, importedElementAlias);
		}
		
	}

	// console.log(astRootCollection.toSource())

	return {

		isInitialImportADefault: isInitialImportADefault,
		isNamedImportIntroduced: isNamedImportIntroduced,
		isImportStatementNested: importedElement.isNested
	};
}

/**
 * Based on the type of the dependency and the type of the initial import statement,
 * generated the ES6 import statement with respect to the imported definition that
 * needs to be imported in the AST. Furthermore, based on the type of the initial
 * import statement, it applies renamings on the definition's references.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection: the AST of the module that is transformed 
 * @param {*} transformationInfo: the object containing the information that is needed to apply the transformation
 * @param {*} importedElementObject: the object containing the information for the imported definition and the type of the initial import statement 
 * @param {*} elementRefIdentifiers: the usages of importedElement, located in the AST
 */
function generateImportStatementOfImportedElement(jscodeshiftAPI, astRootCollection, transformationInfo, importedElementObject, elementRefIdentifiers) {

	let importedElement = transformationInfo.importedElement;
	let isElementIncludedInExportObject = importedElement.boundToExportedDefinition;
	let definitionModuleName = importedElement.definitionModuleName;
	let elementProperties = importedElement.dataType === 'function' ? importedElement.functionProperties : importedElement.objectProperties;

	// {
	// 	isNested: any;
	// 	isNestedInMemberExpression: boolean;
	// 	definitionModule: any;
	// 	importedModuleProperty: any;
	// 	importedModulePropertyAlias: any;
	// 	importedElementAssignedToProperty: boolean;
	// 	comments: any;
	// 	parentNodeValueType: any;
	// 	propertyOfIteratedObjectAccessed: boolean;
	// }
	let importedElementName = importedElementObject.importedModuleProperty;
	let importedElementAlias = importedElementObject.importedModulePropertyAlias;
	let isImportStatementNested = importedElementObject.isNested;
	let importedElementAssignedToProperty = importedElementObject.importedElementAssignedToProperty;
	let propertyOfIteratedObjectAccessed = importedElementObject.propertyOfIteratedObjectAccessed;

	// console.log(importedElementObject);

	// parentNodeValueType: the type of the AST node representing the parent of the import of the element 
	//(the syntax of the ES6 import that is going to be introduced is partially determined by parentNodeValueType)
	let parentNodeValueType = importedElementObject.parentNodeValueType;
	
	let comments = importedElementObject.comments;

	let filePath = transformationInfo.filePath;

	// console.log(importedElementObject);
		
	//case: imported element (variable/namespace) is modified
	//create binding variable definition and replace element's usage with the binding's usages
	if(transformationInfo.dependencyType === 'GlobalDefinition') {
			
		//case: there exists an imported global variable/namespace modification 
		//in the source code represented by astRootCollection - assign imported global
		//to a module variable (binding) and rename the usages of the imported global 
		//to usages of the module variable
			
		//before inserting new AST nodes, rename any use of imported global
		//(avoid type error due to imported element overwriting in ES6)
		insertBindingVariableDefinition(jscodeshiftAPI, astRootCollection, importedElementAlias, elementRefIdentifiers, true);
	}
		
	//create node representing ES6 import
	//the syntax of the introduced ES6 named import statement is determined by:
	//(a) the type of the dependency (namespace/element/module import)

	//(b) the type of the definition 

	//((1) property bound to the export object along with other properties, 
	//(2) property that is the only bound to the export object, 
	//(3) property/variable/function assigned to the export object)
	//of the export statement of the element in the definition module

	//(d) the location of the dependency (nested/non-nested)

	//(e) whether the definition is imported and re-exported from the module
	let importSourceLiteral = jscodeshiftAPI.literal(definitionModuleName);
	let importDeclaration;

	//types of the introduced imports:
	//(a) default import: only for modules located in external npm packages
	//(b) named import: for all modules located in the analysed system (regardless of the initial export strategy)
	if(transformationInfo.dependencyType === 'ModuleImport') {

		//a module is imported for its side-effects (no exported definitions are imported, thus no renamings needed)
		//module import statement is replaced with an ES6 module import statement during the removal
		//(syntax: import <modulePath>)
		importDeclaration = jscodeshiftAPI.importDeclaration([], importSourceLiteral);

		return importDeclaration;
	}

	let importIdentifier = jscodeshiftAPI.identifier(importedElementName);
	let importSpecifier;

	//namespace/element imports

	//create a local identifier named importedElementAlias (remove special chars)
	let localIdentifier = jscodeshiftAPI.identifier(importedElementAlias);

	if (parentNodeValueType === 'CallExpression') {

		//parentNode of the import is a call expression 
		//(syntax: require(<modulePath>)())
		//(regardless of dependency type) during removal, require() is replaced by an identifier with name importedElementObject.importedModuleProperty
		//(the name of the imported definition - no renamings needed)

		if(definitionModuleName.startsWith('.') === false) {

			//namespace import relevant to external module (located in node_modules or global)
			//insert a default import 
			//(syntax: import <localIdentifier> from <modulePath>)
			importSpecifier = jscodeshiftAPI.importDefaultSpecifier(localIdentifier);

		}
		else {

			//the CommonJS export statement is replaced with an ES6 named import statement of the form import {<> as <>} from <module>;
			//regardless of the export strategy in the definition module
			//(syntax: import {<definitionName> as <aliasName>} from <modulePath>)
			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
		}

		importDeclaration = jscodeshiftAPI.importDeclaration([importSpecifier], importSourceLiteral);

		return importDeclaration;
	}

	//namespace/element imports not included in call expressions
	if(transformationInfo.dependencyType === 'NamespaceImport' || 
	   transformationInfo.dependencyType === 'NamespaceModification') {

		if(transformationInfo.dependencyType === 'NamespaceModification' && 
			importedElement.isMappedToImportedAndReexportedDefinitions === false && 
			isImportStatementNested === false && 
			elementProperties.length === 0) {
		
			//case: there exists an imported global variable/namespace modification (namespace points to a definition with no properties,
			//thus, this value is modified)
			//in the source code represented by astRootCollection - assign imported global
			//to a module variable (binding) and rename the usages of the imported global 
			//to usages of the module variable
			//in the case that it doesn't model a definition that is imported and reexported
			
			//(iii) before inserting new AST nodes, rename any use of imported global
			//(avoid type error due to imported element overwriting in ES6)
			insertBindingVariableDefinition(jscodeshiftAPI, astRootCollection, importedElementAlias, elementRefIdentifiers, false);
		}

		//import referencing a definition in a locally-defined module
		//find the definition's references (identifiers/member expressions) that need to be renamed
		//based on its type (variable/function/property)
		//[AST node with parent]
		let defRefs = filterImportedElementReferences(transformationInfo, importedElementObject, elementRefIdentifiers);

		defRefs = defRefs.filter(defRef => {

			return defRef !== null;
		});

		//namespace (module object) imports: introduce 1..n ES6 named imports
		//with respect to the definitions referenced in the module
		//the definition(s) is (are) imported under an alias depending on 
		//(1) their actual names, (2) their definition's module name
		//in order to prevent name collisions (when multiple modules export declarations with the same names)
		let importSpecifiers = [];

		if(definitionModuleName.startsWith('.') === false) {

			//namespace import relevant to external module
			//insert a default import (import <aliasName> from <modulePath>)
			//imported element's references are replaced with references of localIdentifier
			//avoid name collisions due to the use of the external module's name in the use of variables
			//especially in the case that require() is followed by a member expression
			importSpecifier = jscodeshiftAPI.importDefaultSpecifier(localIdentifier);

			importSpecifiers.push(importSpecifier);

			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			//require() followed by an access of a property
			//do not rename anything, since all references of imported definition
			//are references of the accessed property
			if(parentNodeValueType !== 'MemberExpression') {

				elementRefIdentifiers.filter(elementRef => {

					jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				});
			}

			return importDeclaration;
		}

		// console.log(importedElement.dataType)
		// console.log(importedElement.isMappedToImportedAndReexportedDefinitions)
		// console.log(defRefs);
		//importedElement imports:
		//(1) namespace import modified or mapped to an imported and reexported definition
		//(2) referenced through bracket notation or at least one of its properties is modified: 1 named import with respect to importedElement
		//(3) constructor function: 1 named import with respect to imported element + named imports with respect to the used function object properties (if any)
		//(4) non-constructor function: named imports with respect to the used function object properties (if any)
		//(5) is assigned to a property (update)
		
		//(1)
		if(importedElement.isMappedToImportedAndReexportedDefinitions === true) {

			// console.log(importedElement.dataType)
			//importedElement mapped to a definition imported and re-exported from imported module
			//generate an import statement for the imported definition, regardless of how this definition
			//is imported in the imported module (element is not destructured)
			//(syntax: import {<definitionName> as <aliasName>} from <modulePath>)
			
			//importedElement is imported through an import statement in a nested scope
			//it is imported regardless of its references
			//all exported definitions from the definition module with a namespace import
			if(importedElement.dataType === 'property') {
				
				//importedElement is (a) a property bound to the export object
				//(b) and it is bound along with others (and no use of a specific property exists, applies in nested imports also)
				if(importedElement.isImportedElementExportedViaModuleExports === false &&
					importedElement.numberOfPropertiesExportedFromModule > 1 && 
					defRefs.length === 0) {

					importSpecifier = jscodeshiftAPI.importSpecifier(jscodeshiftAPI.identifier(importedElement.elementName), localIdentifier);
					importSpecifiers.push(importSpecifier);

					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

					return importDeclaration;
				}

				//importedElement is (a) a property bound to the export object and
				//(c) has  properties (not destructured)
				if(importedElement.isImportedElementExportedViaModuleExports === false &&
					elementProperties.length > 0) {

						importSpecifier = jscodeshiftAPI.importSpecifier(jscodeshiftAPI.identifier(importedElement.elementName), localIdentifier);
						importSpecifiers.push(importSpecifier);
							
						//initial code (NamespaceImport): imports the export object of the module (object with property)
						//final code: imports the export object of the module through a namespace import
						//replace the importedElement's references with references to the imported namespace
						if(defRefs.length > 0) {

							defRefs.forEach(elementRef => {

								jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
							});
						}
						else if(parentNodeValueType !== 'MemberExpression') {

							//rename property refs only in cases that it's imported through a namespace import
							elementRefIdentifiers.forEach(elementRef => {

								jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
							});
						}

						importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

						return importDeclaration;
				}
				
				//importedElement is (a) a property assigned to the export object
				//or (b) the only one to bound to the export object
				//and has no properties (not destructured)
				importSpecifier = jscodeshiftAPI.importSpecifier(jscodeshiftAPI.identifier(importedElement.elementName), localIdentifier);
				importSpecifiers.push(importSpecifier);
						
				//initial code (NamespaceImport): imports the export object of the module (variable/function)
				//final code: imports the exported definition (variable/function)
				//replace the importedElement's references with references to the imported definition alias (since after refactoring all definitions are exported through named exports)
				defRefs.forEach(elementRef => {

					jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				return importDeclaration;

			}
			
			//importedElement is a variable/function assigned to the export object which has properties
			//and it's not referenced itself somewhere in the system (thus, it is destructured after the refactoring)
			if(elementProperties.length > 0 && importedElement.isObjectReferenced === false) {

				// importSpecifier = jscodeshiftAPI.importNamespaceSpecifier(localIdentifier);
				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				importSpecifiers.push(importSpecifier);

				//initial code (NamespaceImport): imports the export object of the module (variable/function)
				//final code: imports the export object of the module through a namespace import (an object with the exported variable/function)
				//replace the importedElement's references with references to the imported namespace and the exported variable/function (member expressions)
				defRefs.forEach(elementRef => {

					jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				return importDeclaration;
			}
			
			//importedElement has no bound properties
			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			importSpecifiers.push(importSpecifier);

			//initial code (NamespaceImport): imports the export object of the module (variable/function)
			//final code: imports the exported definition (variable/function)
			//replace the importedElement's references with references to the imported definition alias (since after refactoring all definitions are exported through named exports)
			if(parentNodeValueType !== 'MemberExpression') {

				defRefs.forEach(elementRef => {

					jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				});
			}
			

			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			return importDeclaration;
					
		}
		
		//(2)
		if(importedElement.isAccessedDynamically === true) {

			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			importSpecifiers.push(importSpecifier);
			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			//replace the definition's references
			defRefs.forEach(defRef => {

				// console.log(defRef.value.loc)
				jscodeshiftAPI(defRef).replaceWith(localIdentifier);
			});

			return importDeclaration;
		}

		if(importedElement.isObjectReferenced === true || 
			importedElement.isModified === true ||
			importedElementAssignedToProperty === true) {

			//(a) importedElement is a function/variable/property that is the only one to be exported from the imported module
			//(not destructured after the refactoting)
			//introduce an ES6 named import (syntax: import {<elementName> as <aliasName>} from <modulePath>)
			//importedElement is:
			//(a) a variable/function assigned to the export object
			//(b) the only property bound to the export object
			//(c) assigned to another property
			// if(importedElement.dataType === 'property') {

				if(importedElement.isImportedElementExportedViaModuleExports === true) {

					importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					importSpecifiers.push(importSpecifier);
					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

					//replace the definition's references
					defRefs.forEach(defRef => {

						// console.log(defRef.value.loc)
						jscodeshiftAPI(defRef).replaceWith(localIdentifier);
					});

					// console.log(importDeclaration);
					return importDeclaration;
				}
				
				if(parentNodeValueType === 'MemberExpression') {

					importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					importSpecifiers.push(importSpecifier);
					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

					//replace the definition's references
					defRefs.forEach(defRef => {

						// console.log(defRef.value.loc)
						jscodeshiftAPI(defRef).replaceWith(localIdentifier);
					});

					return importDeclaration;
				}
				else {

					//accessed properties < exported properties (not all properties are used) -> element
					//otherwise namespace
					if(importedElement.numberOfPropertiesExportedFromModule === 1 ||
						importedElement.accessedProperties.length < importedElement.numberOfPropertiesExportedFromModule) {

						//object bound to the export object
						//in the case that the object's accessed properties
						//are not equal to the imported module's exported properties
						importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
						importSpecifiers.push(importSpecifier);
						importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

						// console.log(astRootCollection.toSource());
						// console.log(defRefs.length);

						//replace the definition's references
						defRefs.forEach(defRef => {

							//don't replace nodes with array values
							//e.g. nodes modelling function argument arrays
							//(for parameters with the same name with imported features)
							if(defRef.parentPath.value instanceof Array === true) {

								return;
							}

							// console.log(defRef.value.loc);

							if(defRef.parentPath.value.type === 'MemberExpression') {

								jscodeshiftAPI(defRef.parentPath).replaceWith(localIdentifier);
								return;
							}
							
							jscodeshiftAPI(defRef).replaceWith(localIdentifier);
						});

						// console.log(astRootCollection.toSource());
						// console.log(jscodeshiftAPI(importDeclaration).toSource())

						return importDeclaration;
					}

					//importedElement is a property bound to the export object along with other properties
					//add a named import
					importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					importSpecifiers.push(importSpecifier);
								
					//initial code (NamespaceImport): imports the export object of the module (object with property)
					//final code: imports the export object of the module through a namespace import
					//replace the importedElement's references with references to the imported namespace
					defRefs.forEach(elementRef => {

						jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
					});

					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

					return importDeclaration;

					// //replace the definition's references (member expressions)
					// defRefs.forEach(defRef => {

					// 	// console.log(defRef.value.loc)
					// 	jscodeshiftAPI(defRef.parentPath).replaceWith(localIdentifier);
					// });
				}
				

				// return importDeclaration;
			// }

			// return importDeclaration;

			// importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			// importSpecifiers.push(importSpecifier);

			// //replace the definition's references
			// defRefs.forEach(defRef => {

			// 	// console.log(defRef.value.loc)
			// 	jscodeshiftAPI(defRef).replaceWith(localIdentifier);
			// });

			// importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			// return importDeclaration;

			// if(importedElement.dataType !== 'property' || 
			//    (importedElement.isImportedElementExportedViaModuleExports === true)) {

			// 	//importedElement is:
			// 	//(a) a variable/function assigned to the export object
			// 	//(b) the only property bound to the export object
			// 	importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			// 	importSpecifiers.push(importSpecifier);

			// 	//replace the definition's references
			// 	defRefs.forEach(defRef => {

			// 		// console.log(defRef.value.loc)
			// 		jscodeshiftAPI(defRef).replaceWith(localIdentifier);
			// 	});

			// 	importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			// 	return importDeclaration;
			// }
					
			// //importedElement is a property bound to the export object along with other properties
			// //add a namespace import
			// importSpecifier = jscodeshiftAPI.importNamespaceSpecifier(localIdentifier);
			// importSpecifiers.push(importSpecifier);
						
			// //initial code (NamespaceImport): imports the export object of the module (object with property)
			// //final code: imports the export object of the module through a namespace import
			// //replace the importedElement's references with references to the imported namespace
			// defRefs.forEach(elementRef => {

			// 	jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
			// });

			// importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			// return importDeclaration;
		}
		
		//(3-4)
		//case: importedElement referenced out of member expressions (e.g. as a parameter)
		//introduce an ES6 named import
		let elementReferences = elementRefIdentifiers.filter(elementRefIdentifier => {

			if(parentNodeValueType === 'MemberExpression') {

				return false;
			}

			return elementRefIdentifier != null && 
					elementRefIdentifier.parentPath.value.type !== 'MemberExpression';
		});

		if(isImportStatementNested === true) {

			//importedElement is imported through an import statement in a nested scope
			//it is imported regardless of its references
			//all exported definitions from the definition module with a namespace import
			if(importedElement.dataType === 'property') {

				//importedElement is (a) a property assigned to the export object
				//or (b) the only one to bound to the export object
				//and has no properties (not destructured)
				//update: for an importedElement bound to the export object
				//always add a namespace import
				//regardless of the exported property number (this object might be a parameter in a function)
				// if(importedElement.isImportedElementExportedViaModuleExports === true &&
				// 	elementProperties.length === 0) {

				// 		importSpecifier = jscodeshiftAPI.importSpecifier(jscodeshiftAPI.identifier(importedElement.elementName), localIdentifier);
				// 		importSpecifiers.push(importSpecifier);
						
				// 		//initial code (NamespaceImport): imports the export object of the module (variable/function)
				// 		//final code: imports the exported definition (variable/function)
				// 		//replace the importedElement's references with references to the imported definition alias (since after refactoring all definitions are exported through named exports)
				// 		defRefs.forEach(elementRef => {

				// 			jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				// 		});

				// 		importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				// 		return importDeclaration;
				// }
				
				// //importedElement is a property bound to the export object along with other properties
				// //since it is imported in an inner scope, add a namespace import
				// importSpecifier = jscodeshiftAPI.importNamespaceSpecifier(localIdentifier);
				// importSpecifiers.push(importSpecifier);
				
				// //initial code (NamespaceImport): imports the export object of the module (object with property)
				// //final code: imports the export object of the module through a namespace import
				// //replace the importedElement's references with references to the imported namespace
				// defRefs.forEach(elementRef => {

				// 	jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				// });

				// importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				// return importDeclaration;

				importSpecifier = jscodeshiftAPI.importSpecifier(jscodeshiftAPI.identifier(importedElement.elementName), localIdentifier);
				importSpecifiers.push(importSpecifier);

				// console.log(importedElementObject.isNestedInMemberExpression);
						
				//initial code (NamespaceImport): imports the export object of the module (variable/function)
				//final code: imports the exported definition (variable/function)
				//replace the importedElement's references with references to the imported definition alias (since after refactoring all definitions are exported through named exports)
				defRefs.forEach(elementRef => {

					jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				return importDeclaration;
			}
			
			//importedElement is a variable/function assigned to the export object which has properties
			// if(elementProperties.length > 0) {

			// 	importSpecifier = jscodeshiftAPI.importNamespaceSpecifier(localIdentifier);
			// 	importSpecifiers.push(importSpecifier);

			// 	//initial code (NamespaceImport): imports the export object of the module (variable/function)
			// 	//final code: imports the export object of the module through a namespace import (an object with the exported variable/function)
			// 	//replace the importedElement's references with references to the imported namespace and the exported variable/function (member expressions)
			// 	defRefs.forEach(elementRef => {

			// 		jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
			// 	});

			// 	importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			// 	return importDeclaration;
			// }
			
			//importedElement has no bound properties
			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			importSpecifiers.push(importSpecifier);

			//initial code (NamespaceImport): imports the export object of the module (variable/function)
			//final code: imports the exported definition (variable/function)
			//replace the importedElement's references with references to the imported definition alias (since after refactoring all definitions are exported through named exports)
			defRefs.forEach(elementRef => {

				jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
			});

			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			return importDeclaration;
					
		}

		//import statement not nested
		if(importedElement.dataType === 'property') {

			//importedElement is bound/assigned to the export object in its definition module
			//import it in the case that (a) it is used in the module, (b) it is re-exported
			if(elementReferences.length > 0) {

				//importedElement is used outside member expressions:
				//(a) it is bound to the export object along with other properties: add a named import
				//(b) it is bound to the export object with no other properties: add an element import
				//(c) it is assigned to the export object: add an element import

				//(a)
				if(importedElement.isImportedElementExportedViaModuleExports === false &&
				   importedElement.numberOfPropertiesExportedFromModule > 1) {

					importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					importSpecifiers.push(importSpecifier);

					//initial code (NamespaceImport): imports the export object of the module (object with property)
					//final code: imports the export object of the module through a namespace import
					//replace the importedElement's references with references to the imported namespace
					defRefs.forEach(elementRef => {

						jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
					});

					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

					return importDeclaration;
				}
				
				//(b)-(c)
				// console.log(jscodeshiftAPI(localIdentifier).toSource())
				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				importSpecifiers.push(importSpecifier);

				//initial code (NamespaceImport): imports the export object of the module ((a) object with property or (b) property itself)
				//final code: imports the exported definition (property) from module
				//replace the importedElement's references' parents (member expressions) with references to the imported namespace
				defRefs.forEach(defRef => {

					return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);
				// console.log(importDeclaration);

				return importDeclaration;
			}

			//importedElement is exported from the transformed module
			if(isElementIncludedInExportObject === true) {

				//importedElement mapped to a definition bound to the export object
				//along with other definitions from its definition module
				if(importedElement.isImportedElementExportedViaModuleExports === false &&
					importedElement.numberOfPropertiesExportedFromModule > 1) {

					importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					importSpecifiers.push(importSpecifier);

					defRefs.forEach(defRef => {

						return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
					});
	
					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);
					// console.log(importDeclaration);
	
					return importDeclaration;
				}

				//importedElement is the only one to be exported from its definition module
				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				importSpecifiers.push(importSpecifier);

				//initial code (NamespaceImport): imports the export object of the module ((a) object with property or (b) property itself)
				//final code: imports the exported definition (property) from module
				//replace the importedElement's references' parents (member expressions) with references to the imported namespace
				defRefs.forEach(defRef => {

					return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);
				// console.log(importDeclaration);

				return importDeclaration;
			}

			//importedElement is used at least once
			if(elementRefIdentifiers.length > 0) {

				//importedElement is a property bound to the export object, along with other properties
				//insert a named import specifying each of the accessed properties
				//also, replace each property's reference (member expression) with a reference to the accessed property
				
				//check if these properties are bound to a variable modelling the module object
				//an exported property may/may not be bound to a module feature assigned with the module object
				//(in the 1st case, the property might be exported along with the feature, in the 2nd the property is exported itself)
				if(importedElement.isImportedElementExportedViaModuleExports === false &&
					importedElement.impElBoundToFeatAssignedWithModObj === false) {
 
					// importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
					// importSpecifiers.push(importSpecifier);

					//update: what if a property (object bound/assigned to the module object)
					//is imported with a member expression (direct access right after require() invocation)?
					//it's imported through a named import
					if(parentNodeValueType === 'MemberExpression') {

						importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
						importSpecifiers.push(importSpecifier);

						// console.log(importedElementName)

						//also, rename all references to localIdentifier
						let localSpecRefs = elementRefIdentifiers.filter(defRef => {

							// console.log(defRef.value);
							return defRef.value.name === importedElementName;
						});

						localSpecRefs.forEach(defRef => {

							return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
						});
					}
					else {

						importedElement.accessedProperties.forEach(accessedProperty => {

							let accessedPropId = jscodeshiftAPI.identifier(accessedProperty.propertyName);
							// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId);
	
							//<path-to-import-source>_<accessed-prop-name>
							let importAlias = `${definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '')}_${accessedProperty.propertyName}`;
							let aliasId = jscodeshiftAPI.identifier(importAlias);
	
							//prevent name collisions
							importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, aliasId);
							// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, localIdentifier);
							importSpecifiers.push(importSpecifier);
	
							let propRefs = elementRefIdentifiers.filter(importedElemRef => {
	
								if(importedElemRef == null) {
	
									return false;
								}
	
								if(importedElemRef.parentPath.value.type !== 'MemberExpression') {
	
									return false;
								}
	
								return importedElemRef.parentPath.value.property.type === 'Identifier' &&
										importedElemRef.parentPath.value.property.name === accessedProperty.propertyName;
							});
							
							let propRefMbExps = propRefs.map(propRef => {
	
								return propRef.parentPath;
							});
	
							propRefMbExps.forEach(propRefMbExp => {
	
								// jscodeshiftAPI(propRefMbExp).replaceWith(accessedPropId);
	
								//prevent name collisions
								jscodeshiftAPI(propRefMbExp).replaceWith(aliasId);
								// jscodeshiftAPI(propRefMbExp).replaceWith(localIdentifier);
							});
						});
					}

					// importedElement.accessedProperties.forEach(accessedProperty => {

					// 	let accessedPropId = jscodeshiftAPI.identifier(accessedProperty.propertyName);
					// 	// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId);

					// 	//<path-to-import-source>_<accessed-prop-name>
					// 	let importAlias = `${definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '')}_${accessedProperty.propertyName}`;
					// 	let aliasId = jscodeshiftAPI.identifier(importAlias);

					// 	//prevent name collisions
					// 	importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, aliasId);
					// 	// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, localIdentifier);
					// 	importSpecifiers.push(importSpecifier);

					// 	let propRefs = elementRefIdentifiers.filter(importedElemRef => {

					// 		if(importedElemRef == null) {

					// 			return false;
					// 		}

					// 		if(importedElemRef.parentPath.value.type !== 'MemberExpression') {

					// 			return false;
					// 		}

					// 		return importedElemRef.parentPath.value.property.type === 'Identifier' &&
					// 				importedElemRef.parentPath.value.property.name === accessedProperty.propertyName;
					// 	});
						
					// 	let propRefMbExps = propRefs.map(propRef => {

					// 		return propRef.parentPath;
					// 	});

					// 	propRefMbExps.forEach(propRefMbExp => {

					// 		// jscodeshiftAPI(propRefMbExp).replaceWith(accessedPropId);

					// 		//prevent name collisions
					// 		jscodeshiftAPI(propRefMbExp).replaceWith(aliasId);
					// 		// jscodeshiftAPI(propRefMbExp).replaceWith(localIdentifier);
					// 	});
					// });
 
					//initial code (NamespaceImport): imports the export object of the module (object with property)
					//final code: imports the export object of the module through a namespace import
					//replace the importedElement's references with references to the imported namespace
					// defRefs.forEach(elementRef => {
 
					// 	jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
					// });
 
					importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);
 
					return importDeclaration;
				}

				// if(importedElement.isImportedElementExportedViaModuleExports === false &&
				// 	importedElement.numberOfPropertiesExportedFromModule === importedElement.accessedProperties.length) {
 
				// 	// importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				// 	// importSpecifiers.push(importSpecifier);

				// 	importedElement.accessedProperties.forEach(accessedProperty => {

				// 		let accessedPropId = jscodeshiftAPI.identifier(accessedProperty.propertyName);
				// 		// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId);

				// 		//<path-to-import-source>_<accessed-prop-name>
				// 		let importAlias = `${definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '')}_${accessedProperty.propertyName}`;
				// 		let aliasId = jscodeshiftAPI.identifier(importAlias);

				// 		//prevent name collisions
				// 		importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, aliasId);
				// 		// importSpecifier = jscodeshiftAPI.importSpecifier(accessedPropId, localIdentifier);
				// 		importSpecifiers.push(importSpecifier);

				// 		let propRefs = elementRefIdentifiers.filter(importedElemRef => {

				// 			if(importedElemRef == null) {

				// 				return false;
				// 			}

				// 			if(importedElemRef.parentPath.value.type !== 'MemberExpression') {

				// 				return false;
				// 			}

				// 			return importedElemRef.parentPath.value.property.type === 'Identifier' &&
				// 					importedElemRef.parentPath.value.property.name === accessedProperty.propertyName;
				// 		});
						
				// 		let propRefMbExps = propRefs.map(propRef => {

				// 			return propRef.parentPath;
				// 		});

				// 		propRefMbExps.forEach(propRefMbExp => {

				// 			// jscodeshiftAPI(propRefMbExp).replaceWith(accessedPropId);

				// 			//prevent name collisions
				// 			jscodeshiftAPI(propRefMbExp).replaceWith(aliasId);
				// 			// jscodeshiftAPI(propRefMbExp).replaceWith(localIdentifier);
				// 		});
				// 	});
 
				// 	//initial code (NamespaceImport): imports the export object of the module (object with property)
				// 	//final code: imports the export object of the module through a namespace import
				// 	//replace the importedElement's references with references to the imported namespace
				// 	// defRefs.forEach(elementRef => {
 
				// 	// 	jscodeshiftAPI(elementRef).replaceWith(localIdentifier);
				// 	// });
 
				// 	importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);
 
				// 	return importDeclaration;
				// }

				importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				importSpecifiers.push(importSpecifier);

				//initial code (NamespaceImport): imports the export object of the module ((a) object with property or (b) property itself)
				//final code: imports the exported definition (property) from module
				
				// if(importedElement.isImportedElementExportedViaModuleExports === false) {

				// 	//property bound to export object (used later with a member expression)
				// 	//replace the importedElement's references' parents (member expressions) with references to the imported namespace
				// 	defRefs.forEach(defRef => {

				// 		return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
				// 	});
				// }
				// else {

				// 	//property assigned to export object
				// 	//replace the importedElement's references (property identical to export object)
				// 	defRefs.forEach(defRef => {

				// 		return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
				// 	});
				// }

				defRefs.forEach(defRef => {

					return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
				});

				importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

				return importDeclaration;
			}

			return null;
		}

		//importedElement is a variable/function assigned to the export object in its definition module
		//function/variable is included in the import statement in the cases that (one of the following apply):
		//(a) it is imported and re-exported (imported regardless of its references)
		//(b) it's referenced at least once outside member expressions
		//(c) it's cohesive and it's properties are accessed
		let isElementUsed = isFunctionUsedBesidesItsProperties(jscodeshiftAPI, importedElement, elementRefIdentifiers);
		
		if(isElementUsed === true || isElementIncludedInExportObject === true) {

			//importedElement used apart from its properties
			//or re-exported from module
			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);

			defRefs.forEach(defRef => {

				return jscodeshiftAPI(defRef).replaceWith(localIdentifier);
			});

			importSpecifiers.push(importSpecifier);
		}

		if(importedElement.accessedProperties.length > 0) {
			 
				//import importElement's property in the case that its accessed properties
				//are not included in its object properties
				//(e.g. the accessed properties are prototype properties)
				let propertyIdentifiers = renameFunctionPropertyReferencesToVariableReferences(jscodeshiftAPI, astRootCollection, filePath, importedElement, elementRefIdentifiers, true, importedElementAlias);

				importSpecifiers = importSpecifiers.concat(propertyIdentifiers);

				// if(isElementUsed === true) {

				// 	//importedElement used apart from its properties
				// 	importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
				// 	importSpecifiers.push(importSpecifier);
				// }

		}
		// else if(isElementIncludedInExportObject === true) {

		// 	//importedElement imported and re-exported from module
		// 	importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
		// 	importSpecifiers.push(importSpecifier);
		// }

		console.log(importSpecifiers.length)
		if(importSpecifiers.length > 0) {

			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, importSourceLiteral);

			return importDeclaration;
		}
	
		return null;
	}
	
	//element (variable/function assigned to the export object) imports
	if (transformationInfo.dependencyType === 'GlobalDefinition' ||
		transformationInfo.dependencyType === 'FunctionDefinition' ||
		transformationInfo.dependencyType === 'GlobalUse') {

		//case (a) export statement type: assignment to exports property (syntax: exports.<identifier> = <elementName>) && var <variableName> = require(<modulePath>).<elementName>
		//=> import {<elementName> as <aliasName>} from '<modulePath>';

		if(importedElementName !== 'anonymus') {

			//imported element is not an anonymus function - create named import
			importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier, localIdentifier);
			importSpecifiers.push(importSpecifier);
				
			importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, jscodeshiftAPI.literal(definitionModuleName));
			return importDeclaration;
		}
			
		importSpecifier = jscodeshiftAPI.importSpecifier(importIdentifier);
		importSpecifiers.push(importSpecifier);
				
		importDeclaration = jscodeshiftAPI.importDeclaration(importSpecifiers, jscodeshiftAPI.literal(definitionModuleName));
		return importDeclaration;
			
	}

	return null;
}

/**
 * Filters out the imported definitions references that need to be renamed.
 * Filtering is based on:
 * (a) the type of the initial export of the imported definition (assignment/binding to the export object)
 * (b) the type of the initial import of the imported definition (import of module object/imported definition)
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} transformationInfo 
 * @param {*} importedElementObject 
 * @param {*} elementRefIdentifiers 
 */
function filterImportedElementReferences(transformationInfo, importedElementObject, elementRefIdentifiers) {

	let importedElement = transformationInfo.importedElement;
	let parentNodeValueType = importedElementObject.parentNodeValueType;
	let propertyOfIteratedObjectAccessed = importedElementObject.propertyOfIteratedObjectAccessed;
	// console.log(importedElementObject)

	//nested import: transformed during removal of require()
	//(nested import not deleted, modified)
	if(importedElement.isNested === true) {

		return [];
	}

	//a namespace import inside a member expression
	//the import statement is replaced with the imported element's alias (the member expression still exists)
	//do not rename anything
	if((transformationInfo.dependencyType === 'NamespaceImport' ||
		transformationInfo.dependencyType === 'NamespaceModification') &&
		parentNodeValueType === 'MemberExpression') {

		return [];
	}

	if(importedElement.isImportedElementExportedViaModuleExports === true &&
	   importedElement.isMappedToImportedAndReexportedDefinitions === false) {

		if(propertyOfIteratedObjectAccessed === true) {

			//a property of an iterated object is imported
			//the object is imported, while the initial import is replaced with its reference
			//do not rename anything (variable definition assigned with the result of require() is kept)
			return [];
		}

		//imported definition is assigned to the export object and it is not imported and re-exported from the imported module
		//keep all references, since definition is imported through a call of require()
		//which is not followed by a member access
		return elementRefIdentifiers;
	}

	if(importedElement.isMappedToImportedAndReexportedDefinitions === true) {

		if(importedElement.isImportedElementExportedViaModuleExports === true &&
		   importedElement.isReexportedDefinitionBoundToTheExportObject === false) {

			//initial code: module takes an object with a property from a module that imports/re-exports an object with property
			//final code: module takes a property from a module imports/re-exports a property
			if(parentNodeValueType === 'VariableDeclarator' ||
				parentNodeValueType === 'AssignmentExpression') {

				return elementRefIdentifiers;
			}
			
			elementRefIdentifiers = elementRefIdentifiers.filter(elemRef => {

				return elemRef != null;
			});

			return elementRefIdentifiers.map(elemRef => elemRef.parentPath);
		}

		return elementRefIdentifiers;
	}

	//imported definition is bound to the export object
	//definition might be accessed in 2 ways:
	//(a) a call to require() followed by its access + its direct access for its reference (identifier)
	//(b) a call to require() not followed by its access + its access through accessing the imported module object for its reference (member expression)
	// if(parentNodeValueType === 'MemberExpression' || 
	// 	importedElement.isImportedElementExportedViaModuleExports === false) {

	// 	//(a)
	// 	//syntax: <imported_definition_alias> = require(<modulePath>).<imported_definition_name>
	// 	//or importedElement bound to the export object (import brings the module object)
	// 	//keep all references
	// 	return elementRefIdentifiers;
	// }

	// console.log(parentNodeValueType);
	// console.log(importedElement.dataType) 
	
	if(parentNodeValueType === 'MemberExpression' || 
		(importedElement.dataType !== 'property' &&
		importedElement.isImportedElementExportedViaModuleExports === false)) {

		//(a)
		//syntax: <imported_definition_alias> = require(<modulePath>).<imported_definition_name>
		//or importedElement bound to the export object (import brings the module object)
		//does not apply to properties bound to the export object
		//keep all references
		return elementRefIdentifiers;
	}

	//syntax: <imported_definition_alias> = require(<modulePath>)
	//and imported definition assigned to the export object
	if(importedElement.dataType === 'property' &&
	importedElement.isImportedElementExportedViaModuleExports === true) {

		return elementRefIdentifiers;
	}

	//(b)
	//import an object and access >1 of its properties (a namespace import will be imported)
	if(importedElement.dataType === 'property' &&
	importedElement.isImportedElementExportedViaModuleExports === false &&
	importedElement.accessedProperties.length > 0) {

		// return elementRefIdentifiers;

		elementRefIdentifiers = elementRefIdentifiers.filter(elemRef => {

			return elemRef != null;
		});

		return elementRefIdentifiers.map(importedElRef => importedElRef.parentPath);
	}

	let importedElementReferences = elementRefIdentifiers.filter(elementRef => {

		if(elementRef == null) {

			return false;
		}

		if(elementRef.parentPath.value.type === 'MemberExpression' &&
		   elementRef.parentPath.value.property.type === 'Identifier' && elementRef.parentPath.value.property.name === importedElement.elementName) {

			return true;
		}

		return false;
	});

	importedElementReferences = importedElementReferences.map(importedElRef => importedElRef.parentPath);

	return importedElementReferences;
}

/**
 * Determines whether importedElement is used (and thus needs to be imported)
 * besides its accessed properties.
 * @param {*} importedElement 
 * @param {*} elementRefIdentifiers 
 */
function isFunctionUsedBesidesItsProperties(jscodeshiftAPI, importedElement, elementRefIdentifiers) {

	let builtinFunctionObjectProperties = ['arguments', 'caller', 'displayName', 'length', 'name', 'prototype',
										   'apply', 'bind', 'call', 'toSource', 'toString'];

	let elementReferences = elementRefIdentifiers.filter(elementRef => {

		return elementRef != null && elementRef.parentPath.value.type !== 'MemberExpression';
	});

	//importedElement is a constructor function
	//after refactoring it is PARTIALLY destructured, if it has bound properties
	//import object in the case that: 
	//(a) it is referenced outside member expressions at least once
	//(b) it is referenced inside member expressions, but the properties accessed are built-in function object properties
	//TODO: check if constructor properties are used (not destructured)
	if(importedElement.isFunctionConstructor === true) {

		//(a)
		if(elementReferences.length > 0) {

			return true;
		}

		//(b)
		let refsToBuiltInFuncObjProp = elementRefIdentifiers.find(elementRef => {

			return elementRef.parentPath.value.type === 'MemberExpression' &&
					elementRef.parentPath.value.property.type === 'Identifier' &&
					builtinFunctionObjectProperties.indexOf(elementRef.parentPath.value.property.name) !== -1;
		});

		if(refsToBuiltInFuncObjProp != undefined) {

			return true;
		}

		let constructorPropRef = elementRefIdentifiers.find(elementRef => {

			let newExps = jscodeshiftAPI(elementRef).closest(jscodeshiftAPI.NewExpression);

			return newExps.length > 0;
		});

		if(constructorPropRef != undefined) {

			return true;
		}

		return false;

		// let refsToBuiltInFuncObjProps = elementRefIdentifiers.filter(elementRef => {

		// 	return elementRef.parentPath.value.type === 'MemberExpression' &&
		// 			elementRef.parentPath.value.property.type === 'Identifier' &&
		// 			builtinFunctionObjectProperties.indexOf(elementRef.parentPath.value.property.name) !== -1;
		// });

		// if(refsToBuiltInFuncObjProps.length > 0) {

		// 	return true;
		// }

		// return false;
	}

	let functionProperties = (importedElement.dataType === 'function' ? importedElement.functionProperties : importedElement.objectProperties);

	//determine if there are properties of importedElement which are not statically defined in its definition module, 
	//but are used in the module
	//(case: an object initialized with a call expression (dynamic definition of object), 
	//with dynamically bound properties which are referenced)
	let dynamicPropsAccessed = importedElement.accessedProperties.some(accessedProp => {

		return functionProperties.some(functionProp => {

			return functionProp.propertyName === accessedProp.propertyName;

		}) === false;
	});

	//importedElement is not a constructor function
	//after refactoring it is FULLY destructured, in the case it is not referenced outside member expressions
	//import object in the case that:
	//(a) either it has bound properties, but it's referenced outside member expressions at least once
	//(b) or it has not any bound properties, but it's referenced at least once in the module
	if((functionProperties.length > 0 && (elementReferences.length > 0 || dynamicPropsAccessed === true)) ||
	   (functionProperties.length === 0 && elementRefIdentifiers.length > 0)) {

		return true;
	}

	return false;
}

/**
 * Inserts importDeclaration at the AST specified in astRootCollection,
 * in the case that it is not already imported in module.
 * Needed for preventing bugs due to duplicate imported definitions.
 */
function introduceImportDeclarationInModule(jscodeshiftAPI, astRootCollection, importDeclaration) {
	
	// console.log(jscodeshiftAPI(importDeclaration).toSource());

	//an ES6 import is introduced
	let importedSource = importDeclaration.source;
	let importedSpecifiers = importDeclaration.specifiers;

	//add importDeclaration after the existing ES6 imports
	let es6ImportStatements = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);

	//if the specific import exists, do not introduce it again (prevent bugs due to duplicate imports)
	let introducedImports = es6ImportStatements.filter(introducedImport => {

		// console.log(introducedImport.value.specifiers);
		// console.log(importDeclaration)

		let introducedSource = introducedImport.value.source;

		if(introducedSource.value !== importedSource.value) {

			return false;
		}

		let introducedSpecifiers = introducedImport.value.specifiers;

		let importSpecifierExists = false;
		for(let importedSpecifierIndex = 0; importedSpecifierIndex < importedSpecifiers.length; importedSpecifierIndex++) {

			let importedSpecifier = importedSpecifiers[importedSpecifierIndex];
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

			let retrievedIdentifiers = introducedSpecifiers.filter(introducedSpecifier => {

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

			if(retrievedIdentifiers.length > 0) {

				importSpecifierExists = true;
				break;
			}
		}
		
		if(importSpecifierExists === true) {

			return true;
		}

		return false;

		// return introducedImport.value.specifiers === importDeclaration.specifiers && introducedImport.value.source === importDeclaration.source;
	});

	// console.log(jscodeshiftAPI(importDeclaration).toSource())
	if(introducedImports.length === 0) {

		if(es6ImportStatements.length > 0) {

			//ES6 import statements exist - add importDeclaration after the last ES6 import
			jscodeshiftAPI(es6ImportStatements.at(-1).get()).insertAfter(importDeclaration);
		}
		else {

			//ES6 import statements do not exist - add the top of the AST
			// console.log(astRootCollection.toSource());
			astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(importDeclaration);
		}
	}

	// console.log(astRootCollection.toSource());
}

/**
 * Removes an import statement of a commonJS module.
 * @param jscodeshiftAPI
 * @param astRootCollection
 * @param definition
 * @returns the identifier that is accessed in the removed import statement
 */
function removeCommonJSRequireStatement(jscodeshiftAPI, astRootCollection, transformationInfo) {

	let importedElement = transformationInfo.importedElement;
	// var importSource = importedElement.definitionModuleName.value;

	let importSource = importedElement.definitionModuleName;
	let isImportedElementExportedViaModuleExports = importedElement.isImportedElementExportedViaModuleExports;
	// let elementProperties = importedElement.dataType === 'function' ? importedElement.functionProperties : importedElement.objectProperties;

	//update: what if a module is required multiple times (withing multiple function definitions)?
	//get the first call
	let impElNode = importedElement.importedElementNodes[0];
	let impElNodeCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, impElNode);

	if(impElNodeCollection.length === 0) {

		return [];
	}

	let importedElementNode = impElNodeCollection.at(0).get().value;

	// var importedElementNode = importedElement.importedElementNodes[0];

	if(importedElementNode.callee.type !== 'Identifier' || 
		importedElementNode.callee.name !== 'require') {

		//not an invocation of require() provided by CommonJS (an import through an external package, e.g. sandbox/proxy)
		//do not remove statement, simply replace all references to this element
		//to references of the imported object (switching ES6 default to named exports)
		//changes semantics: in the former case the export object is the exported definition
		//in the latter case the export object contains the exported definition as a property
		if(isImportedElementExportedViaModuleExports === true) {

			// let elementReferences = locateImportedElementReferencesInAST(jscodeshiftAPI, astRootCollection, importedElement);

			//locate importedElement's references in the AST (need to be modified, along with the ES6 import introduction)
			//filter out element references for each require() invocation
			//importedElement might be imported multiple times (under a different alias)
			/**
			 * {impElNode: <AST node>,
				elementRefIdentifiers: <AST node>}
			*/
			let elemRefObjs = locateImportedElementReferencesInAST(jscodeshiftAPI, astRootCollection, importedElement);
			
			let elementReferences;
			let elemRefObj = elemRefObjs.find(elemRefObj => {

				let impElASTNodeLoc = elemRefObj.impElNode.value.loc;
				// console.log(elemRefObj)
				// console.log(impElASTNodeLoc);
				
				return impElASTNodeLoc.start.line === impElNodeLoc.start.line &&
						impElASTNodeLoc.start.column === impElNodeLoc.start.column &&
						impElASTNodeLoc.end.line === impElNodeLoc.end.line &&
						impElASTNodeLoc.end.column === impElNodeLoc.end.column;
			});

			if(elemRefObj === undefined) {

				elementReferences = [];
			}
			else {

				elementReferences = elemRefObj.elementReferences;
			}

			renameFunctionPropertyReferencesToVariableReferences(jscodeshiftAPI, astRootCollection, transformationInfo.filePath, importedElement, elementReferences, false);

			// let usedGlobalIdentifiers = importedElement.usageSet;
			// let elementIdentifier = jscodeshiftAPI.identifier(importedElement.elementName);
			// let aliasIdentifier = jscodeshiftAPI.identifier(importedElement.aliasName);

			
		}

		return [];
	}
	
	// var importedElementObject;
	// var isImportNestedInBlockStatement;

	let transformationType = transformationInfo.dependencyType;

	let filePath = transformationInfo.filePath;
	
	//(i) find import statement that needs to be removed
	//search by node representing the import statement

	let importedElementObjects = importedElement.importedElementNodes.map(importedElementNode => {

		//find specific call to require() through the AST CallExpression node
		//callee: function called in CallExpression node (contains the range, 
		//namely the position of the node in the AST)

		let callExpressions = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, importedElementNode);
		
		if(callExpressions.length === 0) {

			return null;
		}

		//1-1 mapping between node and its location
		let callExpression = callExpressions.at(0).get();
		let isImportNestedInBlockStatement = importedElement.isNested;
		let importedElementObject = {};
		importedElementObject.isNested = isImportNestedInBlockStatement;

		// console.log(callExpression.parentPath.value);

		//applies only in cases of a nested import 
		//(inside multiple expressions, apart from single member expressions)
		importedElementObject.isNestedInMemberExpression = isImportNestedInBlockStatement === false ?
															false:
															callExpression.parentPath.value.type === 'MemberExpression' &&
															callExpression.parentPath.value.property.type === 'Identifier' &&
															callExpression.parentPath.value.property.name === importedElement.elementName;
		
		/*ES6 named import needs two (or three) elements:
		(1) the name of the imported element's definition module
		(2) the name of the imported element
		(3) an alias of the imported element (optional)*/
		
		/* (1) find the name of the imported element's definition module
		(1st argument of require()) */
		let callExpressionValue = callExpression.value;
		let calleeArguments = callExpression.value.arguments;
		if(calleeArguments === undefined) {

			return null;
		}

		// console.log(callExpression);
		let importedSourceFileName = calleeArguments[0];
		importedElementObject['definitionModule'] = importedSourceFileName;
		
		/* (2) find the name of the imported element
		//case 1: after call to require(), a property is accessed (parentNode is a MemberExpression)
		//case 2: after call to require(), no property is accessed (parentNode is a VariableDeclarator) */
		let importedProperty = null;
		let importedElementAlias = null;
		let importedElementAssignedToProperty;
		let grandParentNode;
		let parentNode = callExpression.parentPath;
		let parentNodeValue = parentNode.value;
		let parentNodeValueType = parentNodeValue.type;
		let comments = null;
		let resultObject;
		let propertyOfIteratedObjectAccessed = false;

		// console.log(isImportNestedInBlockStatement);
		// console.log(parentNode.value);

		// console.log(isImportNestedInBlockStatement);

		if(isImportNestedInBlockStatement === true || 
			parentNode.value.type === 'CallExpression' || 
			parentNode.value.type === 'Property' ||
			((transformationInfo.dependencyType === 'NamespaceImport' || 
			transformationInfo.dependencyType === 'NamespaceModification') &&
			parentNodeValueType === 'MemberExpression')) {

			// console.log(parentNodeValueType);
			//case: parent node of import statement is a call expression or located in nested scope or assigned to an object's property
			//syntax: require(<modulePath>)()
			let importModule = path.basename(importedElement.definitionModuleName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '');

			//differentiate import alias in the case that imported module is an external module
			//prevent bugs due to exported and local modules and variables with the same name
			//imported alias always depends on the definition's name and its definition module's name
			if(importedElement.definitionModuleName.startsWith('.') === false) {

				// importModule = path.basename(importedElement.definitionModuleName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '');
				// importedProperty = (path.basename(importedElement.definitionModuleName, '.js') + '_' + importedElement.elementName).replace(/[^a-zA-Z0-9_ ]/g, '');
				importedProperty = `ext_${importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '')}`;
				// importedProperty = 'ext_' + importedProperty;
				importedElementAlias = importedProperty;
			}
			else if(importedElement.elementName === null && importedElement.aliasName === null) {

				importedProperty = null;
				importedElementAlias = importedProperty;
			}
			else if(parentNodeValueType === 'MemberExpression' && 
					importedElement.numberOfPropertiesExportedFromModule > 1) {

				if(importedElement.isObjectReferenced === true ||
					importedElement.isNested === true ||
					importedElement.isMappedToImportedAndReexportedDefinitions === true) {

					importedProperty = importedElement.definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '') + 'js';
					importedElementAlias = importedProperty;
				}
				else {

					// importedProperty = importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');
					importedProperty = parentNodeValue.property.type === 'Identifier' ?
										parentNodeValue.property.name :
										importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');

					importedElementAlias = `${importModule}_${importedProperty}`;
				}
			}
			else {

				//imported element is an object with bound properties that is referenced outside member expressions
				//it is named with its alias

				// importedProperty = (path.basename(importedElement.definitionModuleName, '.js') + 'js').replace(/[^a-zA-Z0-9_ ]/g, '');
				let aliasName = importedElement.aliasName === undefined ? importedElement.elementName : importedElement.aliasName;
				let importedModulePath = importedElement.definitionModuleName;

				let localIdentifierName;
				if(isImportNestedInBlockStatement === true && importedElement.dataType === 'property' && importedElement.numberOfPropertiesExportedFromModule > 1) {

					//imported element is a property exported from its definition module along
					//with other properties (a namespace import will be introduced since the import is nested)
					//avoid using reserved words as names (case: mathjs)
					localIdentifierName = importedElement.definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '') + '_obj';
					importedProperty = localIdentifierName;
					importedElementAlias = importedProperty;

					//prevent name collisions due to modules with the same name that are located in different directories
					// importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
				}
				else {

					// localIdentifierName = aliasName;

					//name too big, which causes problems in jscodeshift (?)
					//prevent name collisions due to modules with the same name which are located in different directories
					localIdentifierName = aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');
					importedProperty = importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '');
					// importedProperty = localIdentifierName;

					//prevent name collisions due to modules with the same name that are located in different directories
					importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
				}

				// importedProperty = localIdentifierName + 'js';

				// if(fs.statSync(importedElement.definitionModuleName).isDirectory() === true) {

				// 	importedElementAlias = importModulePath;
				// }
				// else {

				// 	importedElementAlias = path.dirname(importModulePath);
				// }

				// //prevent name collisions due to modules with the same name that are located in different directories
				// importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
				// importedProperty = (importedElement.elementName !== null ? importedElement.elementName + 'js' : (path.basename(importedElement.definitionModuleName, '.js') + 'js'));
				// importedProperty = importedProperty.replace(/[^a-zA-Z0-9_ ]/g, '');
			}

			let replaceName = importedElementAlias;

			// var requireResultcallExpressionCollection = astRootCollection.find(jscodeshiftAPI.CallExpression, callExpressionValue);

			//search specific require() invocation, 
			//in case that it specifies a module with no exported features
			let requireResultcallExpressionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, callExpressionValue);
			if(requireResultcallExpressionCollection.length === 0) {

				return null;
			}

			if(importedElement.isMappedToExportedDefinitions === false) {

				//require() assigned to an object's property, but imported module does not export any definition
				if(importedElement.definitionModuleName.startsWith('.') === true) {

					requireResultcallExpressionCollection.replaceWith(node => { 
						
						return jscodeshiftAPI.objectExpression([]);
					});
				}
				else {

					requireResultcallExpressionCollection.replaceWith(node => {

						return jscodeshiftAPI.identifier(replaceName);
					});
				}
				
			}
			else {

				//replace references of importedElement with a reference to its alias
				//imported definitions are imported through their actual names,
				//but they're used with their aliases (in order to prevent name collisions)
				// let replaceName = importedElementAlias;

				//don't replace require() with replaceName ref when:
				//(a) it's mapped to an imported and re-exported definition and
				//(b) it's not bound to the module object (re-exported from this module) and
				//(c) it's not bound to a feat assigned with the module object (re-exported from this module) and
				//(d) it's not nested and
				//(e) it has no refs
				if(importedElement.isMappedToImportedAndReexportedDefinitions === true &&
					importedElement.boundToExportedDefinition === false &&
					importedElement.impElBoundToFeatAssignedWithModObj === false &&
					importedElement.isNested === false &&
					importedElement.usageSet.length === 0) {

					let objExp = jscodeshiftAPI.objectExpression([]);

					if(parentNodeValueType === 'MemberExpression') {

						requireResultcallExpressionCollection.forEach(node => {

							jscodeshiftAPI(node.parentPath).replaceWith(objExp);
						});
					}
					else {

						requireResultcallExpressionCollection.replaceWith(node => {

							return objExp;
						});
					}

				}
				else if(importedElement.dataType === 'property' &&
					(importedElementObject.isNestedInMemberExpression === true ||
						parentNodeValueType === 'MemberExpression')) {

					//importedElement is a property,
					//while import expression is nested in multiple expressions
					//and its parent is a member expression accessing importedElement
					//transform its parent (the member expression) 
					requireResultcallExpressionCollection.forEach(node => {

						let idNode = jscodeshiftAPI.identifier(replaceName);
						// if(importedElement.isMappedToImportedAndReexportedDefinitions === true &&
						// 	importedElement.isImportedElementExportedViaModuleExports === false &&
						// 	importedElement.numberOfPropertiesExportedFromModule > 1) {

						// 		jscodeshiftAPI(node).replaceWith(idNode);
						// 		return;
						// 	}

						if(importedElement.isMappedToImportedAndReexportedDefinitions === true &&
							importedElement.isImportedElementExportedViaModuleExports === false) {

								jscodeshiftAPI(node).replaceWith(idNode);
								return;
							}

						if(importedElement.isImportedElementExportedViaModuleExports === true) {

							jscodeshiftAPI(node).replaceWith(idNode);
							return;
						}

						jscodeshiftAPI(node.parentPath).replaceWith(idNode);
					})
				}
				else {

					requireResultcallExpressionCollection.replaceWith(node => {

						// var identifierNode = jscodeshiftAPI.identifier(importModule + '_' + importedProperty);
						let identifierNode = jscodeshiftAPI.identifier(replaceName);
						return identifierNode;
					});
				}


				// requireResultcallExpressionCollection.replaceWith(node => {

				// 	// var identifierNode = jscodeshiftAPI.identifier(importModule + '_' + importedProperty);
				// 	let identifierNode = jscodeshiftAPI.identifier(replaceName);
				// 	return identifierNode;
				// });
			}

			// importedElementAlias = importedProperty;
		}
		else if(parentNode.value.type === 'MemberExpression') {
			
			//parentNode is a MemberExpression
			//(parentNode syntax: require(<modulePath>).<modulePropertyName>)
			resultObject = transformRequireMemberExpression(jscodeshiftAPI, astRootCollection, parentNode, callExpressions, importedElement, filePath);
			importedProperty = resultObject.importedProperty;
			importedElementAlias = resultObject.importedElementAlias;
			comments = resultObject.comments;
			propertyOfIteratedObjectAccessed = resultObject.propertyOfIteratedObjectAccessed;
		}
		else if(parentNode.value.type === 'VariableDeclarator') {
			
			//parentNode is a VariableDeclarator
			//(syntax: <variableName> = require(<modulePath>))
			importedProperty = transformationInfo.importedElement.elementName;
			resultObject = transformRequireVariableDeclarator(jscodeshiftAPI, filePath, astRootCollection, parentNode, importedElement);
			importedProperty = resultObject.importedProperty;
			importedElementAlias = resultObject.importedElementAlias;
			comments = resultObject.comments;
		}
		else if(parentNode.value.type === 'AssignmentExpression') {
			
			//parentNode is an AssignmentExpression (syntax: <leftOperand> = require(<modulePath>))
			//case: result of requireCall is assigned directly to exports/module.exports (or a variable)
			//syntax: exports.<exportedElementIdentifier> = require(<modulePath>) or
			//		  module.exports = require(<modulePath) or
			//		  <identifier> = require(<modulePath)
			// importedProperty = transformationInfo.importedElement.elementName;
			resultObject = transformRequireAssignmentExpression(jscodeshiftAPI, filePath, astRootCollection, parentNode, callExpressions, importedElement, isImportNestedInBlockStatement, transformationType);
			// console.log(resultObject);
			importedProperty = resultObject.importedProperty;
			importedElementAlias = resultObject.importedElementAlias;
			importedElementAssignedToProperty = resultObject.importedElementAssignedToProperty;
			comments = resultObject.comments;
		}
		else if(parentNode.value.type === 'ExpressionStatement') {

			//parentNode is an ExpressionStatement (syntax: require(<modulePath>);)
			//replace require call with an ES6 module import statement (syntax: import <modulePath>)
			astRootCollection.find(jscodeshiftAPI.ExpressionStatement)
							 .filter(path => {return path.value === parentNode.value;})
							 .remove();
			importedProperty = null;
			importedElementAlias = null;
			comments = null;
		}
		else {

			//import statement inside other expressions (e.g. NewExpression)
			importedProperty = importedElement.elementName;
			importedElementAlias = importedElement.aliasName;

			//replace require() invocation with the importedElement's alias
			//(these imported object have no uses)
			let requireResultcallExpressionCollection = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, callExpressionValue);
			if(requireResultcallExpressionCollection.length === 0) {

				return null;
			}

			requireResultcallExpressionCollection.replaceWith(node => {

				return jscodeshiftAPI.identifier(importedElementAlias);
			});
		}
		
		importedElementObject['importedModuleProperty'] = importedProperty;
		
		//(3) find alias of the imported element
		//(the name of the variable that is assigned the result of the call to require())
		importedElementObject['importedModulePropertyAlias'] = importedElementAlias;

		importedElementObject['importedElementAssignedToProperty'] = importedElementAssignedToProperty;

		importedElementObject['comments'] = comments;

		//add parentNodeValueType to importedElementObject
		//(i)  parentNodeValueType = 'MemberExpression': export statement syntax: var <variableName> = require(<modulePath>).<elementName> => import {<elementName> [as <variableName>]} from '<modulePath>';
		//(ii) parentNodeValueType = 'VariableDeclarator': export statement syntax: var <variableName> = require(<modulePath>) => import * as <variableName> from 'modulePath';
		importedElementObject['parentNodeValueType'] = parentNodeValue.type;

		importedElementObject.propertyOfIteratedObjectAccessed = propertyOfIteratedObjectAccessed;

		// console.log(importedElementObject);

		//update: what if a module is required multiple times?
		return importedElementObject;

		// var callExpression;

		// console.log(callExpressions.length);
		
	});
	
	return importedElementObjects;

	// var importedElementObjects = [];
	// importedElement.importedElementNodes.forEach(function(importedElementNode) {

	// 	//find specific call to require() through the AST CallExpression node
	// 	//callee: function called in CallExpression node (contains the range, 
	// 	//namely the position of the node in the AST)
	// 	var callExpressions = astRootCollection.find(jscodeshiftAPI.CallExpression, {callee: importedElementNode.callee});
	// 	var callExpression;

	// 	// console.log(callExpressions.length);
		
	// 	for(var callExpressionIndex = 0; callExpressionIndex < callExpressions.length; callExpressionIndex++) {
			
	// 		callExpression = callExpressions.at(callExpressionIndex).get();

	// 		isImportNestedInBlockStatement = importedElement.isNested;
	// 		importedElementObject = {};
	// 		importedElementObject.isNested = isImportNestedInBlockStatement;
			
	// 		/*ES6 named import needs two (or three) elements:
	// 		(1) the name of the imported element's definition module
	// 		(2) the name of the imported element
	// 		(3) an alias of the imported element (optional)*/
			
	// 		/* (1) find the name of the imported element's definition module
	// 		(1st argument of require()) */
	// 		var callExpressionValue = callExpression.value;
	// 		var calleeArguments = callExpression.value.arguments;
	// 		if(calleeArguments === undefined) {

	// 			continue;
	// 		}

	// 		// console.log(callExpression);
	// 		var importedSourceFileName = calleeArguments[0];
	// 		importedElementObject['definitionModule'] = importedSourceFileName;
			
	// 		/* (2) find the name of the imported element
	// 		//case 1: after call to require(), a property is accessed (parentNode is a MemberExpression)
	// 		//case 2: after call to require(), no property is accessed (parentNode is a VariableDeclarator) */
	// 		var importedProperty = null;
	// 		var importedElementAlias = null;
	// 		var grandParentNode;
	// 		var parentNode = callExpression.parentPath;
	// 		var parentNodeValue = parentNode.value;
	// 		var parentNodeValueType = parentNodeValue.type;
	// 		var comments = null;
	// 		var resultObject;
	// 		let propertyOfIteratedObjectAccessed = false;

	// 		// console.log(isImportNestedInBlockStatement);
	// 		// console.log(parentNode.value);

	// 		// console.log(isImportNestedInBlockStatement);

	// 		if(isImportNestedInBlockStatement === true || 
	// 			parentNode.value.type === 'CallExpression' || 
	// 			parentNode.value.type === 'Property' ||
	// 			((transformationInfo.dependencyType === 'NamespaceImport' || 
	// 			transformationInfo.dependencyType === 'NamespaceModification') &&
	// 			parentNodeValueType === 'MemberExpression')) {

	// 			// console.log(parentNodeValueType);
	// 			//case: parent node of import statement is a call expression or located in nested scope or assigned to an object's property
	// 			//syntax: require(<modulePath>)()
	// 			let importModule = path.basename(importedElement.definitionModuleName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '');

	// 			//differentiate import alias in the case that imported module is an external module
	// 			//prevent bugs due to exported and local modules and variables with the same name
	// 			//imported alias always depends on the definition's name and its definition module's name
	// 			if(importedElement.definitionModuleName.startsWith('.') === false) {

	// 				// importModule = path.basename(importedElement.definitionModuleName, '.js').replace(/[^a-zA-Z0-9_ ]/g, '');
	// 				// importedProperty = (path.basename(importedElement.definitionModuleName, '.js') + '_' + importedElement.elementName).replace(/[^a-zA-Z0-9_ ]/g, '');
	// 				importedProperty = `ext_${importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '')}`;
	// 				// importedProperty = 'ext_' + importedProperty;
	// 				importedElementAlias = importedProperty;
	// 			}
	// 			else if(importedElement.elementName === null && importedElement.aliasName === null) {

	// 				importedProperty = null;
	// 				importedElementAlias = importedProperty;
	// 			}
	// 			else {

	// 				//imported element is an object with bound properties that is referenced outside member expressions
	// 				//it is named with its alias

	// 				// importedProperty = (path.basename(importedElement.definitionModuleName, '.js') + 'js').replace(/[^a-zA-Z0-9_ ]/g, '');
	// 				let aliasName = importedElement.aliasName === undefined ? importedElement.elementName : importedElement.aliasName;
	// 				let importedModulePath = importedElement.definitionModuleName;

	// 				let localIdentifierName;
	// 				if(isImportNestedInBlockStatement === true && importedElement.dataType === 'property' && importedElement.numberOfPropertiesExportedFromModule > 1) {

	// 					//imported element is a property exported from its definition module along
	// 					//with other properties (a namespace import will be introduced since the import is nested)
	// 					//avoid using reserved words as names (case: mathjs)
	// 					localIdentifierName = importedElement.definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, '') + '_obj';
	// 					importedProperty = localIdentifierName;
	// 					importedElementAlias = importedProperty;

	// 					//prevent name collisions due to modules with the same name that are located in different directories
	// 					// importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
	// 				}
	// 				else {

	// 					// localIdentifierName = aliasName;

	// 					//name too big, which causes problems in jscodeshift (?)
	// 					//prevent name collisions due to modules with the same name which are located in different directories
	// 					localIdentifierName = aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');
	// 					importedProperty = importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '');
	// 					// importedProperty = localIdentifierName;

	// 					//prevent name collisions due to modules with the same name that are located in different directories
	// 					importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
	// 				}

	// 				// importedProperty = localIdentifierName + 'js';

	// 				// if(fs.statSync(importedElement.definitionModuleName).isDirectory() === true) {

	// 				// 	importedElementAlias = importModulePath;
	// 				// }
	// 				// else {

	// 				// 	importedElementAlias = path.dirname(importModulePath);
	// 				// }

	// 				// //prevent name collisions due to modules with the same name that are located in different directories
	// 				// importedElementAlias = importedModulePath.replace(/[^a-zA-Z0-9_ ]/g, '') + '_' + importedProperty;
	// 				// importedProperty = (importedElement.elementName !== null ? importedElement.elementName + 'js' : (path.basename(importedElement.definitionModuleName, '.js') + 'js'));
	// 				// importedProperty = importedProperty.replace(/[^a-zA-Z0-9_ ]/g, '');
	// 			}

	// 			let replaceName = importedElementAlias;

	// 			var requireResultcallExpressionCollection = astRootCollection.find(jscodeshiftAPI.CallExpression, callExpressionValue);
	// 			if(requireResultcallExpressionCollection.length === 0) {

	// 				return;
	// 			}

	// 			if(importedElement.isMappedToExportedDefinitions === false) {

	// 				//require() assigned to an object's property, but imported module does not export any definition
	// 				if(importedElement.definitionModuleName.startsWith('.') === true) {

	// 					requireResultcallExpressionCollection.replaceWith(node => { 
							
	// 						return jscodeshiftAPI.objectExpression([]);
	// 					});
	// 				}
	// 				else {

	// 					requireResultcallExpressionCollection.replaceWith(node => {

	// 						return jscodeshiftAPI.identifier(replaceName);
	// 					});
	// 				}
					
	// 			}
	// 			else if(requireResultcallExpressionCollection.length > 0) {

	// 				//replace references of importedElement with a reference to its alias
	// 				//imported definitions are imported through their actual names,
	// 				//but they're used with their aliases (in order to prevent name collisions)
	// 				// let replaceName = importedElementAlias;

	// 				requireResultcallExpressionCollection.replaceWith(node => {

	// 					// var identifierNode = jscodeshiftAPI.identifier(importModule + '_' + importedProperty);
	// 					var identifierNode = jscodeshiftAPI.identifier(replaceName);
	// 					return identifierNode;
	// 				});
	// 			}

	// 			// importedElementAlias = importedProperty;
	// 		}
	// 		else if(parentNode.value.type === 'MemberExpression') {
				
	// 			//parentNode is a MemberExpression
	// 			//(parentNode syntax: require(<modulePath>).<modulePropertyName>)
	// 			resultObject = transformRequireMemberExpression(jscodeshiftAPI, astRootCollection, parentNode, callExpressions, importedElement, filePath);
	// 			importedProperty = resultObject.importedProperty;
	// 			importedElementAlias = resultObject.importedElementAlias;
	// 			comments = resultObject.comments;
	// 			propertyOfIteratedObjectAccessed = resultObject.propertyOfIteratedObjectAccessed;
	// 		}
	// 		else if(parentNode.value.type === 'VariableDeclarator') {
				
	// 			//parentNode is a VariableDeclarator
	// 			//(syntax: <variableName> = require(<modulePath>))
	// 			importedProperty = transformationInfo.importedElement.elementName;
	// 			resultObject = transformRequireVariableDeclarator(jscodeshiftAPI, filePath, astRootCollection, parentNode, importedElement);
	// 			importedProperty = resultObject.importedProperty;
	// 			importedElementAlias = resultObject.importedElementAlias;
	// 			comments = resultObject.comments;
	// 		}
	// 		else if(parentNode.value.type === 'AssignmentExpression') {
				
	// 			//parentNode is an AssignmentExpression (syntax: <leftOperand> = require(<modulePath>))
	// 			//case: result of requireCall is assigned directly to exports/module.exports (or a variable)
	// 			//syntax: exports.<exportedElementIdentifier> = require(<modulePath>) or
	// 			//		  module.exports = require(<modulePath) or
	// 			//		  <identifier> = require(<modulePath)
	// 			// importedProperty = transformationInfo.importedElement.elementName;
	// 			resultObject = transformRequireAssignmentExpression(jscodeshiftAPI, filePath, astRootCollection, parentNode, callExpressions, importedElement, isImportNestedInBlockStatement, transformationType);
	// 			// console.log(resultObject);
	// 			importedProperty = resultObject.importedProperty;
	// 			importedElementAlias = resultObject.importedElementAlias;
	// 			comments = resultObject.comments;
	// 		}
	// 		else if(parentNode.value.type === 'ExpressionStatement') {

	// 			//parentNode is an ExpressionStatement (syntax: require(<modulePath>);)
	// 			//replace require call with an ES6 module import statement (syntax: import <modulePath>)
	// 			astRootCollection.find(jscodeshiftAPI.ExpressionStatement)
	// 							 .filter(path => {return path.value === parentNode.value;})
	// 							 .remove();
	// 			importedProperty = null;
	// 			importedElementAlias = null;
	// 			comments = null;
	// 		}
			
	// 		importedElementObject['importedModuleProperty'] = importedProperty;
			
	// 		//(3) find alias of the imported element
	// 		//(the name of the variable that is assigned the result of the call to require())
	// 		importedElementObject['importedModulePropertyAlias'] = importedElementAlias;

	// 		importedElementObject['comments'] = comments;

	// 		//add parentNodeValueType to importedElementObject
	// 		//(i)  parentNodeValueType = 'MemberExpression': export statement syntax: var <variableName> = require(<modulePath>).<elementName> => import {<elementName> [as <variableName>]} from '<modulePath>';
	// 		//(ii) parentNodeValueType = 'VariableDeclarator': export statement syntax: var <variableName> = require(<modulePath>) => import * as <variableName> from 'modulePath';
	// 		importedElementObject['parentNodeValueType'] = parentNodeValue.type;

	// 		importedElementObject.propertyOfIteratedObjectAccessed = propertyOfIteratedObjectAccessed;

	// 		// console.log(importedElementObject);

	// 		//update: what if a module is required multiple times?
	// 		importedElementObjects.push(importedElementObject);
			
	// 		// return importedElementObject;
	// 	}
	// });
	// return importedElementObjects;



	// console.log(astRootCollection.toSource());
	
	
	// return importedElementObject;
}

/**
 * Transforms the assignment expression that contains a call of require().
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} parentNode 
 * @param {*} importedElement 
 */
function transformRequireAssignmentExpression(jscodeshiftAPI, filePath, astRootCollection, parentNode, callExpressions, importedElement, isImportNestedInBlockStatement) {

	//parentNode of require call is an assignment expression (syntax: <left operand> = require(<modulePath>))
	var leftOperand = parentNode.value.left;
	var resultObject = {};
	var accessedObject;
	var accessedProperty;
	var variableIdentifier;
	var exportSpecifier;
	var exportNode;
	var importedElementAlias;
	// var importSource = importedElement.definitionModuleName.value;
	var importSource = importedElement.definitionModuleName;
	var memberExpression;
	var exportedObjectName;
	var comments;
	var assignmentExpressions;

	let importedElementName = importedElement.definitionModuleName.startsWith('.') === false ? 
								importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '') :
								importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '')

	//the imported definition's alias is always depended on its name and its definition module
	//elementAlias depends on the whole path of imported module
	//in order to prevent name collisions due to definitions with the same name
	//that are imported from modules with the same name, but in different folder
	//elementAlias depends on the whole path of imported module
	//in order to prevent name collisions due to definitions with the same name
	//that are imported from modules with the same name, but in different folder
	//also prevent name collisions due to the use of the names of external modules in variables
	// let elementAlias = path.dirname(importSource);
	// if(importSource.startsWith('.') === true) {

	// 	// elementAlias += path.basename(require.resolve(path.dirname(filePath) + path.sep + importSource), '.js');
	// 	// elementAlias += '_' + importedElement.elementName;

	// }
	// else {

	// 	elementAlias = 'ext_' + elementAlias;
	// 	// elementAlias += path.basename(importSource, '.js') + '_' + importedElement.aliasName;
	// }
	// elementAlias = elementAlias.replace(/[^a-zA-Z0-9_ ]/g, '');

	let elementAlias = importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');
	
	//name conflicts with external module with the same name
	if(importSource.startsWith('.') === false) {

		elementAlias = `ext_${elementAlias}`;
	}


	// elementAlias = importedElement.definitionModuleName.startsWith('.') === true ? elementAlias + 'js' : elementAlias;

	if(isImportNestedInBlockStatement === true) {

		//require() nested in block - replace require call with the alias of imported element
		resultObject.importedProperty = elementAlias;
		resultObject.importedElementAlias = path.basename(importedElement.definitionModuleName.replace(/[^a-zA-Z0-9_ ]/g, ''), '.js') + '_moduleDefault';
		resultObject.comments = null;
		resultObject.isNested = true;

		callExpressions.replaceWith(path => {

			return jscodeshiftAPI.identifier(resultObject.importedElementAlias);
		});

		//update: if transformation involves the introduction of a NamespaceImport dependency,
		////update also uses of the namespace to uses of the namespace property

		resultObject.importedElementAssignedToProperty = false;
		return resultObject;
	}

	// console.log(leftOperand.type);
				
	//find alias of the imported element (the name of the variable that is assigned the result of the call to require())
	if(leftOperand.type === 'Identifier') {

		//syntax: <identifier> = require(<modulePath>)

		// console.log(parentNode.parentPath.value.type);
		if(parentNode.parentPath.value.type === 'VariableDeclarator') {
						
			//the assignment containing the require call is assigned to a variable (syntax: <variableName> = <identifier> = require(<modulePath>))
			//keep left operand of statement
			astRootCollection.find(jscodeshiftAPI.VariableDeclarator)
							 .filter(path => {return (path === parentNode.parentPath) })
							 .replaceWith(path => {
								 
								// console.log(path);
								path.value.init = jscodeshiftAPI.identifier(elementAlias);
								return path.value;
			});
		}

		if(leftOperand.name !== importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '')) {

			//the result of require call is assigned to a variable with name different to the imported element's alias
			//replace require call with the importedElement's alias (remove special chars)
			
			callExpressions.replaceWith(path => {

				return jscodeshiftAPI.identifier(elementAlias);
			});

			resultObject.importedElementAlias = elementAlias;
			resultObject.comments = null;
		}
		else {

			//the result of require call is assigned to a variable with the same name to imported element's
			//remove assignment
			astRootCollection.find(jscodeshiftAPI.AssignmentExpression)
							 .filter(path => {return (path === parentNode); })
							 .remove();

			resultObject.importedElementAlias = elementAlias;
			resultObject.comments = null;
		}
		
		resultObject.importedProperty = importedElementName;
		resultObject.importedElementAssignedToProperty = false;
		return resultObject;
	}
	
	if(leftOperand.type === 'MemberExpression') {

		//syntax: <memberExpression> = require(<modulePath>)
		//replace require call with a reference to imported element (the conversion of the exported property
		//is considered in another codemod)
		callExpressions.replaceWith(path => { 
			
			// return jscodeshiftAPI.identifier(importedElement.elementName.replace(/[^\w\s]/gi, '').replace(/-/g, '')); 
			return jscodeshiftAPI.identifier(elementAlias);
		});

		//imported definitions are exported under their actual name
		resultObject.importedProperty = importedElementName;
		resultObject.importedElementAlias = elementAlias;
		resultObject.importedElementAssignedToProperty = true;
		resultObject.comments = null;

		return resultObject;
	}

	resultObject.importedElementAssignedToProperty = false;
	return resultObject;
}

/**
 * Transforms the definition of the variable that is initialized with the result of a call of require().
 * Returns the alias of the imported element and the comments of the initial import statement.
 */
function transformRequireVariableDeclarator(jscodeshiftAPI, filePath, astRootCollection, parentNode, importedElement) {

	//parentNode of require call is a variable declarator (syntax: <variableName> = require(<modulePath>))
	var variableDeclaratorNode = parentNode;
	var importedElementAlias;
	var variableDeclaratorValueObjectProperties;

	// console.log(variableDeclaratorNode.value.id);

	//importedElement's name depends on:
	//(a) the definition's alias (in the case it is imported from an external module)
	//(b) the definition's name (in the case that it is imported from a local module)
	let importedElementName = importedElement.definitionModuleName.startsWith('.') === false ? 
								importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '') :
								importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '');

	let importSource = importedElement.definitionModuleName;

	//elementAlias depends on the whole path of imported module
	//in order to prevent name collisions due to definitions with the same name
	//that are imported from modules with the same name, but in different folder
	//also prevent name collisions due to the use of the names of external modules in variables
	// let elementAlias = path.dirname(importSource);
	// if(importSource.startsWith('.') === true) {

	// 	elementAlias += path.basename(require.resolve(path.dirname(filePath) + path.sep + importSource), '.js');
	// 	elementAlias += '_' + importedElement.elementName;
	// }
	// else {

	// 	elementAlias = 'ext_' + elementAlias;
	// 	elementAlias += path.basename(importSource, '.js') + '_' + importedElement.aliasName;
	// }

	// elementAlias = elementAlias.replace(/[^a-zA-Z0-9_ ]/g, '');

	let elementAlias = importedElement.aliasName.replace(/[^a-zA-Z0-9_ ]/g, '');
	if(importSource.startsWith('.') === false) {

		elementAlias = `ext_${elementAlias}`;
	}

	// elementAlias = importedElement.definitionModuleName.startsWith('.') === true ? elementAlias + 'js' : elementAlias;
				
	//remove node representing the whole import statement
	//(assignment expression where result of call to 
	//require() is assigned to a variable))
	//search VariableDeclaration AST node by node value (each variable assigned the result of a call to require() is defined once)
	//export/import statement are not processed, as their refactoring leads to runtime errors (maybe an extension?)
	var variableDeclarators = astRootCollection.find(jscodeshiftAPI.VariableDeclarator, variableDeclaratorNode.value);
	if(variableDeclarators.length === 0) {

		return null;
	}
	var variableDeclarator = variableDeclarators.at(0).get();

	// console.log(variableDeclarator.value);

	//keep comments of the AST node that is going to be deleted
	var comments = variableDeclarator.parentPath.value.comments;
	if(comments === undefined) {

		comments = null;
	}

	//find alias of the imported element
	//(the name of the variable that is assigned the result of the call to require())
	if(variableDeclaratorNode.value.id.name !== undefined) {

		importedElementAlias = variableDeclaratorNode.value.id.name;

		// console.log(variableDeclarators.length);
		// console.log(variableDeclarators)

		//remove the AST node representing the commonJS export statement
		variableDeclarators.remove();
	}
	else if (variableDeclaratorNode.value.id.type === 'ObjectPattern') {

		let aliasName = importedElement.aliasName == null ? importedElement.definitionModuleName : importedElement.aliasName;

		importedElementAlias = aliasName.replace(/[^a-zA-Z0-9_ ]/g, '') + '_obj';

		variableDeclarators.forEach(function(variableDeclarator) {

			variableDeclarator.value.init = jscodeshiftAPI.identifier(importedElementAlias);
			return variableDeclarator.value;
		});

		// variableDeclaratorValueObjectProperties = variableDeclaratorNode.value.id.properties;

		// console.log(variableDeclaratorValueObjectProperties[0]);

		// importedElementAlias = variableDeclaratorValueObjectProperties[0].key.name;
	}

	return {

		"importedProperty": importedElementName,
		"importedElementAlias": elementAlias,
		"comments": comments
	}
}

/**
 * Transforms member expression whose object represents a call of require().
 * Returns an object with the element that is imported, its alias and the initial statement's comments.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} parentNode 
 * @param {*} callExpressions 
 */
function transformRequireMemberExpression(jscodeshiftAPI, astRootCollection, parentNode, callExpressions, importedElement, filePath) {

	var importSource = importedElement.definitionModuleName;

	var grandParentNode = parentNode.parentPath;

	let functionProperties = (importedElement.dataType === 'function' ? importedElement.functionProperties : importedElement.objectProperties);
	let referencedProperties = functionProperties.filter(functionProp => {

		return functionProp.isExported === true;
	});

	//the alias of importedElement is always depending on its definition module and its name
	//prevent name collisions due to modules with the same name that are located in different directories
	//also prevent name collisions due to the use of the names of external modules in variables

	// var importedElementAlias = (path.dirname(importSource) + path.basename(require.resolve(importSource), '.js') + '_' + importedElement.elementName).replace(/[^a-zA-Z0-9_ ]/g, '');
	// var importedElementAlias = path.dirname(importSource);
	// if(importSource.startsWith('.') === true) {

	// 	importedElementAlias += path.basename(require.resolve(path.dirname(filePath) + path.sep + importSource), '.js');
	// 	importedElementAlias += '_' + importedElement.elementName;
	// }
	// else {

	// 	importedElementAlias = 'ext_' + importedElementAlias;
	// 	importedElementAlias += path.basename(importSource, '.js') + '_' + importedElement.aliasName;
	// }

	// importedElementAlias = importedElementAlias.replace(/[^a-zA-Z0-9_ ]/g, '');

	// importedElementAlias = importSource.startsWith('.') === true ? importedElementAlias + 'js' : importedElementAlias;

	//prevent name conflicts with external modules with the same name
	let importedElementAlias = importedElement.aliasName;
	if(importSource.startsWith('.') === false) {

		importedElementAlias = `ext_${importedElementAlias}`;
	}

	importedElementAlias = importedElementAlias.replace(/[^a-zA-Z0-9_ ]/g, '');
	importedElementAlias = importSource.startsWith('.') === true ? importedElementAlias + 'js' : importedElementAlias;

	// console.log(importedElementAlias);

	//imported definitions are exported under their actual names (only in the case they are defined in local modules)
	//in the case that none of the definition's properties are accessed,
	//the definition itself is imported
	//also, in the case that a property of an iterated object is imported
	//import the object instead of the property
	var importedProperty = importSource.startsWith('.') === false ? importedElementAlias : (referencedProperties.length === 0 || importedElement.isObjectReferenced === true ? importedElement.elementName.replace(/[^a-zA-Z0-9_ ]/g, '') : parentNode.value.property.name);
	
	var resultObject;
	if(grandParentNode.value.type === 'VariableDeclarator' && importSource.startsWith('.') === true && 
		(importedElement.isObjectReferenced === false || referencedProperties.length === 0)) {

		//grandParentNode is a variable declarator (syntax: <variableName> = require(<modulePath>).<modulePropertyName>)
		resultObject = removeDefinitionOfVariableInitializedWithTheResultOfRequire(jscodeshiftAPI, astRootCollection, grandParentNode);
		resultObject.importedProperty = importedProperty;
		resultObject.importedElementAlias = importedElementAlias;
		resultObject.comments = null;
		return resultObject;
	}
	
	callExpressions.replaceWith(path => {

		return jscodeshiftAPI.identifier(importedElementAlias);
	});

	return {

		"propertyOfIteratedObjectAccessed": importedElement.isObjectReferenced === true && referencedProperties.length > 0,
		"importedProperty": importedProperty,
		"importedElementAlias": importedElementAlias,
		"comments": null
	};
}

/**
 * Removes the AST node representing the definition of the variable that is initialized with the result of a call of require(). 
 * Returns the alias of the imported element, along with the comments of the initial statement (if any).
 * @param {*} jscodeshiftAPI 
 * @param {*} initialImportNode 
 */
function removeDefinitionOfVariableInitializedWithTheResultOfRequire(jscodeshiftAPI, astRootCollection, initialImportNode) {

	//initialImportNode is a VariableDeclarator (syntax: <variableName> = require(<modulePath>))
	//(3) find alias of the imported element (<variableName>) (the name of the variable that is assigned the result of the call to require())
	var importedElementAlias = initialImportNode.value.id.name;
					
	//remove node representing the whole import statement
	//search VariableDeclaration AST node by node value (each variable assigned the result of a call to require() is defined once)
	//export/import statement are not processed, as their refactoring leads to runtime errors (maybe an extension?)
	var variableDeclarations = astRootCollection.find(jscodeshiftAPI.VariableDeclarator, initialImportNode.value);
	if(variableDeclarations.length === 0) {

		return null;
	}

	var variableDeclaration = variableDeclarations.at(0).get();

	// console.log(variableDeclarations.length);

	//keep comments of the AST node that is going to be deleted
	var comments = variableDeclaration.parentPath.value.comments;
	if(comments === undefined) {

		comments = null;
	}

	//remove the AST node representing the commonJS export statement
	variableDeclarations.remove();

	return {

		"importedElementAlias": importedElementAlias,
		"comments": comments
	};
}

/**
 * Updates the statement representing the definition of the variable named importedElementAlias.
 * (Used in cases when an exported property is assigned the result of a require call).
 * @param {*} importedElementAlias 
 */
function updateVariableDeclarationStatement(jscodeshiftAPI, astRootCollection, importedElementAlias) {

	let variableDeclarationCollection = astRootCollection.find(jscodeshiftAPI.VariableDeclaration, {declarations: [
		{
			type: "VariableDeclarator",
			id: { name: importedElementAlias }
	}]});

	if(variableDeclarationCollection.length === 0) {

		return;
	}

	// console.log(importedElementAlias);

	let variableDeclaration = variableDeclarationCollection.at(0).get();

	// console.log(variableDeclaration.parentPath);

	//a variable with the same name with importedElementAlias exists
	//if it is contained in an ES6 export declaration, transform statement
	//otherwise, delete it
	//(a property's export results in the introduction of a variable definition:
	//this variable definition collides with the name of the element that is imported
	//through the ES6 import statement that was inserted)
	if(variableDeclaration.parentPath.value.type === 'ExportNamedDeclaration') {

		//variable declaration is contained in an export named declaration
		//transform export named declaration
		let surrExps = jscodeshiftAPI(variableDeclaration).closest(jscodeshiftAPI.ExportNamedDeclaration);
		if(surrExps.length === 0) {

			return;
		}

		surrExps.replaceWith(path => {

			//result of require call is assigned to a property of exports
			//create an export named declaration
			let variableIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
			let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
						
			//create an named export (the exported specifier is not a variable/function definition,
			//it is the element referenced by importedProperty)
			let exportNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

			// console.log(jscodeshiftAPI(exportNode).toSource());

			return exportNode;
		});

		return;

	}
	else if(variableDeclaration.parentPath.parentPath.value.type !== 'Program') {

		//erase variable definitions located in the module's top-level scope only
		//(do not erase variables local to functions)
		return;
	}
	else {

		let initializationValueNode = variableDeclaration.value.declarations[0].init;
		if(initializationValueNode !== null && initializationValueNode.type === 'AssignmentExpression') {

			variableDeclarationCollection.replaceWith(path => {

				// var assigmentOperator = '=';
				// var left
				var initializationAssignment = jscodeshiftAPI.assignmentExpression("=", initializationValueNode.left, 
				jscodeshiftAPI.identifier(initializationValueNode.right.name));

				return jscodeshiftAPI.expressionStatement(initializationAssignment);
			});

			return;
		}
	}

	//variable declaration is not contained in an ES6 export declaration
	//remove variable declaration
	//update: 1 variable declaration might define multiple variables
	//remove only the specific variable declarator
	//and remove the variable declaration only in the case it has no variable declarators
	variableDeclarationCollection.forEach(variableDeclaration => {

		//remove the specific declarator from variable declaration
		let declarators = variableDeclaration.value.declarations;
		let declarator = declarators.find(declarator => {

			return declarator.id.type !== 'Identifier' || 
					declarator.id.name !== importedElementAlias;
		});

		// console.log(declarators.length);
		if(declarator == undefined) {

			jscodeshiftAPI(variableDeclaration).remove();
			return;
		}

		return variableDeclaration.value;
	});

	// if(variableDeclarationCollection.length === 1) {

	// 	// console.log(importedElementAlias);

	// 	variableDeclaration = variableDeclarationCollection.at(0).get();

	// 	// console.log(variableDeclaration.parentPath);

	// 	//a variable with the same name with importedElementAlias exists
	// 	//if it is contained in an ES6 export declaration, transform statement
	// 	//otherwise, delete it
	// 	//(a property's export results in the introduction of a variable definition:
	// 	//this variable definition collides with the name of the element that is imported
	// 	//through the ES6 import statement that was inserted)
	// 	if(variableDeclaration.parentPath.value.type === 'ExportNamedDeclaration') {

	// 		//variable declaration is contained in an export named declaration
	// 		//transform export named declaration
	// 		let surrExps = jscodeshiftAPI(variableDeclaration).closest(jscodeshiftAPI.ExportNamedDeclaration);
	// 		if(surrExps.length === 0) {

	// 			return;
	// 		}

	// 		surrExps.replaceWith(path => {

	// 			//result of require call is assigned to a property of exports
	// 			//create an export named declaration
	// 			let variableIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
	// 			let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
							
	// 			//create an named export (the exported specifier is not a variable/function definition,
	// 			//it is the element referenced by importedProperty)
	// 			let exportNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

	// 			// console.log(jscodeshiftAPI(exportNode).toSource());

	// 			return exportNode;
	// 		});

	// 		return;

	// 		// astRootCollection.find(jscodeshiftAPI.ExportNamedDeclaration, variableDeclaration.parentPath.value)
	// 		// 				 .replaceWith(path => {

	// 		// 		//result of require call is assigned to a property of exports
	// 		// 		//create an export named declaration
	// 		// 		let variableIdentifier = jscodeshiftAPI.identifier(importedElementAlias);
	// 		// 		let exportSpecifier = jscodeshiftAPI.exportSpecifier(variableIdentifier, variableIdentifier);
							
	// 		// 		//create an named export (the exported specifier is not a variable/function definition,
	// 		// 		//it is the element referenced by importedProperty)
	// 		// 		let exportNode = jscodeshiftAPI.exportNamedDeclaration(null, [exportSpecifier], null);

	// 		// 		// console.log(jscodeshiftAPI(exportNode).toSource());

	// 		// 		return exportNode;
	// 		// });
	// 		// return;
	// 	}
	// 	else if(variableDeclaration.parentPath.parentPath.value.type !== 'Program') {

	// 		//erase variable definitions located in the module's top-level scope only
	// 		//(do not erase variables local to functions)
	// 		return;
	// 	}
	// 	else {

	// 		initializationValueNode = variableDeclaration.value.declarations[0].init;
	// 		if(initializationValueNode !== null && initializationValueNode.type === 'AssignmentExpression') {

	// 			variableDeclarationCollection.replaceWith(path => {

	// 				// var assigmentOperator = '=';
	// 				// var left
	// 				var initializationAssignment = jscodeshiftAPI.assignmentExpression("=", initializationValueNode.left, 
	// 				jscodeshiftAPI.identifier(initializationValueNode.right.name));

	// 				return jscodeshiftAPI.expressionStatement(initializationAssignment);
	// 			});

	// 			return;
	// 		}
	// 	}

	// 	//variable declaration is not contained in an ES6 export declaration
	// 	//remove variable declaration
	// 	//update: 1 variable declaration might define multiple variables
	// 	//remove only the specific variable declarator
	// 	//and remove the variable declaration only in the case it has no variable declarators
	// 	variableDeclarationCollection.forEach(variableDeclaration => {

	// 		//remove the specific declarator from variable declaration
	// 		let declarators = variableDeclaration.value.declarations;
	// 		let declarator = declarators.find(declarator => {

	// 			return declarator.id.type !== 'Identifier' || 
	// 					declarator.id.name !== importedElementAlias;
	// 		});

	// 		// console.log(declarators.length);
	// 		if(declarator == undefined) {

	// 			jscodeshiftAPI(variableDeclaration).remove();
	// 			return;
	// 		}

	// 		return variableDeclaration.value;
	// 	});

	// 	// variableDeclarationCollection.forEach(variableDeclaration => {

	// 	// 	//remove the specific declarator from variable declaration
	// 	// 	let declarators = variableDeclaration.value.declarations;
	// 	// 	declarators = declarators.filter(declarator => {

	// 	// 		return declarator.id.type !== 'Identifier' || 
	// 	// 				declarator.id.name !== importedElementAlias;
	// 	// 	});

	// 	// 	// console.log(declarators.length);
	// 	// 	if(declarators.length === 0) {

	// 	// 		jscodeshiftAPI(variableDeclaration).remove();
	// 	// 		return;
	// 	// 	}

	// 	// 	return variableDeclaration.value;
	// 	// });


	// 	// variableDeclarationCollection.remove();
	// }
}

/**
 * Creates and inserts a binding variable definition in the AST specified by astRootCollection.
 * Replaces uses of an element with the variable binding.
 * Used in the cases that an imported element (variable/namespace) is modified.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} importedElementAlias 
 * @param {*} usedGlobalIdentifiers 
 */
function insertBindingVariableDefinition(jscodeshiftAPI, astRootCollection, importedElementAlias, elementRefIdentifiers, isImportedElementIntroduced) {

	//(1) create binding to the imported element & 
	//replace each use of the importing global with the name of the binding
	let elementAlias = importedElementAlias + "Binding";
	let bindingIdentifier = jscodeshiftAPI.identifier(elementAlias.replace(/[^a-zA-Z0-9_ ]/g, ''));
		
	//(2) apply rename transformations based on the node representing
	//the identifier that need to be renamed
	if(elementRefIdentifiers.length > 0) {

		elementRefIdentifiers.forEach(elementRefIdentifier => {

			jscodeshiftAPI(elementRefIdentifier).replaceWith(bindingIdentifier);
		});
	}

	// usedGlobalIdentifiers.forEach(function(usedGlobalIdentifier) {
			
	// 	//search usedGlobalIdentifier by AST node and replace it with the bindingIdentifier
	// 	return astRootCollection.find(jscodeshiftAPI.Identifier, usedGlobalIdentifier)
	// 							.replaceWith(bindingIdentifier);
			
	// });
		
	//(iv) insert node representing the binding declaration
	//after the node representing importDeclaration
	let initValue;
	if(isImportedElementIntroduced === true) {

		initValue = jscodeshiftAPI.identifier(importedElementAlias);
	}
	else {

		initValue = jscodeshiftAPI.objectExpression([]);
	}

	let bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, initValue);
	let bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);
	astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(bindingDeclaration);
}

/**
 * Helper function. Determines whether memberExpression contains a reference to 'prototype'
 * @param {*} memberExpression 
 */
function isMemberExpressionReferencingPrototype(jscodeshiftAPI, memberExpression) {

	var prototypeMemberExpressions = jscodeshiftAPI(memberExpression).find(jscodeshiftAPI.Identifier, {name: 'prototype'}); 

	return (prototypeMemberExpressions.length > 0);
}

/**
 * Replaces the explicit uses of the definition specified in importedElement (e.g. function invokations)
 * with a reference of the specific definition within the imported object (member expression).
 * Needed due to conversion of default exports to named exports.
 * @param {*} astRootCollection 
 * @param {*} importedElement 
 */
function replaceImportedObjectUsesWithImportedNamespaceReferences(jscodeshiftAPI, astRootCollection, importedElement, importedElementLocalIdentifier) {

	let elementUses = importedElement.usageSet;
	let explicitNamespaceUseNodes = [];
	let builtinFunctionObjectProperties = ['arguments', 'caller', 'displayName', 'length', 'name', 'prototype',
										   'apply', 'bind', 'call', 'toSource', 'toString'];

	//find the element's usages outside member expressions
	let explicitNamespaceUses = elementUses.forEach(elementUse => {

		let namespaceUseCollection = astRootCollection.find(jscodeshiftAPI[elementUse.type]).filter(path => {

			if(path.value.loc === null) {

				return false;
			}

			let pathValueLoc = path.value.loc;
			let elementUseLoc = elementUse.loc;

			return pathValueLoc.start.line === elementUseLoc.start.line && pathValueLoc.start.column === elementUseLoc.start.column &&
				   pathValueLoc.end.line === elementUseLoc.end.line && pathValueLoc.end.column === elementUseLoc.end.column;
		});

		if(namespaceUseCollection.length === 0) {

			return;
		}

		let namespaceUse = namespaceUseCollection.at(0).get();

		if(namespaceUse.parentPath.value.type === 'MemberExpression') {

			let referencedProperty = namespaceUse.parentPath.value.property;

			if(referencedProperty.type === 'Identifier' && builtinFunctionObjectProperties.includes(referencedProperty.name) === false) {

				//namespace use inside member expression (access of user-defined function object properties)
				return;
			}

		}

		//member expressions that access built-in function object properties are also considered
		explicitNamespaceUseNodes.push(namespaceUseCollection.at(0).get());
	});

	let elementMemberExpressionNode = jscodeshiftAPI.memberExpression(importedElementLocalIdentifier, importedElementLocalIdentifier, false);

	//replace each explicit namespace reference with a member expression
	//(a reference of importedElement inside the imported object)
	explicitNamespaceUseNodes.forEach(explicitNamespaceUseNode => {

		astRootCollection.find(jscodeshiftAPI[explicitNamespaceUseNode.value.type], explicitNamespaceUseNode.value)
						 .replaceWith(elementMemberExpressionNode);
	});
}

/**
 * Locates the references of importedElement in the AST.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} importedElement the element imported in the module
 * @returns An array of objects, each for each element node (require() invocation).
 * Each object contains the element's node, along with its usages.
 */
function locateImportedElementReferencesInAST(jscodeshiftAPI, astRootCollection, importedElement) {

	//case: import inside an object's property
	//(if we kept the property's name, no refs could be detected
	//thus, all references belong to the surrounding object)
	let impElDefinedWithinObject = isElementDefinitionNestedInObject(jscodeshiftAPI, astRootCollection, importedElement);

	//importedElement defined within an object (no refs of importedElement,
	//since the surrounding object is actually used)
	if(impElDefinedWithinObject === true) {

		return [];
	}

	//locate imported element references in the AST
	let elementRefIdentifiers = importedElement.usageSet.map(elemRef => {

		let references = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elemRef);

		if(references.length === 0) {

			return null;
		}

		//1-1 mapping between node and its location
		return references.at(0).get();
	});

	elementRefIdentifiers = elementRefIdentifiers.filter(elemRef => {

		return elemRef !== null;
	});

	let elemAliasObjs = retrieveImportedElementAliases(jscodeshiftAPI, astRootCollection, importedElement);

	// console.log(elemAliasObjs.length);

	//generate an object for each import statement
	//the object contains the import statement along with its uses (based on its alias)
	let elemRefObjs = elemAliasObjs.map(elemAliasObj => {

		/*{

			impElNode: <AST node>,
			elemAlias: <string>
		}*/
		
		// console.log('elem alias obj')
		// console.log(elemAliasObj)
		let impElNode = elemAliasObj.impElNode;
		let elemAlias = elemAliasObj.elemAlias;

		//filter out element references for the specific import statement
		elemRefs = elementRefIdentifiers.filter(elemRef => {

			return elemRef.value.name === elemAlias;
		});

		// console.log(impElNode)
		return {

			impElNode: impElNode,
			elementRefIdentifiers: elemRefs
		};
	});

	// console.log(elemRefObjs.length);
	// elemRefObjs.map(elemRefObj => console.log(elemRefObj))
	return elemRefObjs;

	// //locate imported element references in the AST
	// let elementRefIdentifiers = importedElement.usageSet.map(elemRef => {

	// 	let elemRefLoc = elemRef.loc;
	// 	let references = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, elemRef);

	// 	if(references.length === 0) {

	// 		return null;
	// 	}

	// 	//1-1 mapping between node and its location
	// 	return references.at(0).get();
	// });

	// elementRefIdentifiers = elementRefIdentifiers.filter(elemRef => {

	// 	return elemRef !== null;
	// });

	// return elementRefIdentifiers;
}

/**
 * Retrieves the variables where import statements (require() calls) are assigned.
 * Useful in cases where importedElement is imported under multiple aliases,
 * so element references should be filtered based on the element's aliases.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection the module's AST
 * @param {*} importedElement the element imported in the module
 * @returns an array of objects (1-1 mapping between require() invocation and object).
 * Each object contains the import statement, along with its alias.
 */
function retrieveImportedElementAliases(jscodeshiftAPI, astRootCollection, importedElement) {

	//locate each imported element node (require() invocation in the AST)
	//(importedElement can be imported under multiple aliases,
	//so refs should be filtered by the element's alias as well)
	let impElNodeCollections = importedElement.importedElementNodes.map(impElNode => {

		return searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, impElNode);
	});

	let impElNodes = impElNodeCollections.map(impElNodeCollection => {

		return impElNodeCollection.length === 0 ?
				null :
				impElNodeCollection.at(0).get();
	});

	impElNodes = impElNodes.filter(impElNode => {

		return impElNode !== null;
	});

	//map imported element nodes to their aliases
	//(the variables where these invocations are assigned)
	let elemAliasObjs = impElNodes.map(impElNode => {

		// console.log(impElNode.value);

		//clone impElNode (needed for fitering out element refs,
		//in cases when importedElement is imported under multiple aliases)
		//prevent using an import statement that is removed/replaced with a reference to importedElement
		let impElNodeClone = cloneDeep(impElNode);
		let surrStmts = jscodeshiftAPI(impElNode).closest(jscodeshiftAPI.Statement);

		if(surrStmts.length === 0) {

			return null;
		}

		let surrStmt = surrStmts.at(0).get().value;

		if(surrStmt.type === 'ExpressionStatement' &&
			surrStmt.expression.type === 'AssignmentExpression' &&
			surrStmt.expression.left.type === 'Identifier') {

			// return surrStmt.expression.left.name;

			return {

				impElNode: impElNodeClone,
				elemAlias: surrStmt.expression.left.name
			};
		}

		if(surrStmt.type === 'VariableDeclaration') {

			let varDeclInitWithImpElNode = surrStmt.declarations.find(varDecl => {

				if(varDecl.init === impElNode.value) {

					return true;
				}

				let varDeclInitValues = jscodeshiftAPI(varDecl.init).find(jscodeshiftAPI[impElNode.value.type]).filter(node => {

					return node.value === impElNode.value;
				});

				if(varDeclInitValues.length > 0) {

					return true;
				}

				return false;
			});

			if(varDeclInitWithImpElNode === undefined) {

				return null;
			}

			let elemAlias = varDeclInitWithImpElNode.id.type === 'Identifier' ?
							varDeclInitWithImpElNode.id.name :
							null;

			// console.log(impElNode)
			return elemAlias === null ?
					null :
					{

						impElNode: impElNodeClone,
						elemAlias: elemAlias
					};
		}

		return null;
	});

	elemAliasObjs = elemAliasObjs.filter(elemAliasObj => {

		return elemAliasObj !== null;
	});

	// elemAliasObjs.map(elemAliasObj => console.log(elemAliasObj));

	return elemAliasObjs;
}

/**
 * Is importedElement defined within an object?
 * Needed in order to resolve whether there are 
 * references of importedElement that need to be renamed to the element's import alias.
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} importedElement 
 */
function isElementDefinitionNestedInObject(jscodeshiftAPI, astRootCollection, importedElement) {

	let impElNodesNestedInObject = importedElement.importedElementNodes.find(importedElNode => {

		let callExpressions = searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, importedElNode);
		if(callExpressions.length === 0) {

			return false;
		}

		let callExpsInsideObjProps = callExpressions.filter(callExp => {

			// let isNestedInObject = false;
			// let parentNode = callExp.parentPath;
			// while(parentNode !== null && parentNode.value.type !== null) {

			// 	if(parentNode.value.type === 'Property') {

			// 		isNestedInObject = true;
			// 		break;
			// 	}
			// 	parentNode = parentNode.parentPath;
			// }

			// //true if importedElNode nested in object, false otherwise
			// return isNestedInObject;

			let surrPropertyStmts = jscodeshiftAPI(callExp).closest(jscodeshiftAPI.Property);

			return surrPropertyStmts.length > 0;
		});

		// if(callExpsInsideObjProps.length > 0) {

		// 	return true;
		// }

		// return false;

		return callExpsInsideObjProps.length > 0;
	});

	return impElNodesNestedInObject != undefined;

	// let impElNodesNestedInObjects = importedElement.importedElementNodes.filter(importedElNode => {

	// 	let callExpressions = astRootCollection.find(jscodeshiftAPI.CallExpression, {callee: importedElNode.callee});
	// 	if(callExpressions.length === 0) {

	// 		return false;
	// 	}

	// 	let callExpsInsideObjProps = callExpressions.filter(callExp => {

	// 		let isNestedInObject = false;
	// 		let parentNode = callExp.parentPath;
	// 		while(parentNode !== null && parentNode.value.type !== null) {

	// 			if(parentNode.value.type === 'Property') {

	// 				isNestedInObject = true;
	// 				break;
	// 			}
	// 			parentNode = parentNode.parentPath;
	// 		}

	// 		//true if importedElNode nested in object, false otherwise
	// 		return isNestedInObject;
	// 	});

	// 	if(callExpsInsideObjProps.length > 0) {

	// 		return true;
	// 	}

	// 	return false;
	// });

	// return impElNodesNestedInObjects.length > 0;
}

/**
 * Replaces the references of importedElement's exported properties to references of the variables
 * introduced after the refactoring.
 * In the case that importedElement is imported through the require() function provided by CommonJS,
 * the property is included in the ES6 import statement that will be introduced (an import specifier is created)
 * @param {*} jscodeshiftAPI 
 * @param {*} astRootCollection 
 * @param {*} importedElement 
 * @param {*} elementRefIdentifiers 
 * @param {*} isElementImported 
 */
function renameFunctionPropertyReferencesToVariableReferences(jscodeshiftAPI, astRootCollection, filePath, importedElement, elementRefIdentifiers, isElementImported, localIdentifierName) {

	/**
	 * After refactoring, objects (regardless of their cohesion) are destructured (either partially 
	 * in case of cohesive objects, or fully in case of non-cohesive objects) to their properties.
	 * Each property bound to importedElement is mapped to a variable. The variable is finally exported,
	 * instead of the property.
	 * Thus, each reference to an importedElement's property needs to be replaced with a reference of 
	 * the corresponding variable.
	*/

	let importSpecifiers = [];

	// console.log(importedElement);

	let functionProperties = importedElement.dataType === 'function' ? 
								importedElement.functionProperties : 
								importedElement.objectProperties;
	// console.log(functionProperties);
	// console.log(isElementImported);

	//check if importedElement is used outside member expression
	//these references should be renamed to references to its import alias
	//import alias is introduced in order to prevent module definition conflicts
	let elementReferences = elementRefIdentifiers.filter(elementRefIdentifier => {

		return elementRefIdentifier != null && elementRefIdentifier.parentPath.value.type !== 'MemberExpression';
	});

	//check if importedElement's properties are referenced 
	//(references of importedElement in member expressions)
	//references not included in elementReferences
	let propertyReferences = elementRefIdentifiers.filter(elementRefIdentifier => {

		return elementReferences.indexOf(elementRefIdentifier) === -1;
	})

	// console.log(functionProperties.length === 0 || elementReferences.length > 0);

	if(isElementImported === false && 
		importedElement.isImportedElementExportedViaModuleExports === true) {

		//importedElement not imported through require() and exported through assignment to the export object
		//also it models a constructor function without properties bound to it
		//replace references to importedElement with references with the exported definition of the respective module
		//(transmission from ES6 default to named export)
		let aliasIdentifier = jscodeshiftAPI.identifier(importedElement.aliasName);
		let propertyIdentifier = jscodeshiftAPI.identifier(importedElement.elementName);
		let memberExpression = jscodeshiftAPI.memberExpression(aliasIdentifier, propertyIdentifier, false);
	
		elementRefIdentifiers.forEach(elRef => {
	
			// console.log(elRef);
			jscodeshiftAPI(elRef).replaceWith(memberExpression);
		});

		return [];
	}
	
	if(isElementImported === true) {

		//importedElement imported through require()
		let aliasName = (localIdentifierName !== undefined ? 
						localIdentifierName : 
							(importedElement.aliasName !== undefined ? 
							importedElement.aliasName : 
							importedElement.elementName));
							
		let aliasIdentifier = jscodeshiftAPI.identifier(aliasName);
		
		//importedElement has not any bound properties
		if(functionProperties.length === 0) {

			//importedElement assigned to export object + namespace import (require() returns importedElement itself)
			//ES6 named imports reference the exported definitions
			//rename references to importedElement with the alias of the imported definition
			//(transmission from default to named export)
			elementRefIdentifiers.forEach(elRef => {
			
				// console.log(elRef);
				if(elRef.parentPath.value.type === 'MemberExpression' && 
				   elRef.parentPath.value.property.name === importedElement.elementName) {

					//namespace import brings a function without properties:
					//in the case that the actual imported definition is referenced inside
					//a member expression (it is referenced through a reference to importedElement), 
					//replace importedElement's parent node with the imported definition's alias
					//case: TimeOfImpact.js, namespace: timer
					jscodeshiftAPI(elRef.parentPath).replaceWith(aliasIdentifier);
				}
				else if(elRef.parentPath.value.type !== 'MemberExpression') {

					//namespace import brings a function without properties:
					//in the case that importedElement is referenced outside
					//a member expression or it's not referenced inside a member expression 
					//replace importedElement's reference with its alias
					//case: Distance.js, namespace: stats
					jscodeshiftAPI(elRef).replaceWith(aliasIdentifier);
				}
			});

			// //do not import properties along with importedElement
			// return [];
		}

		//importedElement has bound properties, but it's referenced only outside member expressions
		//ES6 named import references importedElement
		if(elementReferences.length === elementRefIdentifiers.length) {

			// console.log(aliasIdentifier);

			//importedElement assigned to export object + namespace import (require() returns importedElement itself)
			//ES6 named imports reference the exported definitions
			//rename references to importedElement with the alias of the imported definition
			//(transmission from default to named export)
			elementRefIdentifiers.forEach(elRef => {
			
				//namespace import brings a function without properties:
				//since importedElement is not referenced inside
				//a member expression replace importedElement's reference
				//with its alias
				jscodeshiftAPI(elRef).replaceWith(aliasIdentifier);
			});

			// if(importedElement.isImportedElementExportedViaModuleExports === true) {

			// 	//rename references to importedElement with the alias of the imported definition
			// 	//(transmission from default to named export)
			// 	elementRefIdentifiers.forEach(elRef => {
			
			// 		// console.log(elRef);
			// 		jscodeshiftAPI(elRef).replaceWith(aliasIdentifier);
			// 	});

			// }

			// //do not import properties along with importedElement
			// return [];
		}
		
		//importedElement: 
		//(a) has some bound properties and it is referenced inside member expressions (not all its references are outside member expressions)
		//(b) it is (maybe) referenced outside member expressions
		//(c) it has no bound properties, no references but it is assigned to an object's property
		
		//(a) change importedElement's references' parent nodes (surrounding statements) to the alias of the used property,
		//since an ES6 named import with respect to a property is introduced
		//(performed during generation of the variable definitions to be imported for importedElement's properties, see below)
		//UPDATE: if usage located within member expression that is assigned a value,
		//then it is likely a property definition (only replace the element's reference with its alias reference)

		//(b) change importedElement's references to references of its alias

		//(a)
		//retrieve the property references that are not actually accessing
		//properties of importedElement
		//these references are likely to define new properties of importedElement
		//simply replace importedElement references with references of its alias
		let importedElementPropertyDefinitions = propertyReferences.filter(elementRef => {

			if(elementRef.parentPath.value.type !== 'MemberExpression') {

				//elementRef might be changed to an identifier already
				return false;
			}
			let accessedPropertyName = elementRef.parentPath.value.property.name;
			let accessedProperties = functionProperties.filter(functionProp => {
	
				return functionProp.propertyName === accessedPropertyName;
			});
	
			return accessedProperties.length === 0;
		});
	
		// console.log(filePath + ' ' + importedElementPropertyDefinitions.length);
	
		//update importedElement property definitions to reference the alias of importedElement
		importedElementPropertyDefinitions.forEach(importedElementPropDef => {
	
			jscodeshiftAPI(importedElementPropDef).replaceWith(aliasIdentifier);
		});

		//(b)
		if(elementReferences.length > 0) {

			elementReferences.forEach(elementReference => {

				jscodeshiftAPI(elementReference).replaceWith(aliasIdentifier);
			});
			
		}

		//(c)

	}

	//import importedElement's defined properties, while rename their references (member expressions)
	//to references of their definitions (a variable for each property is introduced and exported after refactoring)
	//consider importing only properties that are exported from module
	functionProperties = functionProperties.filter(functionProperty => {

		return functionProperty.isExported === true;
	});

	functionProperties.forEach(functionProperty => {

		// console.log(functionProperty.propertyName);

		//generating a variable with name that is **different** to the initial property's name
		//hardens static analysis, especially in the cases that the imported object is
		//assigned to an alias and the alias is used instead (**name aliasing**)
		//(information relevant to the alias and its references is needed in order to ensure the soundness of the refactoring)
		//update: import variable under an alias, in order to prevent conflicts of functionProperty
		//with existing variable definitions
		let importedModuleName = require.resolve(path.dirname(filePath) + path.sep + importedElement.definitionModuleName);
		let definitionModuleName = path.basename(importedModuleName).replace(/[^a-zA-Z0-9_ ]/g, '');
		definitionModuleName = (definitionModuleName.endsWith('.') === true ? require.resolve(definitionModuleName) : definitionModuleName);
		let propertyAliasName = definitionModuleName + '_' + functionProperty.propertyName;

		let propertyName =  functionProperty.propertyName;
		let propertyIdentifier = jscodeshiftAPI.identifier(propertyName);
		let propertyAliasIdentifier = jscodeshiftAPI.identifier(propertyAliasName);

		// console.log(elementRefIdentifiers.length);

		//for each exported property of importedElement,
		//check if it's referenced within module
		//if yes, import it
		let elementPropertyReferences = propertyReferences.filter(elementRefIdentifier => {

			// console.log(elementRefIdentifier.parentPath.value);
			if(elementRefIdentifier.parentPath.value.type === 'MemberExpression' &&
			   elementRefIdentifier.parentPath.value.property.type === 'Identifier' &&
			   elementRefIdentifier.parentPath.value.property.name === functionProperty.propertyName) {

				//importedElement referenced inside a member expression
				//whose property identical to functionProperty
				return true;
			}

			return false;
		});

		//also, check if property is modified in a reference (at least 1)
		//(a binding for this property must be introduced after the last import)
		let modificationProp = elementPropertyReferences.find(propRef => {

			if(propRef.parentPath.value.type === 'UpdateExpression') {

				return true;
			}

			let surrAssignments = jscodeshiftAPI(propRef).closest(jscodeshiftAPI.AssignmentExpression);
			if(surrAssignments.length === 0) {

				return false;
			}

			// console.log(surrAssignments.length);

			let surrAssignment = surrAssignments.at(0).get();
			if(surrAssignment.value.left === propRef.parentPath.value) {

				return true;
			}

			return false;
		});

		// let modificationProps = elementPropertyReferences.filter(propRef => {

		// 	if(propRef.parentPath.value.type === 'UpdateExpression') {

		// 		return true;
		// 	}

		// 	let surrAssignments = jscodeshiftAPI(propRef).closest(jscodeshiftAPI.AssignmentExpression);
		// 	if(surrAssignments.length === 0) {

		// 		return false;
		// 	}

		// 	// console.log(surrAssignments.length);

		// 	let surrAssignment = surrAssignments.at(0).get();
		// 	if(surrAssignment.value.left === propRef.parentPath.value) {

		// 		return true;
		// 	}

		// 	return false;
		// });

		// console.log(elementPropertyReferences.length + ' ' + modificationProps.length);

		if(elementPropertyReferences.length > 0) {

			//property is referenced at least once in module
			//rename the property reference to variable references
			if(isElementImported === false) {

				//element not imported through CommonJS require (an ES6 import is not introduced)
				//the import after refactoring retrieves the namespace
				//create a member expression of the form: <aliasIdentifier>.<elementIdentifier>,
				//where <aliasIdentifier> is the name under which importedElement is imported and used
				//and <elementIdentifier> is its actual name (the name under which it is exported from its definition module)
				let aliasIdentifier = jscodeshiftAPI.identifier(importedElement.aliasName);
				let memberExpression = jscodeshiftAPI.memberExpression(aliasIdentifier, propertyIdentifier, false);
	
				elementPropertyReferences.forEach(elRef => {
	
					// console.log(elRef);
					jscodeshiftAPI(elRef.parentPath).replaceWith(memberExpression);
				});
	
				return;
			}
			
			//importedElement's property is referenced at least once - rename its references
			//also, importedElement imported through require() (an ES6 named import is introduced)
			//the ES6 import references the property's corresponding variable instead of the namespace
			//replace property reference (member expression) with variable reference
			if(modificationProp == undefined) {

				elementPropertyReferences.forEach(elRef => {

					// console.log(elRef.parentPath);
					// jscodeshiftAPI(elRef).replaceWith(propertyIdentifier);
					// jscodeshiftAPI(elRef.parentPath).replaceWith(propertyIdentifier);
					jscodeshiftAPI(elRef.parentPath).replaceWith(propertyAliasIdentifier);
				});
			}
			else {

				//property modified in >1 reference
				//introduce a variable binding right after the last import
				//and rename all its references to the binding, instead of the variable
				let bindingVariable = propertyAliasName + '_binding';
				let bindingIdentifier = jscodeshiftAPI.identifier(bindingVariable);
				let bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, propertyAliasIdentifier);
				let bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);

				let es6Imports = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);

				if(es6Imports.length > 0) {

					//ES6 import statements exist - add binding variable definition after the last ES6 import
					jscodeshiftAPI(es6Imports.at(-1).get()).insertAfter(bindingDeclaration);
				}
				else {
		
					//ES6 import statements do not exist - add the top of the AST
					astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(bindingDeclaration);
				}

				elementPropertyReferences.forEach(elRef => {

					// console.log(elRef.parentPath);
					// jscodeshiftAPI(elRef).replaceWith(propertyIdentifier);
					// jscodeshiftAPI(elRef.parentPath).replaceWith(propertyIdentifier);
					jscodeshiftAPI(elRef.parentPath).replaceWith(bindingIdentifier);
				});
			}

			// if(modificationProps.length === 0) {

			// 	elementPropertyReferences.forEach(elRef => {

			// 		// console.log(elRef.parentPath);
			// 		// jscodeshiftAPI(elRef).replaceWith(propertyIdentifier);
			// 		// jscodeshiftAPI(elRef.parentPath).replaceWith(propertyIdentifier);
			// 		jscodeshiftAPI(elRef.parentPath).replaceWith(propertyAliasIdentifier);
			// 	});
			// }
			// else {

			// 	//property modified in >1 reference
			// 	//introduce a variable binding right after the last import
			// 	//and rename all its references to the binding, instead of the variable
			// 	let bindingVariable = propertyAliasName + '_binding';
			// 	let bindingIdentifier = jscodeshiftAPI.identifier(bindingVariable);
			// 	let bindingDeclarator = jscodeshiftAPI.variableDeclarator(bindingIdentifier, propertyAliasIdentifier);
			// 	let bindingDeclaration = jscodeshiftAPI.variableDeclaration("var", [bindingDeclarator]);

			// 	let es6Imports = astRootCollection.find(jscodeshiftAPI.ImportDeclaration);

			// 	if(es6Imports.length > 0) {

			// 		//ES6 import statements exist - add binding variable definition after the last ES6 import
			// 		jscodeshiftAPI(es6Imports.at(-1).get()).insertAfter(bindingDeclaration);
			// 	}
			// 	else {
		
			// 		//ES6 import statements do not exist - add the top of the AST
			// 		astRootCollection.find(jscodeshiftAPI.Program).get('body',0).insertBefore(bindingDeclaration);
			// 	}

			// 	elementPropertyReferences.forEach(elRef => {

			// 		// console.log(elRef.parentPath);
			// 		// jscodeshiftAPI(elRef).replaceWith(propertyIdentifier);
			// 		// jscodeshiftAPI(elRef.parentPath).replaceWith(propertyIdentifier);
			// 		jscodeshiftAPI(elRef.parentPath).replaceWith(bindingIdentifier);
			// 	});
			// }
			

			//import property
			let importSpecifier = jscodeshiftAPI.importSpecifier(propertyIdentifier, propertyAliasIdentifier);
			importSpecifiers.push(importSpecifier);
		}

	});

	return importSpecifiers;
}

/**
 * Maps an object specifying a statement to the actual statement.
 * @param stmtObj the object specifying the statement
 */
function searchASTNodeByLocation(jscodeshiftAPI, astRootCollection, stmtObj) {

	//stmtObj an object with the statement's type and location
	//(compliance with jscodeshift: also actual AST nodes can be searched
	//using the same function)
	if(stmtObj == null) {

		return [];
	}

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