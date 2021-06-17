/**
 * http://usejsdoc.org/
 */

var jscodeshift = require('../../../../node_modules/jscodeshift');

//used for def-use algorithm
var tern = require('../../../../node_modules/tern');
var ternServer = new tern.Server({});

var enums = require('../util/enums.js');
var FunctionProperty = require('./functionProperty.js');
var Variable = require('./variable.js');
var ObjectLiteral = require('./objectLiteral.js');

function FunctionDeclaration(functionNode) {
	
	this.functionName = null;
	this.updateFunctionName = function() {

		let functionName;
		if(this.functionNode.value.type === 'FunctionDeclaration') {
			
			functionName = this.functionNode.value.id.name;
		}
		else if(this.functionNode.value.type === 'FunctionExpression') {
			
			//node corresponds to a function expression
			//syntax: var <functionName> = function(<args>) {...};
			var parentNode = this.functionNode.parentPath.value;
			if(parentNode.type === 'VariableDeclarator') {
				
				//anonymus function assigned to a variable (var <variableName> = function(<args>) { ... })
				functionName = parentNode.id.name;
			}
			else if(parentNode.type === 'AssignmentExpression') {
				
				//function assigned to a property (this.<propertyName> = function(<args>) { ... })
				//or to an identifier
				var leftOperand = parentNode.left;
				if(leftOperand.type === 'Identifier') {

					functionName = leftOperand.name;
				}
				else if(leftOperand.type === 'MemberExpression') {

					if(leftOperand.property === undefined) {
					
						functionName = leftOperand;
					}
					else {
						
						functionName = leftOperand.property.name;
					}
				}
				else {

					functionName = 'anonymus';
				}
			}
			else if(parentNode.type === 'Property') {
				
				//function assigned to a property of an object literal (<propertyName> : function(<args>) { ... })
				functionName = parentNode.key.name;
			}
			else {
				functionName = 'anonymus';
			}
		}
		
		if(functionName === 'exports') {
			
			//case [function named exports]: function is assigned to module.exports
			//(and module.exports is assigned to a variable)
			//retrieve variable assigned module.exports
			
			//find functionExpression's parentNode
			var parentNode = this.functionNode.parentPath;
			while(parentNode !== null) {
				
				if(parentNode.value.type === 'VariableDeclarator') {
					
					//VariableDeclarator: statement comprising the definition of a variable
					functionName = parentNode.value.id.name;
					break;
				}
				
				parentNode = parentNode.parentPath;
			}

			//module.exports is not assigned to a variable
			//anonymus function
			if(parentNode === null) {

				functionName = 'anonymus';
			}
		}

		this.functionName = functionName;
	};
	
	//functionNode: node representing definition of function
	this.functionNode = functionNode;
	
	this.functionParameters = [];
	this.updateFunctionParameters = function(functionParameters) {
		this.functionParameters = functionParameters;
	};
	
	this.functionScope = null;
	this.updateFunctionScope = function(functionScope) {
		
		this.functionScope = functionScope;
	};

	this.isConstructor = false;
	this.updateIsConstructor = function(isConstructor) {

		this.isConstructor = isConstructor;
	};

	//what if a function is not a constructor, but it is referenced outside member expressions
	//maybe iterated?
	//also applies to function with computed properties
	this.isObjectReferenced = false;
	this.updateIsObjectReferenced = function(isObjectReferenced) {

		//in the case the function object is iterated at least once, keep information
		//else, update field (all references are used in order to determine the fact)
		this.isObjectReferenced = isObjectReferenced;
	};

	//is function used besides its statically-known properties?
    this.usedBesidesProperties = false;
    this.updateUsedBesidesProperties = function(usedBesidesProperties) {

        //in the case the function object is used besides its statically-known
        //properties at least once, keep information
		//else, update field (all references are used in order to determine the fact)
        this.usedBesidesProperties = this.usedBesidesProperties === false ? 
                                        usedBesidesProperties : 
                                        this.usedBesidesProperties;
	};

	//what if a function has object properties initialized with imported definitions?
	this.hasBoundPropertiesInitializedWithImportDefs = false;
	this.updateHasBoundPropertiesInitializedWithImportDefs = function(hasBoundPropertiesInitializedWithImportDefs) {

		this.hasBoundPropertiesInitializedWithImportDefs = hasBoundPropertiesInitializedWithImportDefs;
	};

	//properties bound to the function's prototype
	//(in order to be inherited to the object's "sub-objects")
	//FunctionProperty
	this.prototypeProperties = [];
	this.updatePrototypeProperties = function(prototypeProperties) {

		this.prototypeProperties = prototypeProperties;
	};
	
	//properties assigned via binding of this (they belong to the objects
	//initialized through this function, not to the function itself)
	//FunctionProperty
	this.functionConstructorProperties = [];
	this.updateFunctionConstructorProperties = function(functionConstructorProperties) {

		this.functionConstructorProperties = functionConstructorProperties;
	};

	//properties assigned via binding of function
	//(they belong to the function itself)
	//FunctionProperty
	this.functionProperties = [];
	this.updateFunctionProperties = function(functionProperties) {
		this.functionProperties = functionProperties;
	};

	this.retrieveFunctionPropertyByName = function(propertyName) {

		return this.functionProperties.find(functionProperty => {

			return functionProperty.propertyName === propertyName;
		});
	};

	this.retrievePrototypePropertyByName = function(propertyName) {

		// let retrievedProperties = this.prototypeProperties.filter(function(property) {

		// 	return property.propertyName === propertyName;
		// });

		// if(retrievedProperties.length === 0) {

		// 	return null;
		// }

		// return retrievedProperties[0];

		//refactored to use find() instead of filtering all properties
		let protProp = this.prototypeProperties.find(property => {

			return property.propertyName === propertyName;
		});

		return protProp === undefined ? null : protProp;
	};

	this.retrieveConstructorPropertyByName = function(propertyName) {

		// let retrievedProperties = this.functionConstructorProperties.filter(function(constructorProperty) {

		// 	return constructorProperty.propertyName === propertyName;
		// });

		// if(retrievedProperties.length === 0) {

		// 	return null;
		// }

		// return retrievedProperties[0];

		//refactored to use find() instead of filtering all properties
		let retrProp = this.functionConstructorProperties.find(constructorProperty => {

			return constructorProperty.propertyName === propertyName;
		});

		return retrProp === undefined ? null : retrProp;
	};

	//retrieves property (of any type) by its name
	this.retrievePropertyByName = function(propertyName) {

		//do we search for a function property?
		//(a property that is bound to the function)
		let retrievedProperty = this.retrieveFunctionPropertyByName(propertyName);
		if(retrievedProperty != null) {

			return retrievedProperty;
		}

		//do we search for a prototype property?
		//(a property bound to the function's prototype, in order to be inherited by the function's sub-objects)
		retrievedProperty = this.retrievePrototypePropertyByName(propertyName);
		if(retrievedProperty !== null) {

			return retrievedProperty;
		}

		//do we search for a constructor property?
		//(a property bound to the function's instances)
		//finally, return either a constructor property 
		//with the specific name or null (if there is no such property)
		return this.retrieveConstructorPropertyByName(propertyName);
	};
	
	//updated function information with:
	//(1) enclosed functions ( => definedFunctions contains function declared within sourceFile using either function expressions or function declarations) and 
	//(2) object literals (case: myModuleFunc() in secondModule.js) ( => local variables)
	this.nestedFunctions = [];
	this.updateNestedFunctions = function(nestedFunctions) {
		this.nestedFunctions = nestedFunctions;
	};

	this.addFunctionDeclarationToNestedFunctions = function(nestedFunction) {

		//add nestedFunction once
		// console.log(this.functionName + ' ' + nestedFunction.functionName);

		if(this.nestedFunctions.some(nestedFunc => {

			return nestedFunc.functionNode.value === nestedFunction.functionNode.value;

		}) === false) {

			// console.log(nestedFunction.functionName)
			this.nestedFunctions.push(nestedFunction);
		}
	};

	this.retrieveNestedFunctionByName = function(nestedFunctionName) {

		// console.log(this.nestedFunctions);
		// let nestedFunctions = this.nestedFunctions.filter(nestedFunction => {

		// 	// console.log(nestedFunction.functionName)
		// 	return nestedFunction.functionName === nestedFunctionName;
		// });

		// if(nestedFunctions.length === 0) {

		// 	return null;
		// }

		// return nestedFunctions[0];

		//refactored to use find() instead of filtering all properties
		let nestedFunction = this.nestedFunctions.find(nestedFunction => {

			// console.log(nestedFunction.functionName)
			return nestedFunction.functionName === nestedFunctionName;
		});

		return nestedFunction === undefined ? null : nestedFunction;
	};
	
	this.localVariables = [];
	this.updateLocalVariables = function(localVariables) {
		this.localVariables = localVariables;
	};

	this.retrieveLocalVariablesOfFunction = function retrieveLocalVariablesOfFunction(sourceFile) {
	   
	   let localVariables = [];

	   //topLevelScope is an artifical function node modelling the module's top-level scope
	   //topLevelScope's local variables are the module's explicit globals
	   if(this.functionName === 'topLevelScope') {

		   this.updateLocalVariables(sourceFile.explicitGlobals);
		   return;
	   }

	   //find variables defined locally within definitionFunction 
	   //(exclude variables defined within definedFunction's nested functions/scopes)
	   let variableDeclarations = jscodeshift(this.functionNode).find(jscodeshift.VariableDeclaration).filter(nodePath => {

		   let node = nodePath;
		   
		   //find the closest scope of node
		   //is definedFunction the closest scope of node?
		   if(node.scope.node === this.functionNode.value) {

				return true;
		   }

		   return false;

		   //find the closest scope of node
		   //let closestScopes = jscodeshift(node).closestScope();

		   //is definedFunction the closest scope of node?
		   //let functionScopes = closestScopes.filter(closestScope => {

		// 	   if(closestScope.value === this.functionNode.value) {

		// 			return true;
		// 		}

		// 		return false;
		// 	});

		// 	//definedFunction not the closest scope of node
		// 	if(functionScopes.length === 0) {

		// 		 return false;
		// 	}

			// return true;
		});
		
		variableDeclarations.forEach(variableDeclaration => {
			
			//find the variables declared in the current variable declaration
			let declarations = variableDeclaration.value.declarations;
			
			// console.log(declarations);
			
			declarations.forEach(declaration => {
				
				let definedVariable = new Variable.Variable();
				definedVariable.updateVariable(sourceFile, variableDeclaration, declaration);
				localVariables.push(definedVariable);
			});
			
		});
		
		this.updateLocalVariables(localVariables);
   }

	this.retrieveLocalVariableByName = function(localVariableName) {

		// let funcLocalVars = this.localVariables.filter(localVar => {

		// 	return localVar.variableName === localVariableName;
		// });

		// if(funcLocalVars.length === 0) {

		// 	return null;
		// }

		// return funcLocalVars[0];

		//refactored to use find() instead of filtering all variables
		let funcLocalVar = this.localVariables.find(localVar => {

			return localVar.variableName === localVariableName;
		});

		return funcLocalVar === undefined ? null : funcLocalVar;
	};

	//storing returnStatementNode (returned value has no parentPath)
	//this statement is replaced with an export default statement,
	//in case when the declaration of the returned element does not exist
	this.returnStatementNode = null;
	this.updateReturnStatementNode = function(returnStatementNode) {

		this.returnStatementNode = returnStatementNode;
	};
	
	this.returnedElementDeclaration = null;
	this.updateReturnedElementDeclaration = function(returnedElementDeclaration) {

		this.returnedElementDeclaration = returnedElementDeclaration;
	};
	
	this.isExported = false;
	this.updateIsExported = function(isExported) {
		
		this.isExported = isExported;
	};
	
	this.exportedFunctionNode = null;
	this.updateExportedFunctionNode = function(exportedFunctionNode) {
		
		this.exportedFunctionNode = exportedFunctionNode;
	};

	this.exportedThroughModuleExports = false;
	this.updateExportStatementType = function(isFunctionExportedThroughModuleExports) {

		this.exportedThroughModuleExports = isFunctionExportedThroughModuleExports;
	};

	//the set of the imported elements that are used inside functionDeclaration (functionDeclaration depends on usedElements)
	//(needed to assess efferent coupling of a module)
	this.usedElements = [];
	this.updateUsedElements = function(usedElement) {

		this.usedElements.push(usedElement);
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
	
	this.printDefinedFunctionInfo = function() {
		
		var result = "";
		result += 'function: ' + this.functionName;
		result += '\nscope: ';
		if(this.functionScope === null) {
			
			result += this.functionScope;
		}
		else {
			
			result += this.functionScope.functionName;
		}

		result += '\nfunctionConstructorProperties: ';
		this.functionConstructorProperties.forEach(function(functionConstructorProperty) {
			
			result += functionConstructorProperty.propertyName + ',';
			
		});
		
		result += '\nnestedFunctions:';
		this.nestedFunctions.forEach(function(nestedFunction) {
			
			result += nestedFunction.printDefinedFunctionInfo();
		});
		
		result += '\nlocalVariables:';
		this.localVariables.forEach(function(localVariable) {
			
			result += localVariable.variableName + ',';
		});
		
		result += '\n';
		
		return result;
		
	};

	/**
	 * Retrieves the properties bound to the function definition specified in definedFunction.
	 * Also, for each property, it retrieves its usages (through finding references to the function object
	 * either through the function object itself or to 'this' inside a method property).
	 * @param {*} sourceFile 
	*/
	this.retrievePropertiesOfFunction = function(sourceFile) {

		// console.log(sourceFile.fileName + ' ' + this.functionName);

		let isObjectReferenced = false;

		//don't find function properties in test modules
		if(sourceFile.moduleType === enums.ModuleType.testFile || 
			this.functionName === 'topLevelScope') {

			return;
		}

		let functionName = this.functionName;
		let astRootCollection = sourceFile.astRootCollection;

		//functionProperties: properties bound to the function (syntax: <functionName>.<identifier> = <initialization_value>)
		let functionProperties = [];

		//properties bound to the function's prototype (syntax: <functionName>.prototype.<propertyIdentifier> = <initialization_value>)
		let prototypeProperties = [];
		let parentPath;
		let functionIdentifierStart = null;
		let functionIdentifierEnd = null;
		let leftOperand;

		ternServer.addFile(sourceFile.fileName, sourceFile.astRootCollection.toSource());

		//retrieve uses (calls) of function declaration in sourceFile

		//retrieve definedFunction's name identifier location, according to the AST node's type
		if(this.functionNode.value.type === 'FunctionExpression') {

			parentPath = this.functionNode.parentPath;
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
			}
		}
		else if(this.functionNode.value.type === 'FunctionDeclaration') {

			functionIdentifierStart = this.functionNode.value.id.range[0];
			functionIdentifierEnd = this.functionNode.value.id.range[1];
		}

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
				start: functionIdentifierStart,
				variable: this.functionName
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
		});

		//exclude references that model the function's definition
		referenceRanges = referenceRanges.filter(referenceRange => {

			return referenceRange.start !== functionIdentifierStart && 
				   referenceRange.end !== functionIdentifierEnd;
		});

		//ternjs retrieves the ranges of the function's references
		//retrieve these uses in the AST
		let referenceIdentifiers = [];
		let funcRefs = [];

		referenceRanges.forEach(referenceRange => {

			//find reference in the AST (jscodeshift)
			funcRefs = sourceFile.astRootCollection.find(jscodeshift.Identifier).filter(funcRef => {

				let funcRefRange = funcRef.value.range;
				// if(funcRef.value.name === this.functionName) {

				// 	console.log(funcRef.value.range);
				// 	console.log(referenceRange);
				// 	console.log(funcRef.parentPath.value.type)
				// 	console.log(this.functionNode.value.type);
				// 	console.log();
				// }

				//usage inside function
				// if(funcRef.scope.node === this.functionNode.value) {

				// 	return false;
				// }

				//assumption: the ASTs of tern and jscodeshift differ in some cases w.r.t. to the range of the node
				//also consider identifiers of the same name
				//(don't consider references inside function definition node)
				return (funcRef.value.name === this.functionName && referenceRange.start === funcRefRange[0] && referenceRange.end === funcRefRange[1]) ||
						(funcRef.value.name === this.functionName && 
							((funcRef.parentPath.value.type === 'MemberExpression' &&
							funcRef.parentPath.value.object === funcRef.value) ||
							(funcRef.parentPath.value.type !== 'MemberExpression' &&
							funcRef.parentPath.value !== this.functionNode.value)));

			});

			let usageIdentifiers = funcRefs.filter(usageIdentifier => {

				// console.log(usageIdentifier.value.loc.start.line);
				let isFunctionAssignedToExportsModuleExports = false;
				let parentNode = usageIdentifier.parentPath;
				let isPropertyDefined = false;

				//is object fully referenced (e.g. provided as a parameter)?
				let surrMbExps = jscodeshift(usageIdentifier).closest(jscodeshift.MemberExpression);

				//no member expressions surrounding usageIdentifier
				//probably the object is fully referenced
				// console.log('s: ' + surrMbExps.length)
				if(usageIdentifier.parentPath.value.type === 'FunctionDeclaration') {

					isObjectReferenced = false;
					// console.log(usageIdentifier.value.loc.start.line + ' ' +isObjectReferenced)
					this.updateIsObjectReferenced(isObjectReferenced);
				}
				else if(usageIdentifier.parentPath.value.type === 'MemberExpression' &&
						usageIdentifier.parentPath.value.computed === true) {

					isObjectReferenced = true;
					this.updateIsObjectReferenced(isObjectReferenced);	
				}
				else if(surrMbExps.length === 0) {

					let surrStmts = jscodeshift(usageIdentifier).closest(jscodeshift.Statement);

					if(surrStmts.length > 0) {

						let surrStmt = surrStmts.at(0).get();
						let expObjRefs = jscodeshift(surrStmt).find(jscodeshift.Identifier).filter(id => {

							return id.value.name === 'exports';
						});

						//usage inside an export statement
						//object not fully referenced
						if(expObjRefs.length > 0) {

							isObjectReferenced = false;
							this.updateIsObjectReferenced(isObjectReferenced);
						}
						else {

							//usage inside an export statement
							//object not fully referenced
							expObjRefs = jscodeshift(surrStmt).find(jscodeshift.MemberExpression).filter(mbExp => {

								return mbExp.value.object.type === 'Identifier' &&
										mbExp.value.object.name === 'module' &&
										mbExp.value.property.type === 'Identifier' &&
										mbExp.value.property.name === 'exports';
							});

							if(expObjRefs.length > 0) {

								isObjectReferenced = false;
								this.updateIsObjectReferenced(isObjectReferenced);
							}
							else {

								if((usageIdentifier.parentPath.value.type === 'BinaryExpression' &&
									usageIdentifier.parentPath.value.operator === 'instanceof') ||
									usageIdentifier.parentPath.value.type === 'NewExpression' ||
									(usageIdentifier.parentPath.value.type === 'CallExpression' &&
									 usageIdentifier.parentPath.value.callee === usageIdentifier.value)) {

									isObjectReferenced = false;
									this.updateIsObjectReferenced(isObjectReferenced);
								}
								else {

									isObjectReferenced = true;
									this.updateIsObjectReferenced(isObjectReferenced);
								}

								
							}
						}
					}
					else {

						if((usageIdentifier.parentPath.value.type === 'BinaryExpression' &&
							usageIdentifier.parentPath.value.operator === 'instanceof') ||
							usageIdentifier.parentPath.value.type === 'NewExpression' ||
							(usageIdentifier.parentPath.value.type === 'CallExpression' &&
							 usageIdentifier.parentPath.value.callee === usageIdentifier.value)) {

								isObjectReferenced = false;
								this.updateIsObjectReferenced(isObjectReferenced);
						}
						else {

							isObjectReferenced = true;
							this.updateIsObjectReferenced(isObjectReferenced);
						}
						
					}

					// console.log(usageIdentifier.value.loc.start.line + ' ' +isObjectReferenced)
					// isObjectReferenced = false;
					// this.updateIsObjectReferenced(isObjectReferenced);
				}

				while(parentNode !== null &&
					parentNode.value.type !== 'ExpressionStatement') {

					// console.log(parentNode.value.type);
					if(parentNode.value.type && 
						((parentNode.value.type === 'MemberExpression' &&
						 parentNode.parentPath.value.type === 'AssignmentExpression') || 
						 parentNode.value.type === 'Property')) {

						//a property is defined through assignment (inside a member expression) or binding
						isPropertyDefined = true;
						break;
					}
					// else if(parentNode.value.type && parentNode.value.type !== 'MemberExpression') {

					// 	//function referenced not in a property definition
					// 	//it might be iterated
					// 	if(parentNode.value.type !== 'CallExpression' && 
					// 		parentNode.value.type !== 'NewExpression') {

					// 		isObjectReferenced = true;
					// 		this.updateIsObjectReferenced(isObjectReferenced);
					// 	}
						
					// }

					parentNode = parentNode.parentPath;
				}

				// console.log(isObjectReferenced)

				// if(isPropertyDefined === false) {

				// 	return false;
				// }

				//usage within an assignment or a property definition
				//we consider a function's usage as a potential property definition
				//in the case that the usage is in the left side of the assignment
				//and, especially, the member expression's object
				if(parentNode !== null && parentNode.value.type === 'AssignmentExpression') {

					let leftOperand = parentNode.value.left;
					let leftOperandIdentifier = leftOperand;
					while(leftOperandIdentifier.type === 'MemberExpression') {

						leftOperandIdentifier = leftOperandIdentifier.object;
					}

					if(leftOperandIdentifier.type === 'Identifier' && leftOperandIdentifier.name !== this.functionName) {

						return false;
					}
				}

				parentNode = usageIdentifier.parentPath;
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

				// console.log(usageIdentifier.value.loc);
				
				//ternjs may not retrieve the function's properties soundly
				//consider uses of function, but not within the function's definition (also, do not consider assignments to exports/module.exports)
				return (require.resolve(referenceRange.file) === require.resolve(sourceFile.fileName) &&
					usageIdentifier.value.range[0] === referenceRange.start && 
					usageIdentifier.value.range[1] === referenceRange.end) || 
					(this.functionName === usageIdentifier.value.name && 
						usageIdentifier.value.range[0] !== functionIdentifierStart &&
						usageIdentifier.value.range[1] !== functionIdentifierEnd);
			});

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

		// console.log(funcRefs.length);
		// console.log(referenceIdentifiers.length);

		//function references that may introduce a function property (prototype/instance/object)
		referenceIdentifiers.forEach(referenceIdentifier => {

			// console.log(referenceIdentifier.value.loc);

			if(referenceIdentifier.value.name !== this.functionName) {

				isObjectReferenced = false;
				this.updateIsObjectReferenced(isObjectReferenced);
				return;
			}

			//each reference identifier may be within a function's property definition
			//(function property definition syntax: (<functionName> | <this>).<propertyName> = <initializationValue>)
			let parentNode = referenceIdentifier.parentPath;

			// console.log(parentNode.value.type)
			if(parentNode.value.type !== 'MemberExpression') {

				if(parentNode.value.type === 'AssignmentExpression') {

					let exportObjRefs = jscodeshift(parentNode).find(jscodeshift.Identifier).filter(identifier => {
	
						return identifier.value.name === 'exports';
					});
	
					// console.log(exportObjRefs.length);
					if(exportObjRefs.length > 0) {
	
						isObjectReferenced = false;
						this.updateIsObjectReferenced(isObjectReferenced);
						return;
					}
	
					exportObjRefs = jscodeshift(parentNode).find(jscodeshift.MemberExpression).filter(memberExpression => {
	
						return memberExpression.value.object.type === 'Identifier' && memberExpression.value.object.name === 'module' &&
							   memberExpression.value.property.type === 'Identifier' && memberExpression.value.property.name === 'exports';
					});
	
					// console.log(exportObjRefs.length);
					if(exportObjRefs.length > 0) {
	
						isObjectReferenced = false;
						this.updateIsObjectReferenced(isObjectReferenced);
						return;
					}
				}
				else if(parentNode.value.type === 'CallExpression' ||
						parentNode.value.type === 'NewExpression') {

					isObjectReferenced = false;
					this.updateIsObjectReferenced(isObjectReferenced);
				
					return;
				}

				//reference not in a member expression - proceed to the next reference
				// console.log(parentNode.value.type)
				// console.log(parentNode.value)
				isObjectReferenced = true;
				this.updateIsObjectReferenced(isObjectReferenced);
				// console.log(referenceIdentifier.value);
				// console.log(isObjectReferenced);
				return;
			}
			else if((parentNode.parentPath.value.type === 'MemberExpression' && 
					parentNode.parentPath.value.object.type === 'MemberExpression' &&
					parentNode.parentPath.value.object.property.type === 'Identifier' && 
					(parentNode.parentPath.value.object.property.name !== 'prototype' &&
					parentNode.parentPath.value.object.property.name !== this.functionName)) ||
					parentNode.value.type !== 'MemberExpression') {

					//reference within member expression,
					//but the expression's object is a property of definedFunction (nested property)
					//definedFunction's properties are resolved, not its properties' properties
					isObjectReferenced = false;
					this.updateIsObjectReferenced(isObjectReferenced);
					return;
			}

			while(parentNode !== null && parentNode.value.type !== 'AssignmentExpression') {

				parentNode = parentNode.parentPath;
			}

			if(parentNode === null) {

				//reference not within an assignment
				isObjectReferenced = false;
				this.updateIsObjectReferenced(isObjectReferenced);
				return;
			}

			// console.log(parentNode.value.type);

			//reference in a member expression - initialise and update the new function property
			let functionProperty = new FunctionProperty.FunctionProperty(parentNode);
			functionProperty.updateFunctionProperty();

			//do not consider properties with invalid names
			if(functionProperty.propertyName == null ||
				isNaN(functionProperty.propertyName) === false ||
				this.retrieveConstructorPropertyByName(functionProperty.propertyName) !== null) {

				return;
			}

			if(functionProperty.isPrototypeProperty === true) {

				//functionProperty bound to the function's prototype
				//add to the respective array once
				let existentPrototypeProperties = prototypeProperties.filter(prototypeProperty => {
	
					return prototypeProperty.propertyName === functionProperty.propertyName;
				})
	
				if(existentPrototypeProperties.length === 0) {
	
					prototypeProperties.push(functionProperty);
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

		// this.updateIsObjectReferenced(isObjectReferenced);
		// console.log(this.isObjectReferenced);

		//also, in the case that function is initialized with exports/module.exports,
		//other bindings to exports/module.exports comprise the function properties
		// let functionAssignedToExportObject = this.isFunctionAssignedToExportObject();

		//for each function property, retrieve its usages (references)
		//syntax: <functionName>.<propertyName> (everywhere in the module) || 
		//		  this.<propertyName> (inside a method property)
		//(find references to the function object itself or 'this')
		//(if function is a function object, its destructuring requires the replacement of property usages with usages of the respective variables)
		functionProperties.forEach(function(functionProperty) {

			functionProperty.updateFunctionPropertyReferences(sourceFile, referenceIdentifiers);
		});

		//retrieve uses of each prototype property
		prototypeProperties.forEach(function(prototypeProperty) {

			prototypeProperty.updateFunctionPropertyReferences(sourceFile, referenceIdentifiers);
		});

		ternServer.delFile(sourceFile.fileName);

		// console.log('functionName: ' + definedFunction.functionName + ' functionProperties length: ' + functionProperties.length);
		this.updateFunctionProperties(functionProperties);

		//update prototype properties of definedFunction (prototype properties are bound in the object's prototype,
		//not in the object itself)
		this.updatePrototypeProperties(prototypeProperties);

		// console.log(functionProperties);
		// console.log(functionPrototypeProperties);
	};

	/**
	 * Returns the properties defined in the body of a 
	 * function expression (through binding properties to this).
	 * Also returns the properties assigned to the function's
	 * prototype.
	 * @param functionExpression
	 * @returns
	 */
	this.retrieveConstructorPropertiesOfFunction = function retrieveConstructorPropertiesOfFunction() {
		
		var functionProperties = [];
		var functionExpression = this.functionNode;

		// console.log(this.functionName)

		//function constructor property definitions may be located everywhere
		//within function (e.g. within if loops etc)
		//inside the AST formed by the function declarations,
		//search function constructor property definitions 
		//(assignments to member expressions whose object is 'this')
		let functionDefinitionNode = jscodeshift(functionExpression.value);
		let functionConstructorPropertyDefinitionCollection = functionDefinitionNode.find(jscodeshift.AssignmentExpression).filter(path => {

			let leftOperand = path.value.left;

			if(leftOperand.type !== 'MemberExpression' || leftOperand.object.type !== 'ThisExpression') {

				return false;
			}

			return true;
		});

		if(functionConstructorPropertyDefinitionCollection.length === 0) {

			return [];
		}

		functionConstructorPropertyDefinitionCollection.forEach(propertyDefinition => {

			let definedProperty = new FunctionProperty.FunctionProperty(propertyDefinition);
			definedProperty.updateFunctionProperty();

			//do not consider properties with invalid names
			if(definedProperty.propertyName == null ||
				isNaN(definedProperty.propertyName) === false) {

				return;
			}

			// console.log(definedProperty.propertyName);

			//avoid duplicates (e.g. due to conditional initialization of values)
			let existentProperty = functionProperties.find(functionProperty => {

				return functionProperty.propertyName === definedProperty.propertyName;
			});

			// console.log(existentProperty == undefined);

			if(existentProperty == undefined) {

				functionProperties.push(definedProperty);
			}

		});

		return functionProperties;

	}

	this.addFunctionPropertyToFunction = function(functionProperty) {

		// console.log(functionProperty);
		if(functionProperty.isPrototypeProperty === true) {

			//functionProperty bound to the function's prototype
			//add to the respective array once
			let existentPrototypeProperties = this.prototypeProperties.filter(prototypeProperty => {

				return prototypeProperty.propertyName === functionProperty.propertyName;
			})

			if(existentPrototypeProperties.length === 0) {

				this.prototypeProperties.push(functionProperty);
			}
		}
		else {

			//functionProperty bound to the function object
			//add to the respective array once
			let existentProperties = this.functionProperties.filter(definedFunctionProperty => {

				return definedFunctionProperty.propertyName === functionProperty.propertyName;
			});

			if(existentProperties.length === 0) {

				this.functionProperties.push(functionProperty);
			}
		}
	};

	this.updateDeclaredFunction = function(sourceFile) {

		this.updateFunctionName();
		// console.log(this.functionName);
		// console.log(this.functionNode.value.params);
		this.updateFunctionParameters(this.functionNode.value.params);

		//retrieve properties of function (properties that are bound to the function object)
		//(syntax: <functionName>.<identifier> = <initialization_value>)
		//update: 
		this.retrievePropertiesOfFunction(sourceFile);

		//retrieve constructor properties of function
		//(properties initialized inside function through binding to this)
		//these functions belong to the objects initialized with function invokation,
		//not the function itself
		// console.log(sourceFile.fileName + " " + functionName);
		if(this.functionName !== 'topLevelScope') {

			var functionConstructorProperties = this.retrieveConstructorPropertiesOfFunction();
			functionConstructorProperties.forEach(functionProperty => {

				// console.log(this);
				
				//update the enclosing scope of each property
				functionProperty.updateEnclosingScope(this);
			});
			this.updateFunctionConstructorProperties(functionConstructorProperties);
			// console.log(functionConstructorProperties.length);

			//a function may also be cohesive, in the case that
			//at least 1 reference to 'this' is located within it
			let thisExpressions = jscodeshift(this.functionNode.value).find(jscodeshift.ThisExpression);

			//characterize function object as cohesive for the references to 'this'
			//inside its scope (not its nested scopes)
			let thisExpInsideFunc = thisExpressions.filter(thisExp => {

				// let enclosingFuncs = jscodeshift(thisExp).closest(jscodeshift[this.functionNode.value.type]);
				
				// //keep only the references to 'this' inside function pointed by 'this'
				// //(references whose closest scope is specified by function pointed by 'this')
				// return enclosingFuncs.some(enclosingFunc => {

				// 	return enclosingFunc.value === this.functionNode.value;
				// });

				//keep only the references to 'this' inside function pointed by 'this'
				//(references whose closest scope is specified by function pointed by 'this')
				return thisExp.scope === this.functionNode.value;
			});

			if(this.functionConstructorProperties.length > 0 || this.prototypeProperties.length > 0 || thisExpInsideFunc.length > 0) {

				//function contains properties initalized through binding of this
				//or properties are assigned to the function's prototype
				//function is likely to be used as a constructor
				this.updateIsConstructor(true);
			}
		}

		this.retrieveLocalVariablesOfFunction(sourceFile);
	};

	this.retrieveReturnValueOfFunction = function retrieveReturnValueOfFunction(sourceFile) {

		// console.log(sourceFile.fileName)
		// // console.log('f: ' + this.functionName);
		// console.log(this.functionNode.value.loc)
		let functionExpression = this.functionNode;

		//convert functionExpression (functionNode without its parent) to an AST
		//throughout the newly created AST (representing the functionExpression's code)
		//and search for return statements (each function has 0..1 return statements)
		//(exclude return statements inside nested functions)
		let returnStatementCollection = jscodeshift(functionExpression).find(jscodeshift.ReturnStatement).filter(nodePath => {

			// console.log(nodePath.value.loc)

			//keep statement whose closest scope is functionExpression
			let closestScopes = jscodeshift(nodePath).closestScope();
			let functionScopes = closestScopes.filter(closestScope => {

				// console.log(closestScope.value)
				// console.log(nodePath.scope.node);
				return closestScope.value === functionExpression.value;
			});

			// console.log(functionScopes.length);
			if(functionScopes.length === 0) {

				return false;
			}

			return true;
		});
		
		let returnedElement;
		let localVariable;

		// console.log(returnStatementCollection.length)

		//function has no return
		if(returnStatementCollection.length === 0) {

			return;
		}

		let returnStatement = returnStatementCollection.at(0).get();
		this.updateReturnStatementNode(returnStatement);

		// console.log(returnStatement.value)
		
		let returnArgument = returnStatement.value.argument;

		//function with a return with no value
		if(returnArgument === null) {

			return;
		}

		// console.log(returnArgument)

		//returnArgument types:
		//(a) identifier (variable/function reference)
		//(b) function expression
		//(c) object literal with properties
		//(d) (unknown) value (e.g. the result of a function)

		//(a)
		if(returnArgument.type === 'Identifier') {

			//functionExpression's argument is an identifier (a name)
			returnedElement = returnArgument.name;

			// console.log(functionExpression.value.loc);

			//retrieve returnedElement's type
			localVariable = this.retrieveLocalVariableByName(returnedElement);

			// console.log(localVariable)

			//returnedElement is a variable
			if(localVariable !== null) {

				this.updateReturnedElementDeclaration(localVariable);
				// console.log(this.returnedElementDeclaration);
				return;
			}
				
			let nestedFunction = this.retrieveNestedFunctionByName(returnedElement);

			// console.log(nestedFunction);

			//returnedElement is a function
			if(nestedFunction !== null) {

				this.updateReturnedElementDeclaration(nestedFunction);
				return;
			}

			return;
		}

		//(b)
		if(returnArgument.type === 'FunctionExpression') {

			let returnedFunction = sourceFile.retrieveDefinedFunctionByNode(returnArgument);

			if(returnedFunction === null) {

				return;
			}

			this.updateReturnedElementDeclaration(returnedFunction);
			return;
		}

		//(c)
		if(returnArgument.type === 'ObjectExpression') {

			// console.log(this.functionNode.value.loc);
			// console.log(returnStatement.value.loc);
			let objectLiteral = new ObjectLiteral.ObjectLiteral(returnArgument);
			objectLiteral.retrievePropertiesOfObjectLiteral();
		
			this.updateReturnedElementDeclaration(objectLiteral);
			// console.log(this.returnedElementDeclaration);
			return;
		}

		//(d) unknown values (e.g. results from function invocations, new expressions)
		//are modelled as ObjectLiteral objects without properties
		let objectLiteral = new ObjectLiteral.ObjectLiteral(returnArgument);

		//unknown values are not destructured during refactoring
		objectLiteral.updateIsCohesive(true);
		this.updateReturnedElementDeclaration(objectLiteral);

		// console.log(returnArgument);
		
		// console.log(this.returnedElementDeclaration);
	}

	this.isFunctionAssignedToExportObject = function() {

		let leftOperand = this.exportedFunctionNode.left;
		// console.log(leftOperand);
	};

	this.numberDefinitionsExportedFromFunction = function() {

		// //(i) object that is iterated (counts as 1)
		// //(ii) cohesive object (counts as 1 + the number of its non-constructor properties)
		// //(iii) non-cohesive object with properties (counts as the number of its non-constructor properties)
		// //(iv) non-cohesive object without properties (counts as 1)

		// if(this.isObjectReferenced === true) {

		// 	return 1;
		// }

		// if(this.isConstructor === true) {

		// 	return this.functionProperties.length+1;
		// }
		
		// if(this.functionProperties.length > 0) {

		// 	return this.functionProperties.length;
		// }

		// return 1;

		//regardless of its cohesion, we count the function definition as 1
		//and (if exist) the function property as 1/property
		// console.log(this.functionName + ' ' + (this.functionProperties.length + 1));
		return this.functionProperties.length + 1;
	};
}

exports.FunctionDeclaration = FunctionDeclaration;