/**
 * http://usejsdoc.org/
 */

var jscodeshift = require('../../../../node_modules/jscodeshift');

//used for def-use algorithm
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

var enums = require('../util/enums.js');
var ObjectProperty = require('./objectProperty.js');

function Variable() {
	
	this.variableName = null;
	
	//initialization value node: node representing the
	//value assigned to a variable during its initialization
	this.initializationValueNode = null;

	//variableDeclarationASTNode: AST node representing the variable's definition
	//syntax: var/let/const <variableName> [ = <initializationValueNode>];
	this.variableDeclarationNode = null;

	this.isInitializedWithObjectExpression = null;
	
	this.isExported = false;
	this.updateIsExported = function(isExported) {
		
		this.isExported = isExported;
	};

	this.exportedThroughModuleExports = false;
	this.updateExportStatementType = function(isVariableExportedThroughModuleExports) {

		this.exportedThroughModuleExports = isVariableExportedThroughModuleExports;
	};
	
	//AST node representing the variable's export statement (if the variable is exported)
	this.exportedVariableNode = null;
	this.updateExportedVariableNode = function(exportedVariableNode) {
		
		this.exportedVariableNode = exportedVariableNode;
	};

	//the properties defined through binding to the variable
	//(in the case that the variable is initialized with an object literal)
	//ObjectProperty
	this.objectProperties = [];
	this.updateObjectProperties = function(objectProperties) {

		this.objectProperties = objectProperties;
	};

	//ObjectProperty
	this.prototypeProperties = [];
	this.updatePrototypeProperties = function(prototypeProperties) {

		this.prototypeProperties = prototypeProperties;
	};

	this.isInitializedWithFunctionConstructor = false;
	this.updateIsInitializedWithFunctionConstructor = function(isInitializedWithFunctionConstructor) {

		this.isInitializedWithFunctionConstructor = isInitializedWithFunctionConstructor;
	};

	//what if variable not a cohesive object, but referenced outside member expressions (maybe iterated)?
	//also applies to variables with computed properties
	this.isObjectReferenced = false;
	this.updateIsObjectReferenced = function(isObjectReferenced) {

		//in the case the function object is iterated at least once, keep information
		//else, update field (all references are used in order to determine the fact)
		// console.log(isObjectReferenced)
		this.isObjectReferenced = isObjectReferenced;
	};

	//is variable used besides its statically-known properties?
    this.usedBesidesProperties = false;
    this.updateUsedBesidesProperties = function(usedBesidesProperties) {

        //in the case the function object is used besides its statically-known
        //properties at least once, keep information
		//else, update field (all references are used in order to determine the fact)
        this.usedBesidesProperties = (this.usedBesidesProperties === false ? 
                                        usedBesidesProperties : 
                                        this.usedBesidesProperties);
	};

	this.hasBoundPropertiesInitializedWithImportDefs = false;
	this.updateHasBoundPropertiesInitializedWithImportDefs = function(hasBoundPropertiesInitializedWithImportDefs) {

		this.hasBoundPropertiesInitializedWithImportDefs = hasBoundPropertiesInitializedWithImportDefs;
	};

	//is the object's hierarchy enriched with properties
	//outside the object's definition module?
	//(resolved during MDG construction)
	this.isObjectHierarchyModifiedInMultipleModules = false;

	//>= 1 usage inside a property definition is needed in order to be true
	this.updateIsObjectHierarchyModifiedInMultipleModules = function(isObjectHierarchyModifiedInMultipleModules) {

		this.isObjectHierarchyModifiedInMultipleModules = 
			(this.isObjectHierarchyModifiedInMultipleModules === true ? 
			 true : isObjectHierarchyModifiedInMultipleModules);
	};

	//external modules enriching the prototype 
	//of object with new properties (absolute paths)
	this.modulesEnrichingHierarchy = [];
	this.pushModuleToModulesEnrichingHierarchy = function(inputFile) {

		//add inputFile in array once (prevent duplicates)
		if(this.modulesEnrichingHierarchy.some(currModule => {

			return currModule === inputFile;

		}) === false) {

			this.modulesEnrichingHierarchy.push(inputFile);
		}
	};

	this.isIncludedInAModifiedImportedNamespace = false;
	this.updateIsIncludedInAModifiedImportedNamespace = function(isIncludedInAModifiedImportedNamespace) {

		// this.isIncludedInAModifiedImportedNamespace = isIncludedInAModifiedImportedNamespace;

		//if set to true, don't modify it
        //iteration over the modules and their deps is non-deterministic
		this.isIncludedInAModifiedImportedNamespace = this.isIncludedInAModifiedImportedNamespace === false ?
														isIncludedInAModifiedImportedNamespace :
														this.isIncludedInAModifiedImportedNamespace;
	};

	this.isImportedAndReexported = false;
	this.updateIsImportedAndReexported = function(isImportedAndReexported) {

		// this.isImportedAndReexported = isImportedAndReexported;

		//if set to true, don't modify it
        //iteration over the modules and their deps is non-deterministic
		this.isImportedAndReexported = this.isImportedAndReexported === false ?
										isImportedAndReexported :
										this.isImportedAndReexported;
	};

	this.retrieveObjectPropertyByName = function(propertyName) {

		return this.objectProperties.find(objectProperty => {

			return objectProperty.propertyName === propertyName;
		});
	};

	this.retrievePrototypePropertyByName = function(propertyName) {

		// let retrievedProperties = this.prototypeProperties.filter(function(prototypeProperty) {

		// 	return prototypeProperty.propertyName === propertyName;
		// });

		// if(retrievedProperties.length === 0) {

		// 	return null;
		// }

		// return retrievedProperties[0];

		//refactored to use find() instead of filtering out all properties
		let protProp = this.prototypeProperties.find(prototypeProperty => {

			return prototypeProperty.propertyName === propertyName;
		});

		return protProp === undefined ? null : protProp;
	};

	//retrieves property (of any type) bound to variable by its name
	this.retrievePropertyByName = function(propertyName) {

		//do we search for an object property?
		//(property bound to variable)
		let retrievedProperty = this.retrieveObjectPropertyByName(propertyName);

		if(retrievedProperty != null) {

			return retrievedProperty;
		}

		//finally, return either a prototype property with the specific name
		//or null if there's no such property
		return this.retrievePrototypePropertyByName(propertyName);
	};

	this.updateVariable = function(sourceFile, variableDeclaration, declaration) {

		this.variableName = declaration.id.name;
		this.initializationValueNode = declaration.init;
		this.variableDeclarationNode = variableDeclaration;

		// console.log(this.initializationValueNode);

		let isInitializedWithFunctionConstructor = false;
		let variableInitialValueNode = null;

		//determine if variable is a cohesive object
		//through examining its initialization value
		if(this.initializationValueNode !== null && this.initializationValueNode.type === 'AssignmentExpression') {

			variableInitialValueNode = this.initializationValueNode.right;
            while(variableInitialValueNode.type === 'AssignmentExpression') {

                variableInitialValueNode = variableInitialValueNode.right;
            }
		}
		else {

			variableInitialValueNode = this.initializationValueNode;
		}

		// console.log(variableInitialValueNode);
        if(variableInitialValueNode != null && variableInitialValueNode.type === 'FunctionExpression') {

			let retrievedFunction = sourceFile.retrieveDefinedFunctionByNode(variableInitialValueNode);
			// console.log(retrievedFunction);
            if(retrievedFunction !== null && retrievedFunction.isConstructor === true) {

				//variable is initialized with a function constructor
				isInitializedWithFunctionConstructor = true;
            }
        }

		let isInitializedWithObjectExpression = (this.initializationValueNode != null && 
												(this.initializationValueNode.type === 'ObjectExpression' || 
												this.initializationValueNode.type === 'AssignmentExpression' && variableInitialValueNode.type === 'ObjectExpression')) ? true : false;
				
		
		this.isInitializedWithObjectExpression = isInitializedWithObjectExpression;
		this.updateIsInitializedWithFunctionConstructor(isInitializedWithFunctionConstructor);

		//retrieve the variable's properties
		this.retrievePropertiesOfVariable(sourceFile);
	};

	/**
	* Retrieves the properties bound to a variable (applies to CommonJS modules).
	* Also, for each property, it retrieves its usages (through finding references to the variable
	* either through the variable itself or to 'this' inside a method property).
	* @param {*} sourceFile 
	*/
	this.retrievePropertiesOfVariable = function(sourceFile) {
   
	   //don't find properties of variables defined in test modules
	   if(sourceFile.moduleType === enums.ModuleType.testFile) {
   
		   return;
	   }

	//    console.log(sourceFile.fileName + ' ' + this.variableName)
   
	   let isObjectReferenced = false;
   
	   ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());
   
	   let astRootCollection = sourceFile.astRootCollection;
	   let variableName = this.variableName;
	   let variableDeclarationNode = this.variableDeclarationNode;

	   //we're interested only in 1 specific declaration (the declaration specifying the specific variable)
	   //notice that 1 variable declaration might define multiple variables
	   let declarations = variableDeclarationNode.value.declarations.filter(declaration => {

			return declaration.id.name === variableName;
	   });
   
	   //for each variable, retrieve its properties through 
	   // (a) detecting explicit properties inside the object that is assigned to the variable or
	   // (b) resolving its uses (in the case that they are bound to the variable) or 
	   // (c) a combination of (a), (b)
	   declarations.forEach(declaration => {
   
		let declarationStart = declaration.id.range[0];
		let declarationEnd = declaration.id.range[1];
   
		if(declarationStart === null || declarationEnd === null) {
   
			//no range resolved
			return;
		}
   
		let objectProperties = [];
		let objectPrototypeProperties = [];
   
		//(a) resolve properties bound to variable once it is defined 
		//(properties defined within its initialization value)
		let initValueNode = declaration.init;
		if(initValueNode !== null && initValueNode.type === 'ObjectExpression') {
   
			let initializationValueProperties = initValueNode.properties;
			initializationValueProperties.forEach(initializationValueProperty => {
   
				//a property's name may be either a literal (a string) or an identifier
				let propertyName = initializationValueProperty.key.type === 'Identifier' ? initializationValueProperty.key.name : initializationValueProperty.key.value;
	
				// console.log(initializationValueProperty.key.type);
				isObjectReferenced = initializationValueProperty.key.type === 'Literal' ? true : false;

				let objectProperty = new ObjectProperty.ObjectProperty(propertyName, initializationValueProperty);
	
				let existentProperty = objectProperties.find(currentObjectProperty => {
	
					return currentObjectProperty.propertyName === objectProperty.propertyName;
				});
	
				if(existentProperty === undefined) {
	
					//there does not exist such property
					//add objectProperty to array
					objectProperties.push(objectProperty);
				}
			});
		}

		// console.log(isObjectReferenced)

		//in the case that the variable has properties with literal names, do not destructure it
		this.updateIsObjectReferenced(isObjectReferenced);
   
		//(b) resolve uses of declaration (in order to resolve properties bound to declaration)
		let requestDetails = {
			query: {
				type: "refs",
				file: sourceFile.fileName,
				start: declarationStart,
				end: declarationEnd,
				variable: variableName
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
			referenceRanges = success.refs.map(reference => {
	   
				return {
	   
					start: reference.start,
					end: reference.end
				};
			});
		});
   
		//exclude declaration references included in the variable's definition statement
		referenceRanges = referenceRanges.filter(referenceRange => {
   
			return referenceRange.start !== declarationStart && referenceRange.end !== declarationEnd;
		});

		// console.log(referenceRanges.length);
   
		//for each reference, retrieve the member expression containing it 
		//(the complete reference to the property: ternjs returns the reference to the property identifier without the object)
		//find identifier represented by reference and then retrieve its parent (prevent confusion in cases when multiple property references are used)
		let objectReferenceIdentifiers = [];

		referenceRanges.forEach(referenceRange => {
   
			//retrieve the identifiers pointed by ternjs query result (find refs of variable in the AST)
			let referenceIdentifiers = astRootCollection.find(jscodeshift.Identifier).filter(identifier => {
   
				// if(identifier.value.name !== this.variableName) {

				// 	return false;
				// }

				if(identifier.value.range[0] === declarationStart &&
					identifier.value.range[1] === declarationEnd) {

					return false;
				}

				// console.log(identifier.value.range);
				// console.log(identifier.value.loc);

				//AMD modules: don't consider references inside return statements
				if(jscodeshift(identifier).closest(jscodeshift.ReturnStatement).length > 0 &&
					sourceFile.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

					return false;
				}

				//assumption: prevent inconsistencies between different parsers (flow in jscodeshift, acorn in tern)
				//by considering also the variable's references
				// return (identifier.value.name === variableName &&
				// 		identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end) ||
				// 			// identifier.parentPath.value.type === 'MemberExpression') ||
				// 		(identifier.value.name === variableName);

				return (identifier.value.range[0] === referenceRange.start && identifier.value.range[1] === referenceRange.end) ||
						identifier.value.name === variableName;
			});
   
			if(referenceIdentifiers.length === 0) {
   
				//no references found
				return;
			}

			// console.log(referenceIdentifiers.length);

			referenceIdentifiers.forEach(refId => {

				objectReferenceIdentifiers.push(refId);

				let propertyReferenceMemberExpression = refId.parentPath;

				if(propertyReferenceMemberExpression.value.type !== 'MemberExpression') {

					//CJS modules: don't consider references inside export statement,
					//in order to determine whether object is iterated (object referenced)
					let surrStmts = jscodeshift(refId).closest(jscodeshift.Statement);
					if(surrStmts.length > 0) {

						let surrStmt = surrStmts.at(0).get();
						if(surrStmt.value.type === 'ExpressionStatement' && 
							surrStmt.value.expression.type === 'AssignmentExpression') {

							let expObjs = jscodeshift(surrStmt).find(jscodeshift.Identifier).filter(id => {

								return id.value.name === 'exports';
							});

							if(expObjs.length > 0) {

								isObjectReferenced = false;
								this.updateIsObjectReferenced(isObjectReferenced);
								return;
							}
						}
					}

					isObjectReferenced = true;
					this.updateIsObjectReferenced(isObjectReferenced);
					return;
				}

				// console.log(refId.value.loc);
				// // console.log(isObjectReferenced);
				// console.log(propertyReferenceMemberExpression.value.type);

				//initialize object property (classify it as an object/prototype/instance property)
				let objectPropertyIdentifier;
				let isPrototypeProperty = false;
				let propertyDefinitionNode;
				if(propertyReferenceMemberExpression.value.property.type === 'Identifier' && 
				propertyReferenceMemberExpression.value.property.name === 'prototype') {
	
					//property is bound to prototype (its name is the property bound to propertyReferenceMemberExpression)
					isPrototypeProperty = true;
					propertyDefinitionNode = propertyReferenceMemberExpression.parentPath;
					this.updateIsInitializedWithFunctionConstructor(true);
					
				}
				else {
	
					propertyDefinitionNode = propertyReferenceMemberExpression;
				}
	
				objectPropertyIdentifier = propertyDefinitionNode.value.property;

				// console.log(propertyDefinitionNode.value.computed);
				if(propertyDefinitionNode.value.computed === true) {

					isObjectReferenced = true;
					this.updateIsObjectReferenced(isObjectReferenced);
				}
	
				if(objectPropertyIdentifier === undefined || 
				objectPropertyIdentifier.type !== 'Identifier' || 
				propertyDefinitionNode.parentPath.value.type !== 'AssignmentExpression') {
	
					//object property is not defined in the object's prototype
					return;
				}
	
				// console.log(propertyReferenceMemberExpression.value.type);
				// console.log(propertyReferenceMemberExpression.value);
				// console.log(referenceIdentifiers.at(0).get());
				// console.log(propertyDefinitionNode.value);
				
				let objectProperty = new ObjectProperty.ObjectProperty(objectPropertyIdentifier.name, propertyDefinitionNode.parentPath.value);
				if(isPrototypeProperty === true) {
	
					// let existentPrototypeProperties = objectPrototypeProperties.filter(function(currentObjectProperty) {
	
					// 	return currentObjectProperty.propertyName === objectProperty.propertyName;
					// });
	
					// console.log(objectProperty)
					// console.log(existentProperties.length);
		
					if(objectPrototypeProperties.some(currentObjectProperty => {
	
						return currentObjectProperty.propertyName === objectProperty.propertyName;
						}) === false) {
		
						//there does not exist such property
						//add objectProperty to array
						objectPrototypeProperties.push(objectProperty);
					}
				}
				else {
	
					// let existentProperties = objectProperties.filter(function(currentObjectProperty) {
	
					// 	return currentObjectProperty.propertyName === objectProperty.propertyName;
					// });
		
					// console.log(existentProperties.length);
		
					if(objectProperties.some(currentObjectProperty => {
	
						return currentObjectProperty.propertyName === objectProperty.propertyName;
					}) === false) {
		
						//there does not exist such property
						//add objectProperty to array
						objectProperties.push(objectProperty);
					}
				}

				//finally, determine whether object is fully referenced (e.g. iterated) in the analyzed system
				if(propertyReferenceMemberExpression.value.type === 'AssignmentExpression') {

					//object reference within export statement (do not consider this reference as an iteration over the object's properties)
					let exportObjRefs = jscodeshift(propertyReferenceMemberExpression).find(jscodeshift.Identifier).filter(identifier => {

						return identifier.value.name === 'exports';
					});

					if(exportObjRefs.length > 0) {

						isObjectReferenced = false;
						this.updateIsObjectReferenced(isObjectReferenced);
						return;
					}

					exportObjRefs = jscodeshift(propertyReferenceMemberExpression).find(jscodeshift.MemberExpression).filter(memberExpression => {

						return memberExpression.value.object.type === 'Identifier' && memberExpression.value.object.name === 'module' &&
							memberExpression.value.property.type === 'Identifier' && memberExpression.value.property.name === 'exports';
					});

					if(exportObjRefs.length > 0) {

						isObjectReferenced = false;
						this.updateIsObjectReferenced(isObjectReferenced);
						return;
					}
				}
				else if(propertyReferenceMemberExpression.value.type === 'CallExpression') {

					//object reference within callexpression
					isObjectReferenced = false;
					this.updateIsObjectReferenced(isObjectReferenced);
					return;
				}

				if(propertyReferenceMemberExpression.value.type !== 'MemberExpression') {
	
					if(propertyReferenceMemberExpression.value.type === 'CallExpression' ||
						propertyReferenceMemberExpression.value.type === 'NewExpression') {

						//identifier located in an invocation or a new invocation
						//do not assume that is referenced as an object
						isObjectReferenced = false;
						this.updateIsObjectReferenced(isObjectReferenced);
						return;
					}

					//the retrieved identifier is not located within a member expression
					//the variable is referenced outside a member expression (it is referenced as a whole)
					isObjectReferenced = true;
					this.updateIsObjectReferenced(isObjectReferenced);
					return;
				}
			});
			   
		});
   
		// console.log(this.variableName + ' ' + isObjectReferenced);
		// this.updateIsObjectReferenced(isObjectReferenced);
		// console.log(this.variableName + ' ' + this.isObjectReferenced)
   
		// console.log(objectProperties.length);
   
		//for each object/prototype property, retrieve its uses
		objectProperties.forEach(objectProperty => {
   
			objectProperty.updateObjectPropertyReferences(sourceFile, objectReferenceIdentifiers);
		});
   
		objectPrototypeProperties.forEach(prototypeProperty => {
   
			prototypeProperty.updateObjectPropertyReferences(sourceFile, objectReferenceIdentifiers);
		});
   
		// console.log(objectPrototypeProperties.length);
   
		this.updateObjectProperties(objectProperties);
		this.updatePrototypeProperties(objectPrototypeProperties);
		
	   });
   
	   ternServer.delFile(sourceFile.fileName);
   
	//    console.log(this.variableName + ' ' + this.isObjectReferenced);
	}

	/**
	 * Counts the definitions exported through the variable before the introduction of ES6 statements.
	 * Needed for statistics assessment
	 */
	this.numberDefinitionsExportedFromVariable = function() {

		// //(i) object that is iterated (counts as 1)
		// //(ii) cohesive object (counts as 1 + the number of its non-constructor properties)
		// //(iii) non-cohesive object with properties (counts as the number of its non-constructor properties)
		// //(iv) non-cohesive object without properties (counts as 1)
		// if(this.isObjectReferenced === true) {

		// 	return 1;
		// }
		
		// if(this.isInitializedWithFunctionConstructor === true) {

		// 	return this.objectProperties.length+1;
		// }

		// if(this.objectProperties.length > 0) {

		// 	return this.objectProperties.length;
		// }

		// return 1;

		//regardless of its cohesion, we count the variable definition as 1
		//and (if exist) the function property as 1/property
		return this.objectProperties.length + 1;
	};
}

exports.Variable = Variable;