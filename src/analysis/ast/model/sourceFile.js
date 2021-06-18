/**
 * http://usejsdoc.org/
 */

var fs = require('fs');
var path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');

var enums = require('../util/enums.js');
const reservedWords = require('../util/reservedWords.js');

var Variable = require('./variable.js');
var FunctionDeclaration = require('./functionDeclaration.js');
var ImpliedGlobalVariable = require('./impliedGlobalVariable.js');
var ExportedProperty = require('./exportedProperty.js');
var ObjectLiteral = require('./objectLiteral.js');
var ImportedElement = require('./importedElement.js');
var ImportedNamespace = require('./importedNamespace.js');
var ImportedModule = require('./importedModule.js');

var fileUtilities = require('../../../io/fileUtilities.js');

function SourceFile(fileName) {
	
	this.fileName = fileName;

	//alias of source file (in the case of AMD modules,
	//list of module paths may be specified through a call site of require.config)
	this.aliasName = null;
	this.updateAliasName = function(aliasName) {

		this.aliasName = aliasName;
	};
	
	//JS source code version of sourceFile (ES5 for up to ES5, ES6 for ES6)
	this.sourceVersion = null;
	this.updateSourceVersion = function(sourceVersion) {
		
		this.sourceVersion = sourceVersion;
	};
	
	//module framework used (commonJS or AMD)
	this.moduleFramework = [];
	this.updateModuleFramework = function(moduleFramework) {
		
		//case: ES5 module implemented to run both on server and on client
		this.moduleFramework.push(moduleFramework);
		
	};
	
	//jscodeshift astRootCollection of sourceFile
	this.astRootCollection = null;
	this.updateAstRootCollection = function(astRootCollection) {
		this.astRootCollection = astRootCollection;
	};

	this.moduleType = null;
	this.updateModuleType = function(moduleType) {

		this.moduleType = moduleType;
	};

	this.libraryObjectName = null;
	this.updateLibraryObjectName = function(libraryObjectName) {

		this.libraryObjectName = libraryObjectName;
	};

	this.isEntryFile = false;
	this.updateIsEntryFile = function(projectEntryFileAbsolutePath) {

		// console.log(this.fileName === projectEntryFileAbsolutePath);
		if(this.fileName === projectEntryFileAbsolutePath) {

			this.isEntryFile = true;
		}
	};
	
	//modules defined within sourceFile
	this.definedModules = [];
	this.addModuleDefinition = function(moduleName) {
		this.definedModules.push(moduleName);
	};

	this.doesFileContainDefinitionOfModule = function(moduleName) {
		return this.definedModules.indexOf(moduleName);
	};
	
	//files required within sourceFile
	this.requiredFiles = null;
	this.addModuleDependencies = function(requiredFiles) {
		
		this.requiredFiles = requiredFiles;
	};
	
	this.doesFileDependOnFile = function(file) {
		return this.requiredFiles.indexOf(file);
	};
	
	//modules dependent on sourceFile
	this.dependentModules = null;
	this.updateDependentModules = function(dependentModules) {
		
		this.dependentModules = dependentModules;
	};
	
	//functions defined within sourcefile
	this.definedFunctions = [];
	this.updateDefinedFunctions = function(definedFunctions) {
		
		this.definedFunctions = definedFunctions;
	};
	
	//explicit globals (globals defined in the top-level scope of file)
	this.explicitGlobals = [];
	this.updateExplicitGlobals = function(explicitGlobals) {
		
		this.explicitGlobals = explicitGlobals;
	};

	/**
	 * Is propertyName an object property defined 
	 * (bound in any module feature) in sourceFile?
	 * (Needed for preventing name conflicts).
	 * @param {*} propertyName 
	 */
	this.isObjectPropertyDefinedInSourcefile = function(propertyName) {

		let expGlobWithProp = this.explicitGlobals.find(explGlob => {

			return explGlob.objectProperties.some(objProp => {

				return objProp.propertyName === propertyName;
			});
		});

		if(expGlobWithProp != undefined) {

			return true;
		}

		let topLevelFuncWithProp = this.retrieveTopLevelScopeFunctions().find(topLevelFunc => {

			return topLevelFunc.functionProperties.some(funcProp => {

				return funcProp.propertyName === propertyName;
			});
		});

		if(topLevelFuncWithProp != undefined) {

			return true;
		}

		if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true &&
			this.objectLiteral != null &&
			this.objectLiteral.retrieveObjectPropertyByName(propertyName) != null) {

			return true;
		}

		if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true &&
			this.exportedProperties.some(expProp => {

				return expProp.retrieveObjectPropertyByName(propertyName) != undefined;

			}) === true) {

				return true;
		}

		return false;
	};

	//the classes defined within sourceFile
	this.definedClasses = [];
	this.updateDefinedClasses = function(definedClasses) {

		this.definedClasses = definedClasses;
	};

	//implied globals of module (variables that are assigned a value without being defined)
	this.impliedGlobals = [];
	this.updateImpliedGlobals = function(impliedGlobals) {

		this.impliedGlobals = impliedGlobals;
	};

	//modification functions of file after its transformation into an ES6 module
	//(functions containing statements that modify module variables - prior to ES6
	//these statements were located outside the module)
	this.modificationFunctions = [];
	this.updateModificationFunctions = function(modificationFunction) {

		this.modificationFunctions.push(modificationFunction);
	}

	this.retrieveImpliedGlobalByName = function(impliedGlobalName) {

		// console.log(this.impliedGlobals);
		var impliedGlobal;
		for(var impliedGlobalIndex = 0; impliedGlobalIndex < this.impliedGlobals.length; impliedGlobalIndex++) {

			impliedGlobal = this.impliedGlobals[impliedGlobalIndex];
			if(impliedGlobal.variableName === impliedGlobalName) {

				return impliedGlobal;
			}
		}

		return null;
	};

	//object literals (object literals representing the module - apply to AMD modules only)
	//case: AMD module that comprises an object literal, no function given in define()
	//or define() is provided with a callback function returning an object expression
	this.objectLiteral = null;
	this.updateObjectLiteral = function(objectLiteral) {

		this.objectLiteral = objectLiteral;
	};

	//exported properties (object literals that become exported through their direct assignment to exports/module.exports properties)
	//apply to CommonJS modules only
	this.exportedProperties = [];
	this.updateExportedProperties = function(exportedProperties) {

		this.exportedProperties = exportedProperties;
	};

	/**
	 * Retrieves exported property named or defining a property.
	 * @param {*} propertyName the property's name
	 */
	this.retrieveExportedPropertyNamedWithOrDefiningProperty = function(propertyName) {

		if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

			let expProp = this.exportedProperties.find(expProp => {

				return expProp.exportedPropertyName === propertyName ||
						expProp.retrieveObjectPropertyByName(propertyName) != null;
			});

			//module object property named propertyName (or with specific property) exists - stop
			if(expProp != null) {

				return expProp;
			}
		}

		if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

			//in AMD, object literals do not have name
			let expProp = this.exportedProperties.find(expProp => {

				return expProp.retrieveObjectPropertyByName(propertyName) != null;
			});

			//object with specified property exists - stop
			if(expProp != null) {

				return expProp;
			}
		}

		return null;
	};

	/**
	 * Is exportedProperty returned from a callback function?
	 * (applies to AMD modules).
	 */
	this.isExportedPropertyReturnedFromFunction = function(exportedProperty) {

		return this.definedFunctions.some(defFunc => {

			return defFunc.returnedElementDeclaration === exportedProperty;

		}) === true;
	}

	/**
	 * Applies to AMD modules.
	 */
	this.mapExportedDefinitionToReturnStatement = function(exportedDef) {

		if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === false) {

			return null;
		}

		// console.log(this.fileName)
		// console.log(exportedDef)
		let defFuncsReturningExportedProp = this.definedFunctions.filter(defFunc => {

			// console.log(defFunc.functionNode.value.loc)
			// console.log(defFunc.returnedElementDeclaration)
			return defFunc.returnedElementDeclaration === exportedDef;

		});

		// console.log(defFuncsReturningExportedProp.length)
		if(defFuncsReturningExportedProp.length === 0) {

			return null;
		}

		return defFuncsReturningExportedProp[0].returnStatementNode.value;
	};
	
	//properties of global object: properties assigned to
	//window (client-side js) or global (server-side js)
	this.globalObjectProperties = [];
	this.updateGlobalObjectProperties = function(globalObjectProperties) {
		
		this.globalObjectProperties = globalObjectProperties;
	}

	//code segments representing usages of global properties
	this.globalPropertyUsages = [];
	this.updateGlobalPropertyUsages = function(globalPropertyUsages) {

		this.globalPropertyUsages = globalPropertyUsages;
	};
	
	//nodes representing usages of globals
	this.usedGlobalIdentifiers = [];
	this.updateUsedGlobalIdentifiers = function(usedGlobalIdentifiers) {
		
		this.usedGlobalIdentifiers = usedGlobalIdentifiers;
	};
	
	this.retrieveUsedGlobalIdentifiersByName = function(identifierName) {
		
		var usedGlobalIdentifiers = [];
		
		this.usedGlobalIdentifiers.forEach(function(usedGlobalIdentifier) {
			
			if(usedGlobalIdentifier.value.name === identifierName) {
				
				usedGlobalIdentifiers.push(usedGlobalIdentifier);
			}
		});
		
		return usedGlobalIdentifiers;
	}

	this.importStatements = [];
	this.updateImportStatements = function(importStatements) {

		this.importStatements = importStatements;
	};

	//importedElements: list of the imported elements (variables, functions, namespaces, modules) of sourceFile
	//list that keeps the sequential call of the call sites of require()
	this.importedElements = [];
	this.updateImportedElements = function(importedElements) {

		importedElements.forEach(importedElement => {

			if(this.importedElements.some(importedEl => {

				return importedEl.elementName === importedElement.elementName &&
						importedEl.declaredSource === importedElement.declaredSource;
						
			}) === false) {

				this.importedElements.push(importedElement);
			}
		});

	};

	/**
	 * Updates the file's imported definitions with the
	 * fact that they are referenced as objects outside member expressions
	 * so as not to be destructured after the refactoring.
	 */
	this.updateObjectReferencedImportedDefinitions = function() {

		// console.log(this.fileName)
		let importedDefinitions = this.importedElements.filter(importedEl => {

			// console.log(this.fileName)
			// console.log(importedEl)
			return importedEl instanceof ImportedModule.ImportedModule === false &&
					importedEl.declaredSource != undefined &&
					importedEl.declaredSource.startsWith('.') === true;
		});

		importedDefinitions.forEach(importedDef => {

			// console.log(this.fileName + ' ' + importedDef.elementName)
			let usageSet = importedDef.elementUsages;
			let elementRefsOutsideMemberExpressions = usageSet.filter(elemRef => {

				let surrStmts = jscodeshift(elemRef).closest(jscodeshift.Statement);

				if(surrStmts.length === 0) {

					return false;
				}

				//references of importedElement inside export statements 
				//(assignments in CommonJS, returns in AMD) are not considered
				let surrStmt = surrStmts.at(0).get();

				if(surrStmt.value.type === 'ReturnStatement') {

					return false;
				}

				let surrStmtAST = jscodeshift(surrStmt);

				let exportObjRefs = surrStmtAST.find(jscodeshift.Identifier).filter(id => {

					return id.value.name === 'exports';
				});

				if(exportObjRefs.length > 0) {

					return false;
				}

				exportObjRefs = surrStmtAST.find(jscodeshift.MemberExpression).filter(mb => {

					return mb.value.object.type === 'Identifier' && mb.value.object.name === 'module' &&
							mb.value.property.type === 'Identifier' && mb.value.property.name === 'exports';
				});

				if(exportObjRefs.length > 0) {

					return false;
				}

				if(elemRef.parentPath.value.type === 'MemberExpression' &&
					elemRef.parentPath.value.computed === true) {

					//use contained in a member expression with bracket notation
					return true;
				}

				//importedDef not actually used
				if(elemRef.parentPath.value.type === 'MemberExpression' &&
					(elemRef.parentPath.value.object.type !== 'Identifier' ||
					 elemRef.parentPath.value.object.name !== importedDef.aliasName)) {

						return false;
				}

				if(elemRef.parentPath.value.type === 'Property' &&
					elemRef.parentPath.value.key === elemRef.value) {

					return false;
				}

				//importedDef iterated through the in operator
				let binaryExps = surrStmtAST.find(jscodeshift.BinaryExpression).filter(binaryExp => {

					// console.log(binaryExp)
					return binaryExp.value.operator === 'in' &&
							binaryExp.value.right.type === 'Identifier' &&
							binaryExp.value.right.name === importedDef.elementName;
				});

				if(binaryExps.length > 0) {

					return true;
				}

				//elemRef is invoked, but the result is used in a member expression
				if(elemRef.parentPath.value.type === 'CallExpression' &&
					elemRef.parentPath.value.callee === elemRef.value &&
					elemRef.parentPath.parentPath.value.type === 'MemberExpression') {

					return true;
				}

				// console.log(elemRef.value.loc);
				return elemRef.parentPath.value.type !== 'MemberExpression' &&
						elemRef.parentPath.value.type !== 'CallExpression' &&
						elemRef.parentPath.value.type !== 'NewExpression';
			});

			// console.log(elementRefsOutsideMemberExpressions.length);

			if(importedDef instanceof ImportedElement.ImportedElement === true) {

				let moduleDefinition = importedDef.moduleDefinition;
				let definitionProps = moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true ? moduleDefinition.functionProperties : moduleDefinition.objectProperties; 

				if(definitionProps.length > 0 && elementRefsOutsideMemberExpressions.length > 0) {

					moduleDefinition.updateIsObjectReferenced(true);
				}

				return;
			}

			//imported namespace mapped to 1..n exported definitions
			//if it is referenced outside member expressions, do not destructure
			//the mapped definitions
			if(importedDef instanceof ImportedNamespace.ImportedNamespace === true &&
				elementRefsOutsideMemberExpressions.length > 0) {

				let moduleDefinitions = importedDef.moduleDefinitions;
				moduleDefinitions.exportedVariables.forEach(exportedVar => {

					exportedVar.updateIsObjectReferenced(true);
				});

				moduleDefinitions.exportedFunctions.forEach(exportedFunc => {

					exportedFunc.updateIsObjectReferenced(true);
				});

				moduleDefinitions.exportedProperties.forEach(exportedProp => {

					exportedProp.updateIsObjectReferenced(true);
				});

			}

		});
	};

	/**
	 * For each imported element (variable/function, namespace) determines
	 * whether it's assigned/bound to an exported definition/the export object of sourceFile.
	 * Needed to determine whether these elements are going to be imported after
	 * the refactoring, regardless of their usage.
	 * Functionality moved in this class, since determining whether an imported element
	 * is assigned/bound to an exported definition is depended on the sourceFile's
	 * exported definitions.
	 */
	this.updateImportedElementsBoundOrAssignedToExportedDefinitions = function() {

		// console.log(this.fileName);

		//not a CommonJS module - do not proceed
		if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {
			
			return;
		}

		//the sourceFile's imported definitions
		//exclude imported modules from processing (they are not assigned anywhere,
		//since they are imported for their side-effects)
		let importedDefs = this.importedElements.filter(importedEl => {

			return importedEl instanceof ImportedModule.ImportedModule !== true;
		});

		//the sourceFile's exported definitions
		let exportedVariables = this.explicitGlobals.filter(exportedVar => {

			return exportedVar.isExported === true;
		});

		let exportedFunctions = this.definedFunctions.filter(definedFunction => {

			return definedFunction.isExported ===  true;
		});

		//for each imported element, retrieve the statement (expression statement
		//assignment expression) including each of its imported element nodes
		//(each element might be imported multiple times in a modules (e.g. 
		//when it is imported in nested scopes))
		importedDefs.forEach(importedDef => {

			// console.log(importedDef);

			let importedElementBoundOrAssignedToExportedDef = false;
			let importedElementNodes = importedDef.importedElementNodes;
			let elementUsages = importedDef.elementUsages;

			//is imported definition (result of require()) assigned/bound to the sourceFile's
			//exported definition?
			//exports.<property_name> = require() || module.exports.<property_name> = require() ||
			//[variable] = exports = require() || [variable] = module.exports = require()
			for(let nodeIndex = 0; nodeIndex < importedElementNodes.length; nodeIndex++) {

				let importedElementNode = importedElementNodes[nodeIndex];
				let parentNode = importedElementNode;
				let importLocatedWithinExpressionStmtOrVariableDef = false;

				while(parentNode !== null &&
					  importLocatedWithinExpressionStmtOrVariableDef === false) {

					if(parentNode.value.type === 'ExpressionStatement' ||
					   parentNode.value.type === 'VariableDeclaration') {

						importLocatedWithinExpressionStmtOrVariableDef = true;
						break;
					}

					parentNode = parentNode.parentPath;
				}

				//statement not contained in an expression statement or a variable declaration
				//proceed to the next import statement with respect to the specific element
				if(importLocatedWithinExpressionStmtOrVariableDef === false) {

					continue;
				}

				//statement contained in an expression statement or a variable declaration-
				//it might be assigned/bound either to (a) an exported definition (variable)
				//or (b) the export object or an exported definition's reference

				//(a) import contained in a variable definition
				//is this variable exported?
				if(parentNode.value.type === 'VariableDeclaration') {

					//import located within a variable declaration
					//retrieve variable by its declaration node
					//and check if it is exported from sourceFile
					let explicitGlobal = this.retrieveExplicitGlobalByNode(parentNode);

					//a module variable defined in sourceFile with the statement specified by parentNode
					//is found and it is exported- imported definition is assigned to an exported definition
					if(explicitGlobal !== null && explicitGlobal.isExported === true) {

						explicitGlobal.updateHasBoundPropertiesInitializedWithImportDefs(true);
						importedElementBoundOrAssignedToExportedDef = true;
						break;
					}

				}

				//(b) import contained in an expression statement
				//does this expression contain a reference of an exported variable
				//or the export object?
				if(parentNode.value.type === 'ExpressionStatement') {

					let parentNodeAST = jscodeshift(parentNode);

					//does expression statement contain at least one reference
					//of an exported variable of sourceFile?
					let referencedDefs = exportedVariables.filter(exportedVar => {

						//locate exportedVar references inside export statement
						let varRefs = parentNodeAST.find(jscodeshift.Identifier).filter(id => {

							return id.value.name === exportedVar.variableName;
						});

						if(varRefs.length > 0) {

							return true;
						}

						return false;
					});

					//expression statement contains references of at least 1 exported definition of sourceFile
					if(referencedDefs.length > 0) {

						referencedDefs.forEach(referencedDef => {

							referencedDef.updateHasBoundPropertiesInitializedWithImportDefs(true);
						});
						
						importedElementBoundOrAssignedToExportedDef = true;
						break;
					}

					referencedDefs = exportedFunctions.filter(exportedFunc => {

						//locate exportedVar references inside export statement
						let functionRefs = parentNodeAST.find(jscodeshift.Identifier).filter(id => {

							return id.value.name === exportedFunc.functionName;
						});

						if(functionRefs.length > 0) {

							return true;
						}

						return false;
					});

					//expression statement contains references of at least 1 exported definition of sourceFile
					if(referencedDefs.length > 0) {

						referencedDefs.forEach(referencedDef => {

							referencedDef.updateHasBoundPropertiesInitializedWithImportDefs(true);
						});

						importedElementBoundOrAssignedToExportedDef = true;
						break;
					}

					//does expression statement contain at least one reference
					//of the export object (exports/module.exports)?
					let exportObjRefs = parentNodeAST.find(jscodeshift.Identifier).filter(id => {

						return id.value.name === 'exports';
					});

					//expression statement contains references of the export object (exports)
					if(exportObjRefs.length > 0) {

						//retrieve the sourceFile's exported definition
						exportedVariables.forEach(exportedVar => {

							exportedVar.updateHasBoundPropertiesInitializedWithImportDefs(true);
						});

						exportedFunctions.forEach(exportedFunc => {

							exportedFunc.updateHasBoundPropertiesInitializedWithImportDefs(true);
						});

						importedElementBoundOrAssignedToExportedDef = true;
						break;
					}
				}
			}

			if(importedElementBoundOrAssignedToExportedDef === true) {

				importedDef.updateIsBountToExportedDefinition(importedElementBoundOrAssignedToExportedDef);
				return;
			}

			//is imported definition's value bound/assigned to an exported definition?
			//exports.<property_name> = <imp_def> || module.exports.<property_name> = <imp_def> ||
			//[variable] = exports = <imp_def> || [variable] = module.exports = <imp_def>
			for(let varIndex = 0; varIndex < exportedVariables.length; varIndex++) {

				let exportedVar = exportedVariables[varIndex];

				//is a property of exportedVar initialized with imported definition?
				let objectPropertiesInitializedWithDef = exportedVar.objectProperties.filter(objectProp => {

					let propInValue = objectProp.propertyDefinitionNode.value != null ?
										objectProp.propertyDefinitionNode.value :
										objectProp.propertyDefinitionNode;
					
					return propInValue.type === 'Identifier' && propInValue.name === importedDef.aliasName;
				});

				if(objectPropertiesInitializedWithDef.length > 0) {

					exportedVar.updateHasBoundPropertiesInitializedWithImportDefs(true);
					importedDef.updateIsBountToExportedDefinition(true);

					return;
				}
			}

			for(let funcIndex = 0; funcIndex < exportedFunctions.length; funcIndex++) {

				let exportedFunc = exportedFunctions[funcIndex];
				let functionPropertiesInitializedWithDef = exportedFunc.functionProperties.filter(funcProp => {

					// console.log(funcProp.propertyValue)
					return funcProp.propertyValue != null && 
							funcProp.propertyValue.type === 'Identifier' && 
							funcProp.propertyValue.name === importedDef.aliasName;
				});

				// console.log(functionPropertiesInitializedWithDef.length)

				if(functionPropertiesInitializedWithDef.length > 0) {

					exportedFunc.updateHasBoundPropertiesInitializedWithImportDefs(true);
					importedDef.updateIsBountToExportedDefinition(true);

					return;
				}
			}

			// importedDef.updateIsBountToExportedDefinition(importedElementBoundOrAssignedToExportedDef);
		});
	};
	
	//imported variables of file
	this.importedVariables = [];
	this.updateImportedVariables = function(importedVariables) {
		
		// this.importedVariables = importedVariables;
		// this.importedVariables = this.importedVariables.concat(importedVariables);

		//add each imported variable to array once
		var that = this;
		importedVariables.forEach(function(importedVariable) {

			that.addImportedVariable(importedVariable);
		});
	};

	//the implied globals that are visible in module
	this.usedImpliedGlobals = [];
	this.updateUsedImpliedGlobals = function(usedImpliedGlobals) {

		this.usedImpliedGlobals = usedImpliedGlobals;
	};

	/**
	 * Used for AMD modules.
	 */
	this.addImportedDefinition = function(importedDefinition) {

		// console.log(this.fileName + ' ' + importedDefinition.elementName);
		// console.log(importedDefinition);
		if(importedDefinition.moduleDefinition != null &&
			importedDefinition.moduleDefinition instanceof Variable.Variable === true) {

			this.addImportedVariable(importedDefinition);
			this.importedElements.push(importedDefinition);
			return;
		}

		if(importedDefinition.moduleDefinition != null &&
			importedDefinition.moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

			this.addImportedFunction(importedDefinition);
			this.importedElements.push(importedDefinition);
			return;
		}

		if(importedDefinition.moduleDefinitions != null &&
			this.retrieveImportedNamespace(importedDefinition) === null) {

			this.importedNamespaces.push(importedDefinition);
			this.importedElements.push(importedDefinition);
			return;
		}

		//add imported module (prevent duplicates)
		if(this.importedModules.some(currMod => 
			currMod.compare(importedDefinition) === true) === false) {

			this.importedModules.push(importedDefinition);
			this.importedElements.push(importedDefinition);
		}
	};

	this.addImportedVariable = function(importedVariable) {

		let modulePath = path.resolve(path.dirname(this.fileName) + path.sep + importedVariable.declaredSource);
		if(this.fileName === modulePath) {

			return;
		}

		var currentVariable;
		for(var variableIndex = 0; variableIndex < this.importedVariables.length; variableIndex++) {

			currentVariable = this.importedVariables[variableIndex];
			if(currentVariable.elementName === importedVariable.elementName &&
				currentVariable.definitionModuleName === importedVariable.definitionModuleName) {

					return;
			}
		}

		//introduce importedVariable once
		this.importedVariables.push(importedVariable);
	};
	
	//imported functions of file
	this.importedFunctions = [];
	this.updateImportedFunctions = function(importedFunctions) {
		
		// this.importedFunctions = importedFunctions;
		// this.importedFunctions = this.importedFunctions.concat(importedFunctions);

		var that = this;

		//add each imported function to array once
		importedFunctions.forEach(function(importedFunction) {

			that.addImportedFunction(importedFunction);
		});
	};

	this.addImportedFunction = function(importedFunction) {

		let modulePath = path.resolve(path.dirname(this.fileName) + path.sep + importedFunction.declaredSource);
		if(this.fileName === modulePath) {

			return;
		}

		var currentFunction;
		for(var functionIndex = 0; functionIndex < this.importedFunctions.length; functionIndex++) {

			currentFunction = this.importedFunctions[functionIndex];
			if(currentFunction.elementName === importedFunction.elementName &&
			   currentFunction.definitionModuleName === importedFunction.definitionModuleName) {

					return;
			}
		}

		//introduce importedFunction once
		this.importedFunctions.push(importedFunction);
	};

	//namespaceImports: statements representing imports of module objects
	//(syntax: var <variableName> = require(<modulePath))
	this.importedNamespaces = [];
	this.updateImportedNamespaces = function(importedNamespaces) {

		// console.log(importedNamespaces);
		this.importedNamespaces = importedNamespaces;
	};

	this.retrieveImportedNamespace = function(namespaceName, importedSource) {

		for(let namespaceIndex = 0; namespaceIndex < this.importedNamespaces.length; namespaceIndex++) {

			let currentNamespace = this.importedNamespaces[namespaceIndex];
			if(currentNamespace.elementName === namespaceName &&
			   currentNamespace.declaredSource === importedSource) {

				return currentNamespace;
			}
		}

		return null;
	};

	//module imports: statements representing imports of modules that do not export anything (i.e. IIFEs)
	//(used in order to introduce AST nodes representing ES6 import statatements of type: import <moduleName>
	//[import a module for side-effects only])
	this.importedModules = [];
	this.updateImportedModules = function(importedModules) {

		this.importedModules = importedModules;
	};

	this.importedClasses = [];
	this.updateImportedClasses = function(importedClasses) {

		importedClasses.forEach(function(importedClass) {

			var currentClass;
			for(var classIndex = 0; classIndex < this.importedClasses.length; classIndex++) {

				currentClass = this.importedClasses[classIndex];
				if(currentClass.elementName === importedClass.elementName &&
				   currentClass.definitionModuleName === importedClass.definitionModuleName) {

						return;
				}
			}

			//introduce importedClass once
			this.importedClasses.push(importedClass);
		});

	};

	//assignments of module.exports/exports to variables (or vice versa)
	//useful for distinguishing modules where properties bound to exports/module.exports are part of 
	//a feature assigned the module object (and thus properties might be exported through this feature)
	//or these properties are standalone properties of the module object (and thus might be exported themselves)
	//applies to CJS
	this.statementsReferencingExportObject = null;
	this.updateStatementsReferencingExportObject = function(statementsReferencingExportObject) {

		this.statementsReferencingExportObject = statementsReferencingExportObject;
	};

	this.assignmentsToExportObjectBindings = [];
	this.updateAssignmentsToExportObjectBindings = function(assignmentsToExportObjectBindings) {

		this.assignmentsToExportObjectBindings = assignmentsToExportObjectBindings;
	};

	/**
	 * Retrieves top-level scope functions.
	 */
	this.retrieveTopLevelScopeFunctions = function() {

		return this.definedFunctions.filter(defFunc => {

			// console.log(defFunc.functionNode);
			return defFunc.functionScope === null && 
					defFunc.functionName !== 'topLevelScope' &&
					defFunc.functionNode.parentPath.value.type !== 'Property';
		});
	};
	
	this.retrieveTopLevelScopeFunctionByName = function(functionName) {
		
		// var definedFunctions = this.definedFunctions;
		// var functionParentNode;
		// for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
		// 	var definedFunction = definedFunctions[functionIndex];
		// 	functionParentNode = definedFunction.functionNode.parentPath;
		// 	// console.log(definedFunction.functionName);
		// 	// console.log(definedFunction.functionNode.value.loc);

		// 	// functionParentNode = definedFunction.functionNode.parentPath;
		// 	if(definedFunction.functionScope === null &&
		// 	   definedFunction.functionName === functionName &&
		// 	   functionParentNode.value.type !== 'Property') {
				
		// 		return definedFunction;
		// 	}
		// }
		
		// return null;

		return this.retrieveTopLevelScopeFunctions().find(topLevelFunc => {

			return topLevelFunc.functionName === functionName;
		});
	};

	this.retrieveDefinedFunctionByName = function(functionName) {
		
		var definedFunctions = this.definedFunctions;
		for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
			var definedFunction = definedFunctions[functionIndex];
			if(definedFunction.functionName === functionName) {
				
				return definedFunction;
			}
		}
		
		return null;
	};
	
	this.retrieveDefinedFunctionByNode = function(functionNode) {
		
		//refactor to use find(), instead of processing all functions with filter()
		let defFunc = this.definedFunctions.find(definedFunction => {

			return definedFunction.functionNode.value === functionNode;
		});

		return (defFunc !== undefined ? defFunc : null);
	};
	
	this.printSourceFileInfoToFile = function() {
		
		var fileNameTokens = this.fileName.split('\\');
		var infoFileName = fileNameTokens[fileNameTokens.length-1];
		
		var jsonData = {};
		jsonData["fileName"] = this.fileName;
		jsonData["sourceVersion"] = this.sourceVersion;
		jsonData["moduleFramework"] = this.moduleFramework;
		jsonData["usedGlobalIdentifiers"] = this.usedGlobalIdentifiers;
		jsonData["definedFunctions"] = this.definedFunctions;
		jsonData["explicitGlobals"] = this.explicitGlobals;
		jsonData["importedFunctions"] = this.importedFunctions;
		jsonData["importedVariables"] = this.importedVariables;
		
		fs.writeFileSync('./resultFiles/' + infoFileName + "_info.json", circularJson.stringify(jsonData, null, 4), function(err) {
			
			if(err) {
				
				throw err;
			}
		});
		
	};
	
	this.retrieveExportedFunctions = function() {
		
		return this.definedFunctions.filter(definedFunction => {

			return definedFunction.isExported === true;
		});
	};
	
	this.retrieveExportedVariables = function() {

		return this.explicitGlobals.filter(explicitGlobal => {

			// console.log('e: ' + explicitGlobal.variableName + ' ' + explicitGlobal.isObjectReferenced);
			return explicitGlobal.isExported === true;
		});
	};

	this.retrieveExportedVariableByName = function(variableName) {

		var explicitGlobal;
		var variableIndex;
		for(variableIndex = 0; variableIndex < this.explicitGlobals.length; variableIndex++) {

			explicitGlobal = this.explicitGlobals[variableIndex];
			if(explicitGlobal.isExported === true && explicitGlobal.variableName === variableName) {

				return explicitGlobal;
			}
		}

		return null;
	}

	/**
	 * Checks if exported element of exportedElementNodeValue is exported via module.exports
	 * (Determines the type of the import statement that will be introduced in the AST in the transformation phase.)
	 */
	this.isElementExportedViaModuleExports = function(exportedElementNodeValue) {

		// console.log(exportedElementNodeValue);

		var leftOperand;
		var leftOperandType;

		var rightOperand;
		var rightOperandType;

		//exportedElementNodeValue is the AST node representing the commonJS export statement of element
		if(exportedElementNodeValue !== null && exportedElementNodeValue.type === 'AssignmentExpression') {

			leftOperand = exportedElementNodeValue.left;
			leftOperandType = leftOperand.type;
			if(leftOperandType === 'MemberExpression' && leftOperand.object.name === 'module' && leftOperand.property.name === 'exports') {

				//left operand of AssignmentExpression is the MemberExpression statement 'module.exports'
				//exportedElementNodeValue syntax: module.exports = <identifier>
				//element is exported via module.exports
				return true;
			}
		}

		return false;
	}

	
	//helper functions for json data
	this.retrieveExportedVariableObject = function(variableName) {
		
		var exportedGlobalObject = {};
		for(var globalIndex = 0; globalIndex < this.explicitGlobals.length; globalIndex++) {
			
			var explicitGlobal = this.explicitGlobals[globalIndex];
			if(explicitGlobal.isExported === true &&
			   explicitGlobal.variableName === variableName) {
						
				var exportedElementNode = explicitGlobal.exportedVariableNode;
				var exportedElementNodeValue;
				if(exportedElementNode !== null && exportedElementNode.value !== undefined) {
							
					exportedElementNodeValue = exportedElementNode.value;
				}
				else {
					exportedElementNodeValue = exportedElementNode;
				}
				exportedGlobalObject = {
							
						"variableName" : explicitGlobal.variableName,
						"initializationValueNode": explicitGlobal.initializationValueNode,
						"exportedVariableNode": exportedElementNodeValue,
						"variableDeclarationNode": explicitGlobal.variableDeclarationNode.value,
						"isObjectReferenced": explicitGlobal.isObjectReferenced,
						"isImportedAndReexported": explicitGlobal.isImportedAndReexported
				};
				
				return exportedGlobalObject;
			}
		}
		
		return null;
		
	};
	
	this.retrieveExportedFunctionObject = function(functionName, functionNode) {
		
		var exportedFunctionObject = {};
		// console.log(functionName);
		for(var functionIndex = 0; functionIndex < this.definedFunctions.length; functionIndex++) {
			
			var definedFunction = this.definedFunctions[functionIndex];
			if(definedFunction.isExported === true &&
			   definedFunction.functionName === functionName &&
			   definedFunction.functionNode.value === functionNode) {
				
				var exportedElementNode = definedFunction.exportedFunctionNode;
				// console.log(definedFunction.functionName);
				// console.log(definedFunction.functionNode.value.loc);
				// console.log(exportedElementNode);
				var exportedElementNodeValue;
				if(exportedElementNode !== null && exportedElementNode.value !== undefined) {
					
					exportedElementNodeValue = exportedElementNode.value;
				}
				else {
					exportedElementNodeValue = exportedElementNode;
				}
				
//				console.log(exportedElementNodeValue);
				// console.log(definedFunction.functionProperties);

				let functionProperties = definedFunction.functionProperties.map(functionProperty => {

					let propertyValue = functionProperty.propertyDefinitionNode.value === undefined ? functionProperty.propertyDefinitionNode : functionProperty.propertyDefinitionNode.value;
					return {

						propertyName: functionProperty.propertyName,
						propertyType: functionProperty.propertyType,
						propertyValue: propertyValue,
						propertyDefinitionNode: propertyValue,
						isExported: functionProperty.isExported,
						propertyReferences: functionProperty.functionPropertyUsages

					};
				})
				exportedFunctionObject = {
						
						"functionName": definedFunction.functionName,
						"functionNode": definedFunction.functionNode.value,
						"exportedFunctionNode": exportedElementNodeValue, 
						"functionProperties": functionProperties,
						"isFunctionConstructor": definedFunction.isConstructor,
						"isObjectReferenced": definedFunction.isObjectReferenced,
						"isImportedAndReexported": definedFunction.isImportedAndReexported
				};
				
				return exportedFunctionObject;
			}
		}
		
		return null;
		
	};

	this.retrieveExportedPropertyByName = function(propertyName) {

		// console.log(this.exportedProperties);
		let properties = this.exportedProperties.filter(exportedProp => {

			return exportedProp.exportedPropertyName === propertyName;
		});

		if(properties.length === 0) {

			return null;
		}

		return properties[0];
	};

	this.retrieveExportedPropertyObject = function(propertyName) {

		var exportedPropertyObject = {};
		for(var propertyIndex = 0; propertyIndex < this.exportedProperties.length; propertyIndex++) {

			var exportedProperty = this.exportedProperties[propertyIndex];
			// console.log(this.fileName + " " + exportedProperty.propertyName);
			if(exportedProperty.exportedPropertyName === propertyName) {

				var exportedElementNode = exportedProperty.exportStatementASTNode;
				var exportedElementNodeValue;
				if(exportedElementNode !== null && exportedElementNode.value !== undefined) {
					
					exportedElementNodeValue = exportedElementNode.value;
				}
				else {
					exportedElementNodeValue = exportedElementNode;
				}

				exportedPropertyObject = {
						
					"propertyName": exportedProperty.exportedPropertyName,
					"propertyNode": exportedProperty.exportedPropertyASTNode,
					"exportStatementNode": exportedElementNodeValue,
					"isPropertyExportedThroughModuleExports": exportedProperty.propertyExportedThroughModuleExports
				};

				return exportedPropertyObject;
			}
		}

		return null;
	};
	
	//retrieve exported element of sourceFile (case: element exported via module.exports)
	this.retrieveExportedGlobal = function() {
		
		var explicitGlobals = this.explicitGlobals;
		for(var globalIndex = 0; globalIndex < explicitGlobals.length; globalIndex++) {
			
			var explicitGlobal = explicitGlobals[globalIndex];
			if(explicitGlobal.isExported === true) {
				
				return explicitGlobal;
			}
		}
		
		return null;
	};
	
	this.retrieveExportedFunction = function() {
		
		var definedFunctions = this.definedFunctions;
		for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
			var definedFunction = definedFunctions[functionIndex];
			if(definedFunction.isExported === true) {
				
				return definedFunction;
			}
		}
		
		return null;
	};

	this.retrieveExportedFunctionByName = function(functionName) {
		
		var definedFunctions = this.definedFunctions;
		for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
			var definedFunction = definedFunctions[functionIndex];
			// console.log(definedFunction);
			if(definedFunction.isExported === true &&
			   definedFunction.functionName === functionName) {
				
				return definedFunction;
			}
		}
		
		return null;
	};
	
	this.retrieveExplicitGlobal = function(variableName) {
		
		var explicitGlobals = this.explicitGlobals;
		for(var globalIndex = 0; globalIndex < explicitGlobals.length; globalIndex++) {
			
			var explicitGlobal = explicitGlobals[globalIndex];
			// console.log(explicitGlobal);
			if(explicitGlobal.variableName === variableName) {
				
				return explicitGlobal;
			}
		}
		
		return null;
	};

	/**
	 * Retrieves the sourceFile's module feature defining a property.
	 * @param {*} propertyName the property's name
	 */
	this.retrieveModuleFeatureDefiningProperty = function(propertyName) {

		let explicitGlobal = this.explicitGlobals.find(expGlob => {

			return expGlob.retrieveObjectPropertyByName(propertyName) != null;
		});

		//module variable with specified property exists - stop
		if(explicitGlobal != null) {

			return explicitGlobal;
		}

		let definedFunction = this.retrieveTopLevelScopeFunctions().find(topLevelFunc => {

			return topLevelFunc.retrieveFunctionPropertyByName(propertyName);
		});

		//module function with specified property exists - stop
		if(definedFunction != null) {

			return definedFunction;
		}

		return null;
	};

	

	this.retrieveExplicitGlobalByNode = function(variableDeclaration) {

		let explicitGlobals = this.explicitGlobals.filter(explicitGlobal => {

			return explicitGlobal.variableDeclarationNode === variableDeclaration;
		});

		return (explicitGlobals.length === 0 ? null : explicitGlobals[0]);
	};

	this.retrieveTopLevelScopeDefinedClassByName = function(className) {

		var classDefinitionIndex;
		var definedClass;

		for(classDefinitionIndex = 0; classDefinitionIndex < this.definedClasses.length; classDefinitionIndex++) {

			definedClass = this.definedClasses[classDefinitionIndex];
			if(definedClass.enclosingScope === null && definedClass.className === className) {

				return definedClass;
			}
		}

		return null;
	};

	/**
	 * Retrieves the global variable that is exported as aliasName.
	 * Needed in cases when the result of a call to require() is assigned to the properties of an object.
	 */
	this.retrieveExplicitGlobalExportedWithAlias = function(aliasName) {

		var explicitGlobals = this.explicitGlobals;
		for(var globalIndex = 0; globalIndex < explicitGlobals.length; globalIndex++) {
			
			var explicitGlobal = explicitGlobals[globalIndex];
			if(explicitGlobal.isExported === true) {
				
				//explicitGlobal is exported
				//retrieve the AST node representing the export statement
				//(syntax: exports.<identifier> = <identifier>)
				var exportedVariableNode = explicitGlobal.exportedVariableNode;
				// console.log(exportedVariableNode);

				if(exportedVariableNode.type === 'AssignmentExpression') {

					var leftOperand = exportedVariableNode.left;
					if(leftOperand.type === 'MemberExpression') {

						var accessedProperty = leftOperand.property.name;

						//explicitGlobal's export alias is aliasName - return explicitGlobal
						if(accessedProperty === aliasName) {

							return explicitGlobal;
						}
					}
				}
			}
		}
		
		return null;
	}

	/**
	 * Retrieves the function that is exported as aliasName.
	 * Needed in cases when the result of a call to require() is assigned to the properties of an object.
	 */
	this.retrieveDefinedFunctionExportedWithAlias = function(aliasName) {

		var definedFunctions = this.definedFunctions;
		for(var functionIndex = 0; functionIndex < definedFunctions.length; functionIndex++) {
			
			var definedFunction = definedFunctions[functionIndex];
			if(definedFunction.isExported === true) {
				
				//definedFunction is exported
				//retrieve the AST node representing the export statement
				//(syntax: exports.<identifier> = <identifier>)
				var exportedFunctionNode = definedFunction.exportedFunctionNode;
				// console.log(exportedFunctionNode);

				if(exportedFunctionNode.type === 'AssignmentExpression') {

					var leftOperand = exportedFunctionNode.left;
					if(leftOperand.type === 'MemberExpression') {

						var accessedProperty = leftOperand.property.name;

						//definedFunction's export alias is aliasName - return definedFunction
						if(accessedProperty === aliasName) {

							return definedFunction;
						}
					}
				}
			}
		}
		
		return null;
	};
	
	this.moduleDependencyList = [];
	this.updateModuleDependencyList = function(moduleDependencyList) {
		
//		this.moduleDependencyList = moduleDependencyList;

		// console.log(this.fileName);

		console.log(`Updating dependency list of ${this.fileName}.`);
		
		//update this.moduleDependencyList iteratively (prevent export dependency overwriting)
		moduleDependencyList.forEach(moduleDependency => {

			if(moduleDependency.type === 'import') {

				let dependencyType = moduleDependency.dependency.edgeType;
				let accessedElement = moduleDependency.dependency.accessedElement;
				let existingMD = this.moduleDependencyList.find(md => {

					// console.log(md);

					return md.type === moduleDependency.type && 
						   md.dependency !== undefined &&
						   md.dependency.edgeType === dependencyType && 
						   md.dependency.accessedElement.compare(accessedElement) === true;
				});

				// console.log(accessedElement.elementName + ' ' + existingMD);

				if(existingMD == null) {

					this.moduleDependencyList.push(moduleDependency);
				}

				return;
			}

			// if(moduleDependency.type === 'export' && this.moduleDependencyList.indexOf(moduleDependency) === -1) {

			// 	this.moduleDependencyList.push(moduleDependency);
			// }

			if(moduleDependency.type === 'export') {

				// this.moduleDependencyList.push(moduleDependency);
				this.addExportDependencyToModuleDependencyList(moduleDependency);
			}

			if(moduleDependency.type === 'replace') {

				this.moduleDependencyList.push(moduleDependency);
			}
		});

		this.resolveNameConflictingDeps();
	};

	/**
	 * Resolves name conflicts occuring in the module dependencies
	 * of the file.
	 */
	this.resolveNameConflictingDeps = function() {

		//after this.moduleDependencyList is updated,
		//check for name collisions w.r.t. the sourceFile's exported features 
		//(recall that export deps are not linked to the actual feature due to moduleDependency
		//and thus import deps -which are linked to the actual feature-
		//are not updated)
		// this.resolveNameConflictingExportModuleDeps();

		//after this.moduleDependencyList is updated,
		//check for name collisions w.r.t. the sourceFile's imported features
		this.resolveNameConflictingImportModuleDeps();
	};

	/**
	 * Resolves name conflicts occuring in the module dependencies (imports)
	 * of the file. Applied in imported features (not in objects with properties).
	 * In case of name conflicts, CHANGES names.
	 */
	this.resolveNameConflictingImportModuleDeps = function() {

		console.log(`Resolving name collisions in imported features of ${this.fileName}.`);
		let importDeps = this.moduleDependencyList.filter(md => {

			return md.type === 'import' && md.dependency.edgeType !== 'ModuleImport';
		});

		//import dependency objects contain functionProperties (for functions)
		//and objectProperties (for variables/objects)
		importDeps.forEach(importDep => {

			//importDep: {type: String, dependency: MDGEdge, importFileModuleFrameWork: String[]}

			// console.log(importDep);

			//ImportedElement | ImportedNamespace | GlobalObjectProperty
			let accessedElement = importDep.dependency.accessedElement;
			let elObjProps = accessedElement.objectProperties;
			let accElName = accessedElement.elementName;
			let accElDecSource = accessedElement.declaredSource;

			// console.log(accessedElement);
			
			// console.log(`accElName: ${accElName}`);

			/**
			 * Name conflicts happen when the imported feature is named with:
			 *  (a) a reserved word (check this at first, in order to cut off proceeding to bigger queries)
				(b) a sourceFile's (the file importing the feature) module feature's (module feature object shared property's) name
				(c) another imported feature's (property's) name
			   Updated imported feature's alias template: <definition-file>_<feature-name>
			   NOTICE: apply REGARDLESS of whether the whole import statement
			   will be removed (general case) or only the require() invocation will be replaced
			   (e.g. imports in nested scopes, imports nested in invocations)
			*/

			//(a)
			if(reservedWords.isReservedWord(accElName) === true) {

				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with reserved word.`);
				return;
			}

			//(b)
			//retrieve module feature (variable/function)/property/object literal 
			//named after/defining object shared property named accElName
			let modVar = this.retrieveExplicitGlobal(accElName);
			if(modVar != null) {
				
				// accessedElement.aliasName = `${path.basename(accElDecSource, '.js')}_${accElName}`;
				
				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with the variable ${modVar.variableName} (line: ${modVar.variableDeclarationNode.value.loc.start.line}) in the importing module.`);
				return;
			}

			let modFunc = this.retrieveDefinedFunctionByName(accElName);
			if(modFunc != null) {

				// accessedElement.aliasName = `${path.basename(accElDecSource, '.js')}_${accElName}`;
				
				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with the function ${modFunc.functionName} (line: ${modFunc.functionNode.value.loc.start.line}) in the importing module.`);
				return;
			}

			//Variable || FunctionDeclaration
			let modFeat = this.retrieveModuleFeatureDefiningProperty(accElName);
			if(modFeat != null) {

				// accessedElement.aliasName = `${path.basename(accElDecSource, '.js')}_${accElName}`;
				
				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				let confFeatDefLine = modFeat instanceof Variable.Variable === true ? modFeat.variableDeclarationNode.value.loc.start.line : modFeat.functionNode.value.loc.start.line;
				let confFeatName = modFeat instanceof Variable.Variable === true ? modFeat.variableName : modFeat.functionName;
				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with the ${confFeatName} (line: ${confFeatDefLine}) in the importing module.`);
				return;
			}

			//ExportedProperty | ObjectLiteral
			let modExProp = this.retrieveExportedPropertyNamedWithOrDefiningProperty(accElName);
			if(modExProp != null) {

				// accessedElement.aliasName = `${path.basename(accElDecSource, '.js')}_${accElName}`;
				
				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				let confPropName = modExProp instanceof ExportedProperty.ExportedProperty ? modExProp.exportedPropertyName : '';
				let confPropDefLine = modExProp instanceof ExportedProperty.ExportedProperty === true ? (modExProp.exportedPropertyASTNode.value != null ? modExProp.exportedPropertyASTNode.value.loc.start.line : modExProp.exportedPropertyASTNode.loc.start.line) : modExProp.objectExpressionASTNode.value.loc.start.line;
				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with the module object property ${confPropName} (line: ${confPropDefLine}) in the importing module.`);
				return;
			}

			//(c) find the sourceFile's imported features named with/defining object shared properties named accElName
			//(all these features need renaming!)
			let nameConflictingImportDeps = importDeps.filter(impDep => {

				//exclude the imported feature specified in importDep
				if(impDep.dependency.accessedElement.compare(accessedElement) === true) {

					return false;
				}

				// console.log(impDep.dependency);
				// console.log(impDep.dependency.accessedElement)

				//include the imported feature named accElName or
				//the features defining object shared properties named accElName
				//ImportedElement | ImportedNamespace | GlobalObjectProperty | ImpliedGlobalVariable
				if(impDep.dependency.accessedElement instanceof ImpliedGlobalVariable.ImpliedGlobalVariable === false &&
					impDep.dependency.accessedElement.importedFeatureSpecifiesFeature(accElName) === true) {

					return true;
				}
			});

			//if name conflicting import dependencies exist,
			//rename the alias of the imported features under the template: <module-identifier>_<feature-name>
			// if(nameConflictingImportDeps.length === 0) {

			// 	return;
			// }

			if(nameConflictingImportDeps.length > 0) {

				// accessedElement.aliasName = `${path.basename(accElDecSource, '.js')}_${accElName}`;
				
				accessedElement.aliasName = accElDecSource != undefined ? 
											`${path.basename(accElDecSource, '.js')}_${accElName}` :
											accElName;

				console.log(`alias: ${accessedElement.aliasName}. Change due to collision with imported feature from another module.`);
				nameConflictingImportDeps.forEach(nameConfImpDep => {

					let namedConfAccEl = nameConfImpDep.dependency.accessedElement;
					// let confAccElDecSource = namedConfAccEl.declaredSource;
					
					// //TODO: generate name by checking each folder path iteratively 
					// //(instead of processing the relative path at once)
					// namedConfAccEl.aliasName = `${path.basename(confAccElDecSource, '.js').replace(/[^a-zA-Z0-9_ ]/g, '')}_${namedConfAccEl.elementName}`;

					let confAccElDecSource = path.dirname(namedConfAccEl.declaredSource).replace(/[^a-zA-Z0-9_ ]/g, '') + 
										 path.basename(namedConfAccEl.declaredSource).replace(/[^a-zA-Z0-9_ ]/g, '');
					// let confAccElDecSourceArr = confAccElDecSource.replace('.', '').split(path.sep);
					
					//TODO: generate name by checking each folder path iteratively 
					//(instead of processing the relative path at once)
					namedConfAccEl.aliasName = `${confAccElDecSource}_${namedConfAccEl.elementName}`;
					console.log(`property alias: ${namedConfAccEl.aliasName}. Change due to collision with a property of the imported feature.`);
					return;
				});
			}

			//(a)-(c) (for object shared properties)
			// elObjProps.forEach(elObjProp => {

			// 	let propName = elObjProp.propertyName;

			// 	//(a)-(b)
			// 	//import property with its initial name (this is used for its export),
			// 	//but rename its alias to prevent name collisions
			// 	if(reservedWords.isReservedWord(propName) === true ||
			// 		this.retrieveExplicitGlobal(propName) !== null ||
			// 		this.retrieveDefinedFunctionByName(propName) !== null ||
			// 		this.retrieveModuleFeatureDefiningProperty(propName) !== null ||
			// 		this.retrieveExportedPropertyNamedWithOrDefiningProperty(propName) !== null ||
			// 	    this.isObjectPropertyDefinedInSourcefile(propName) === true) {

			// 		elObjProp.propertyAlias = `${path.basename(accElDecSource, '.js')}_${propName}`;
			// 		return;
			// 	}

			// 	//(c)
			// 	//what if other imported features with the same property exist?
			// 	//elObjProp should be renamed (avoid edge cases)
			// 	// let 
			// });
		});
	};

	// /**
	//  * Resolves name conflicts occuring in the module dependencies (exports)
	//  * of the file. Needed for propagating changes in feature names in the file's clients
	//  * (files importing features from the file).
	//  */
	// this.resolveNameConflictingExportModuleDeps = function() {

	// 	console.log(`Resolving name collisions in exported features of ${this.fileName}.`);

	// 	let exportDeps = this.moduleDependencyList.filter(md => {

	// 		return md.type === 'export';
	// 	});

	// 	exportDeps.forEach(expDep => {

	// 		//features are exported under an alias (their actual names)
	// 		if(expDep.dataType === 'variable') {

	// 			let explicitGlobal = this.retrieveExplicitGlobal(expDep.elementAlias);

	// 			if(explicitGlobal == null) {

	// 				return;
	// 			}

	// 			//update the variable's object shared properties
	// 		}
	// 	});
	// };

	this.addEncapsulationAndRedundancyDepsInModuleDependencyList = function() {

		// console.log(this);
		// console.log('s: ' + this.fileName + ' ' + this.moduleDependencyList.length)
		// console.log(this.moduleDependencyList);

		console.log(`Retrieving redundant dependencies in ${this.fileName}.`);

		//update the sourceFile's moduleDependencyList with dependencies for:
		//(a) its exported definitions that are not imported in other modules (encapsulate)
		//(b) its imported definitions that are not used within sourceFile (remove)

		//(a)
		let encapsulatedDefs = this.retrieveEncapsulatedDefs();
		let redundantVars = encapsulatedDefs.redundantVars;
		let redundantFuncs = encapsulatedDefs.redundantFuncs;
		let redundantProps = encapsulatedDefs.redundantProps;

		redundantVars.forEach(redundantVar => {

			// console.log(redundantVar)
			let moduleDep = {};
			moduleDep.type = 'encapsulate';
			moduleDep.dataType = 'variable';
			moduleDep.elementName = redundantVar.variableName;
			moduleDep.elementNode = redundantVar.variableDeclarationNode.value;
			moduleDep.exportNode =  redundantVar.exportedVariableNode == null ? 
									null :
									(redundantVar.exportedVariableNode.value != null ?
									redundantVar.exportedVariableNode.value :
									redundantVar.exportedVariableNode);

			moduleDep.exportedThroughModuleExports = true;

			//not needed (variable keeps its name - no renamings needed)
			moduleDep.elementReferences = [];

			this.moduleDependencyList.push(moduleDep);
		});

		redundantFuncs.forEach(redundantFunc => {

			// console.log(redundantFunc);
			let moduleDep = {};
			moduleDep.type = 'encapsulate';
			moduleDep.dataType = 'function';
			moduleDep.elementName = redundantFunc.functionName;
			moduleDep.elementNode = redundantFunc.functionNode.value;
			moduleDep.exportNode =  redundantFunc.exportedFunctionNode == null ? 
									null :
									(redundantFunc.exportedFunctionNode.value != null ?
									redundantFunc.exportedFunctionNode.value : 
									redundantFunc.exportedFunctionNode);
									
			moduleDep.exportedThroughModuleExports = true;

			//not needed (function keeps its name - no renamings needed)
			moduleDep.elementReferences = [];

			this.moduleDependencyList.push(moduleDep);
		});

		redundantProps.forEach(redundantProp => {

			let moduleDep = {};
			moduleDep.type = 'encapsulate';
			moduleDep.dataType = 'property';
			moduleDep.elementName = redundantProp.exportedPropertyName ? 
									redundantProp.exportedPropertyName : 
									null;

			if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				moduleDep.elementNode = redundantProp.exportStatementASTNode.value != null ?
									redundantProp.exportStatementASTNode.value :
									redundantProp.exportStatementASTNode;
			}
			else if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

				moduleDep.elementNode = redundantProp.objectExpressionASTNode;
			}

			

			moduleDep.exportNode = null;
			moduleDep.exportedThroughModuleExports = redundantProp.propertyExportedThroughModuleExports;

			// needed (exported property is encapsulated through its transformation into a variable 
			//renamings to the variable needed)
			moduleDep.elementReferences = redundantProp.exportedPropertyReferences;

			this.moduleDependencyList.push(moduleDep);
		});

		//(b)
		let importStatements = this.importStatements;
		let redundantImports = importStatements.filter(importStmt => {

			// console.log('import stmt');
			// console.log(importStmt.value.loc);
			// console.log('\n');
			// console.log(this.moduleDependencyList.length);

			let importStmtLoc = importStmt.value.loc;

			//is importStmt contained in an import dependency?
			//no need to search all import dependency, only 1 needed
			let moduleImportDep = this.moduleDependencyList.find(md => {

				if(md.type !== 'import') {

					return false;
				}

				let importedElement = md.dependency.accessedElement;
				if(importedElement instanceof ImportedElement.ImportedElement === false &&
				   importedElement instanceof ImportedNamespace.ImportedNamespace === false &&
				   importedElement instanceof ImportedModule.ImportedModule === false) {

					//accessed element is a global variable (no imports)
					return true;
				}

				// console.log(importedElement.elementName + ' ' + importedElement.aliasName)
				let importedElementNodes = importedElement.importedElementNodes;
				
				//return true in the case md contains importStmt
				return importedElementNodes.some(importedElNode => {

					// console.log(importStmt.value.loc);
					// console.log('imported el node');
					// console.log(importedElNode.value.loc);

					// let impNodeLoc = importedElNode.value.loc;

					// return impNodeLoc.start.line === importStmtLoc.start.line &&
					// 		impNodeLoc.start.column === importStmtLoc.start.column &&
					// 		impNodeLoc.end.line === importStmtLoc.end.line &&
					// 		impNodeLoc.end.column === importStmtLoc.end.column;

					return importedElNode.value === importStmt.value;
				});
			});

			// console.log(moduleImportDeps.length)

			//importStmt contained in a import dependency
			//(not redundant)
			if(moduleImportDep != null) {

				return false;
			}

			//importStmt not contained in any import dependency (redundant)
			return true;
		});

		redundantImports.forEach(redImp => {

			let moduleDep = {};
			moduleDep.type = 'remove';
			moduleDep.importNode = redImp.value;

			this.moduleDependencyList.push(moduleDep);
		});
	};

	this.retrieveEncapsulatedDefs = function() {

		let encapsulatedDefs = [];

		let exportedVariables = this.retrieveExportedVariables();
		let exportedFunctions = this.retrieveExportedFunctions();

		//ExportedProperty (CommonJS) | ObjectLiteral (AMD)
		let exportedProperties = this.exportedProperties;

		// console.log(this.fileName + ' ' + exportedProperties.length + ' ' + exportedVariables.length + ' ' + exportedFunctions.length)
		// console.log(this.moduleDependencyList);

		//redundant variables/functions/properties bound to the export objects
		//are the definitions that are not included in an export dependency 
		//of their definition module
		let redundantVars = exportedVariables.filter(exportedVar => {

			let varExportDeps = [];

			if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				varExportDeps = this.moduleDependencyList.filter(md => {
	
					return md.type === 'export' && md.exportedElement && md.exportedElement.dataType === 'variable' &&
							(md.exportedElement.variableDeclarationNode === exportedVar.variableDeclarationNode.value ||
							md.exportedElement.exportAlias === exportedVar.variableName);
				});
			}
			else {

				varExportDeps = this.moduleDependencyList.filter(md => {
	
					return md.type === 'export' && md.exportedElement && md.exportedElement.dataType === 'variable' &&
							(md.exportedElement.elementNode === exportedVar.variableDeclarationNode.value);
				});
			}

			// console.log(varExportDeps);
			// console.log(varExportDeps.length);

			//variable included in an export dependency
			//not a redundant variable
			if(varExportDeps.length > 0) {

				return false;
			}

			return true;
		});

		let redundantFuncs = exportedFunctions.filter(exportedFunc => {

			// console.log(exportedFunc.functionNode);
			let funcExportDeps = [];
			if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				funcExportDeps = this.moduleDependencyList.filter(md => {

					// console.log(md);
	
					return md.type === 'export' && md.exportedElement && md.exportedElement.dataType === 'function' &&
							md.exportedElement.functionNode === exportedFunc.functionNode.value;
				});
			}
			else {

				funcExportDeps = this.moduleDependencyList.filter(md => {

					// md.type === 'export' ? console.log(md) : console.log();
	
					return md.type === 'export' && md.exportedElement && md.exportedElement.dataType === 'function' &&
							md.exportedElement.elementNode === exportedFunc.functionNode.value;
				});
			}
			
			//function included in an export dependency
			//not a redundant function
			if(funcExportDeps.length > 0) {

				return false;
			}

			return true;
		});

		// console.log(this.fileName)

		let redundantProps = exportedProperties.filter(exportedProp => {

			// console.log(exportedProp);
			let propExportDeps = this.moduleDependencyList.filter(md => {

				// console.log(md);
				let propertyDefNode;
				if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

					propertyDefNode = exportedProp.exportStatementASTNode.value != null ?
										exportedProp.exportStatementASTNode.value :
										exportedProp.exportStatementASTNode;
				}
				else if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

					propertyDefNode = exportedProp.objectExpressionASTNode;
				}

				// console.log(propertyDefNode)
				return md.type === 'export' && (md.exportedElement.dataType === 'property' || md.exportedElement.dataType === 'object') && 
						md.exportedElement.elementNode === propertyDefNode;
			});

			// console.log(exportedProp.exportedPropertyName + ' ' + propExportDeps.length);

			//exported property included in an export dependency
			//not a redundant property
			if(propExportDeps.length > 0) {

				return false;
			}

			return true;
		});

		return {

			'redundantVars' : redundantVars,
			'redundantFuncs': redundantFuncs,
			'redundantProps' : redundantProps
		};
	};

	this.addExportDependencyToModuleDependencyList = function(definitionObject) {

		// console.log(definitionObject);
		// console.log(this.fileName + " " + this.moduleDependencyList.length);
		// console.log(this.moduleDependencyList.filter(md => {

		// 	return md.edgeType === definitionObject.edgeType;
		// }))

		let exportDeps = this.moduleDependencyList.filter(exportDep => {

			// return exportDep.type === 'export';

			return exportDep.type === definitionObject.type &&
					exportDep.exportedElement.dataType === definitionObject.exportedElement.dataType;
		});

		// console.log(exportDeps.length);
		
		//each export transform is inserted once in the definition list
		for(let definitionIndex = 0; definitionIndex < exportDeps.length; definitionIndex++) {
			
			let currentDefinitionObject = exportDeps[definitionIndex];
			let exportedDefDataType = currentDefinitionObject.exportedElement.dataType;

			//exported definitions not of the same data type
			//proceed to the next export object
			// if(exportedDefDataType !== definitionObject.exportedElement.dataType) {

			// 	continue;
			// }

			let objectRefADef = false;

			//implied global dependencies exist regardless of module framework
			if(currentDefinitionObject.type === 'introduce_variable_definition' &&
				currentDefinitionObject.exportedElement.variableName !== definitionObject.exportedElement.variableName) {

				//add transformation object for each implied global once
				objectRefADef = false;
			}
			else if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				if(exportedDefDataType === 'variable') {

					objectRefADef = (definitionObject.exportedElement.variableName === currentDefinitionObject.exportedElement.variableName &&
									definitionObject.exportedElement.variableDeclarationNode === currentDefinitionObject.exportedElement.variableDeclarationNode);
				}
				else if(exportedDefDataType === 'function') {
	
					objectRefADef = (definitionObject.exportedElement.functionName === currentDefinitionObject.exportedElement.functionName &&
									definitionObject.exportedElement.functionNode === currentDefinitionObject.exportedElement.functionNode);
				}
				else {
	
					objectRefADef = (definitionObject.exportedElement.exportedElementName === currentDefinitionObject.exportedElement.exportedElementName &&
									definitionObject.exportedElement.elementNode === currentDefinitionObject.exportedElement.elementNode);
				}
			}
			else {

				if(exportedDefDataType === 'variable' || exportedDefDataType === 'function') {

					objectRefADef = (definitionObject.exportedElement.elementName === currentDefinitionObject.exportedElement.elementName &&
									definitionObject.exportedElement.elementNode === currentDefinitionObject.exportedElement.elementNode);
				}
				else if(exportedDefDataType === 'implied') {

					objectRefADef = (definitionObject.exportedElement.variableName === currentDefinitionObject.exportedElement.variableName);
				}
				else {
	
					objectRefADef = (definitionObject.exportedElement.exportedElementName === currentDefinitionObject.exportedElement.exportedElementName &&
									definitionObject.exportedElement.elementNode === currentDefinitionObject.exportedElement.elementNode);
				}
			}

			// console.log(objectRefADef);

			// console.log(currentDefinitionObject);
			// console.log(definitionObject);
			// console.log(definitionObject.type === currentDefinitionObject.type && 
			// 	definitionObject.exportedElementName === currentDefinitionObject.exportedElementName &&
			// 	definitionObject.exportAlias === currentDefinitionObject.exportAlias &&
			// 	(definitionObject.elementNode === null || definitionObject.elementNode === currentDefinitionObject.elementNode))

			//object reference the same definition
			if(objectRefADef === true) {
				
				if(definitionObject.exportedElement.dataType === 'libraryObject') {

					return;
				}

				//in the case that definitionObject is relevant to a function
				//compare AST nodes too (prevent merge of transforms for different anonymous functions)
				if(definitionObject.exportedElement.modificationFunctions !== undefined) {

					definitionObject.exportedElement.modificationFunctions.forEach(function(modificationFunction) {

						currentDefinitionObject.exportedElement.modificationFunctions.push(modificationFunction);
					});

					//update whether exported declaration is accessed dynamically (needed for declarations modelling objects)
					//set to true in the case that the declaration is accessed dynamically at least once in the system
					//(also, doesn't change if already true)
					currentDefinitionObject.isAccessedDynamically = 
							(currentDefinitionObject.isAccessedDynamically === true ? 
							currentDefinitionObject.isAccessedDynamically : 
							definitionObject.isAccessedDynamically);
				}

				// console.log(currentDefinitionObject);
				// console.log(definitionObject);

				//definitionObject is relevant to an exported object with properties
				if(definitionObject.exportedElement !== undefined && currentDefinitionObject.exportedElement !== undefined) {

					let referencedProperties = definitionObject.exportedElement.referencedProperties;
					let currDefReferencedProperties = currentDefinitionObject.exportedElement.referencedProperties;

					//in the case that definitionObject is relevant to an exported object
					//but the accessed properties are not considered yet, update the object's accessed properties
					if(referencedProperties !== undefined && currDefReferencedProperties !== undefined) {

						referencedProperties.forEach(function(referencedProperty) {

							//if the definitionObject's accessed property (referencedProperty) is not considered in the currentDefinitionObject's ones
							//update currentDefinitionObject
							let retrievedProperties = currDefReferencedProperties.filter(function(currReferencedProperty) {

								return currReferencedProperty.propertyName === referencedProperty.propertyName;
							});

							if(retrievedProperties.length === 0) {

								//referencedProperty not found in currentDefinitionObject
								//update currentDefinitionObject
								currDefReferencedProperties.push(referencedProperty);
							}
						});

					}
				}

				return;
			}

			
		}

		// console.log(definitionObject);
		
		this.moduleDependencyList.push(definitionObject);
		
	};

	this.retrieveExportDependencyInModuleDependencyList = function(definitionObject) {

		// console.log(this.fileName + " " + this.moduleDependencyList.length);
		
		//each export transform is inserted once in the definition list
		for(var definitionIndex = 0; definitionIndex < this.moduleDependencyList.length; definitionIndex++) {
			
			var currentDefinitionObject = this.moduleDependencyList[definitionIndex];
			// console.log(currentDefinitionObject);
			// console.log(definitionObject);

			if(definitionObject.type === currentDefinitionObject.type && 
			   definitionObject.exportedElementName === currentDefinitionObject.exportedElementName &&
			   (definitionObject.elementNode === null || definitionObject.elementNode === currentDefinitionObject.elementNode)) {
				
				return currentDefinitionObject;
			}

		}
		
		return null;
	};

	this.addGlobalObjectPropertyDependencyToList = function(definitionObject) {

		//each export transform is inserted once in the definition list
		for(var definitionIndex = 0; definitionIndex < this.moduleDependencyList.length; definitionIndex++) {
			
			var currentDefinitionObject = this.moduleDependencyList[definitionIndex];
			// console.log(currentDefinitionObject);
			// console.log(definitionObject);

			if(definitionObject.type === currentDefinitionObject.type && definitionObject.modificationFunction && currentDefinitionObject.modificationFunction &&
			   definitionObject.modificationFunction.functionName === currentDefinitionObject.modificationFunction.functionName) {
				
				return;
			}

		}
		
		this.moduleDependencyList.push(definitionObject);
	};

	this.retrieveModuleDefinition = function(elementName) {
		
		var explicitGlobal = this.retrieveExplicitGlobal(elementName);
		
		//(a) a variable named elementName exists
		if(explicitGlobal !== null) {
			
			return explicitGlobal;
		}
		
		var definedFunction = this.retrieveTopLevelScopeFunctionByName(elementName);
		
		//(b) a function named element name exists
		if(definedFunction !== null) {
			
			return definedFunction;
		}

		return null;
	};
	
	this.updateExplicitElementToExported = function(elementName, elementExportStatement, isElementExportedThroughModuleExports) {
		
		//(a) does exportedElement represent a variable?
		var explicitGlobal = this.retrieveExplicitGlobal(elementName);
		
		// console.log(explicitGlobal);
//		console.log(this.fileName);
		// console.log(elementName);
//		console.log(elementExportStatement);
//		console.log("\n");
		
		if(explicitGlobal !== null) {
			
			//elementName is the global variable represented by explicitGlobal
			//update explicitGlobal and proceed to the next exportedElement
			explicitGlobal.updateIsExported(true);
			explicitGlobal.updateExportedVariableNode(elementExportStatement);

			//export statement type is needed in order to resolve the ES6 export statement type (default/named)
			explicitGlobal.updateExportStatementType(isElementExportedThroughModuleExports);
			// console.log(explicitGlobal);
			
			return;
		}
		
		//(b) does exportedElement represent a function?
		var definedFunction = this.retrieveTopLevelScopeFunctionByName(elementName);
		// console.log(definedFunction);
		if(definedFunction != null) {
			
			//elementName is the top-level defined function represented by definedFunction
			//update definedFunction and proceed to the next exportedElement
			definedFunction.updateIsExported(true);
			definedFunction.updateExportedFunctionNode(elementExportStatement);
			definedFunction.updateExportStatementType(isElementExportedThroughModuleExports);
//			console.log(definedFunction.functionName);
//			console.log(definedFunction.functionNode);
//			console.log(definedFunction.exportedFunctionNode);
			// console.log(definedFunction);
			
			return;
			
		}

		//(c) does exportedElement represent a defined class?
		var definedClass = this.retrieveTopLevelScopeDefinedClassByName(elementName);
		if(definedClass !== null) {

			definedClass.updateIsExported(true);
			definedClass.updateExportedClassNode(elementExportStatement);
			definedClass.updateExportedThroughModuleExports(isElementExportedThroughModuleExports);

			return;
		}
	}
	
	/**
	 * Searches function by its AST node and updates it to exported.
	 */
	this.updateDefinedFunctionToExported = function(functionNode, elementExportStatement) {
		
		var definedFunction = null;
		for(var functionIndex = 0; functionIndex < this.definedFunctions.length; functionIndex++) {
			
			definedFunction = this.definedFunctions[functionIndex];
//			console.log(definedFunction.functionNode);
			if(definedFunction.functionNode.value === functionNode) {
				
//				console.log(definedFunction.functionName);
				definedFunction.updateIsExported(true);
				definedFunction.updateExportedFunctionNode(elementExportStatement);
				return;
			}
		}
	};

	/**
	 * Retrieves the module definitions (variables/functions/objects) exported from sourceFile.
	 * Returns an object, where each property is mapped to a definition type
	 * (variable-function-object assigned/bound to the export module object).
	 */
	this.retrieveExportedDefinitionsOfModule = function() {

		let exportedVariables = this.retrieveExportedVariables();
		let exportedFunctions = this.retrieveExportedFunctions();

		//object literals assigned/bound to the export object
		let exportedProperties = this.exportedProperties;
		
		//return an object where each definition type is mapped to a property.
		//Each property contains the definitions of the respective type.
		return {

			exportedVariables: exportedVariables,
			exportedFunctions: exportedFunctions,
			exportedProperties: exportedProperties
		};
	};

	this.updatePropertiesOfExportedElements = function() {

		if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

			//only applied to CommonJS modules
			return;
		}

		let exportedVariables = this.explicitGlobals.filter(explicitGlobal => {

			return explicitGlobal.isExported === true;
		});

		exportedVariables.forEach(exportedVariable => {

			
		});

		let exportedFunctions = this.definedFunctions.filter(definedFunction => {

			return definedFunction.isExported === true;
		});


	};

	//Returns the module's exported definition (applies to CommonJS modules in the
	//case an assignment of the exported object exists)
	this.retrieveExportedDefinition = function() {

		let exportedVariables = this.explicitGlobals.filter(explicitGlobal => {

			return explicitGlobal.isExported === true;
		});

		if(exportedVariables.length > 0) {

			return exportedVariables[0];
		}

		//source file has no exported variables
		let exportedFunctions = this.definedFunctions.filter(definedFunction => {

			return definedFunction.isExported === true;
		});

		if(exportedFunctions.length > 0) {

			return exportedFunctions[0];
		}

		if(this.exportedProperties.length > 0) {

			//source file might have an object assigned to the export object
			return this.exportedProperties[0];
		}

		return null;
	};

	//retrieve the imported definition of sourceFile through its import AST node
	//(needed to resolve whether an imported and re-exported definition is cohesive)
	this.retrieveImportedDefinitionByImportNode = function(requireCall) {

		let importedNamespaces = this.importedNamespaces.filter(importedNamespace => {

			let namespaceImportNodes = importedNamespace.importedElementNodes.map(importedElementNode => importedElementNode.value);
			return namespaceImportNodes.indexOf(requireCall) >= 0;
		});

		if(importedNamespaces.length > 0) {

			return importedNamespaces[0];
		}

		return null;
	};

	this.calculateEfferentCouplingOfInitialModule = function() {

		//Martin 2018 (p. 122): efferent coupling identical to fan out
		//#classes outside package that classes (>=1) in this package depend on
		//class <-> module feature (imported element is mapped to 0..n module features)
		//package <-> module (sourceFile)
		// return this.countInitialImportedDefinitions();

		/**
		 * Imported definitions before refactoring are assessed through the analysis
		 * 	1. variable/function that is not an object: 1/definition

			2. object (variable/function): 
				a. Non-cohesive: 1/property
				b. Cohesive: 1/definition (+ 1/property, in the case that there are properties bound to the object instead of the object instances)

		 */

		// console.log(this.fileName);

		//consider imported definitions that are actually imported
		//do not consider imported definitions from require() invokations whose results are stored nowhere
		//(modules imported for side-effects)
		//also, consider only imported elements mapped to functions or variables initialized with function expressions
		// let importedVariables = this.importedVariables.filter(importedVariable => {

		// 	console.log(importedVariable.moduleDefinition)
		// 	return importedVariable.declaredSource.startsWith('.') === true && 
		// 			this.isModuleImportedForSideEffects(importedVariable) === false &&
		// 			importedVariable.moduleDefinition !== null &&
		// 			(importedVariable.moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration ||
		// 			 (importedVariable.moduleDefinition instanceof Variable.Variable &&
		// 				importedVariable.moduleDefinition.initializationValueNode !== null &&
		// 			  importedVariable.moduleDefinition.initializationValueNode.type === 'FunctionExpression'));
		// });

		let importedVariables = this.importedVariables.filter(importedVariable => {

			// console.log(importedVariable.moduleDefinition)
			return importedVariable.declaredSource.startsWith('.') === true && 
					this.isModuleImportedForSideEffects(importedVariable) === false &&
					importedVariable.moduleDefinition !== null &&
					(importedVariable.moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration ||
					 (importedVariable.moduleDefinition instanceof Variable.Variable &&
						importedVariable.moduleDefinition.initializationValueNode !== null &&
					  importedVariable.moduleDefinition.initializationValueNode.type === 'FunctionExpression'));
		});

		//remove duplicates (implied globals - the definition module of an implied global
		//is not resolved in the analysis phase)
		importedVariables = importedVariables.filter((element, position) => {

			// console.log(element);
			let firstOccurenceIndex = importedVariables.findIndex(el => {

				return el.elementName === element.elementName;
			});
			return firstOccurenceIndex === position;
		});
		
		let importedFunctions = this.importedFunctions.filter(importedFunction => {

			return importedFunction.declaredSource.startsWith('.') === true &&
					this.isModuleImportedForSideEffects(importedFunction) === false;
		});

		let importedNamespaces = this.importedNamespaces.filter(importedNamespace => {

			return importedNamespace.declaredSource.startsWith('.') === true &&
					this.isModuleImportedForSideEffects(importedNamespace) === false;
		});

		// console.log(importedVariables.length + ' ' + importedFunctions.length + ' ' + importedNamespaces.length)

		//modules imported for their side-effects (not considered in imported definitions, since file does not import anything)
		let importedModules = this.importedModules;

		let numOfImportedDefs = 0;

		importedVariables.forEach(importedVariable => {

			// console.log(importedVariable)
			numOfImportedDefs += importedVariable.moduleDefinition.numberDefinitionsExportedFromVariable();
		});

		importedFunctions.forEach(importedFunction => {

			numOfImportedDefs += importedFunction.moduleDefinition.numberDefinitionsExportedFromFunction();
		});

		//consider only imported namespaces having > 0 exported properties;
		importedNamespaces = importedNamespaces.filter(importedNamespace => {

			return Object.getOwnPropertyNames(importedNamespace.moduleDefinitions).length > 0;
		});

		importedNamespaces.forEach(importedNamespace => {

			let moduleDefinitions = importedNamespace.moduleDefinitions;

			let exportedVariables = moduleDefinitions.exportedVariables;
			let exportedFunctions = moduleDefinitions.exportedFunctions;

			//objects assigned/bound to the export object
			let exportedProperties = moduleDefinitions.exportedProperties;

			//consider only variables initialized with function expressions
			let variablesAssignedToExportObject = exportedVariables.filter(exportedVariable => {

				if(exportedVariable.initializationValueNode === null ||
					exportedVariable.initializationValueNode.type !== 'FunctionExpression') {

					return false;
				}

				return exportedVariable.exportedThroughModuleExports === true;
			});

			let functionsAssignedToExportObject = exportedFunctions.filter(exportedFunction => {

				return exportedFunction.exportedThroughModuleExports === true;
			});

			// console.log(variablesAssignedToExportObject.length);
			if(variablesAssignedToExportObject.length > 1) {

				//multiple variables are assigned to the export object
				//definitions exported upon condition
				numOfImportedDefs += variablesAssignedToExportObject[0].numberDefinitionsExportedFromVariable();
				return;
			}

			// console.log(functionsAssignedToExportObject.length);
			if(functionsAssignedToExportObject.length > 1) {

				//multiple functions are assigned to the export object
				//definitions exported upon condition
				numOfImportedDefs += functionsAssignedToExportObject[0].numberDefinitionsExportedFromFunction();
				return;
			}

			//maximum 1 variable/function assigned to the export object
			exportedVariables.forEach(exportedVariable => {

				numOfImportedDefs += exportedVariable.numberDefinitionsExportedFromVariable();
			});

			exportedFunctions.forEach(exportedFunction => {

				numOfImportedDefs += exportedFunction.numberDefinitionsExportedFromFunction();
			});

			//exported properties: 
			//(a) CommonJS: objects bound/assigned to the export object (count as 1)
			//(b) AMD: objects returned from the callback function (count as 1 if cohesive, count depending on properties if non-cohesive)
			if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				numOfImportedDefs += exportedProperties.length;
			}
			else {

				exportedProperties.forEach(exportedProperty => {

					if(exportedProperty.isCohesive === false) {

						numOfImportedDefs += exportedProperty.objectProperties.length;
					}
					else {

						numOfImportedDefs += 1;
					}
				});
			}

		});

		// console.log(`file: ${this.fileName}. Initial: ${numOfImportedDefs}`);
		return numOfImportedDefs;
	};

	this.calculateEfferentCouplingOfRefactoredModule = function() {

		//Martin 2018 (p. 122): efferent coupling identical to fan out
		//#classes outside package that classes (>=1) in this package depend on
		//class <-> module feature (imported element is mapped to 0..n module features)
		//package <-> module (sourceFile)

		//for the refactored code, we consider the imported elements
		//that are actually used in the module (refs >= 1)
		// return this.countRefactoredImportedDefinitions();

		let numOfImportedDefsAfterRefactoring = 0;

		// console.log(this.fileName);

		//only analyse import dependencies with respect to locally-defined modules
		//(not external modules, e.g. npm packages)
		//also do not consider module imports 
		//(the module is imported for its side-effects, no definition is imported)
		let moduleImportDependencies = this.moduleDependencyList.filter(moduleDependency => {

			// if(moduleDependency.type === 'import' && moduleDependency.dependency.edgeType !== 'ModuleImport') {

			// 	console.log(moduleDependency.dependency.accessedElement);
			// }
			
			return moduleDependency.type === 'import' && moduleDependency.dependency.edgeType !== 'ModuleImport' &&
				   moduleDependency.dependency.accessedElement.declaredSource !== undefined &&
				   moduleDependency.dependency.accessedElement.declaredSource.startsWith('.') === true;
		});

		// console.log(this.fileName);
		// console.log(moduleImportDependencies);
		moduleImportDependencies.forEach(importDep => {

			// console.log(importDep);

			let accessedElement = importDep.dependency.accessedElement;
			let elementUsages = accessedElement.elementUsages;
			// console.log(accessedElement);

			//imported element with no usages
			//consider it in the case that it is assigned/bound to the module's export object
			if(elementUsages.length === 0 && accessedElement.boundToExportedDefinition === false) {

				//imported element with no usages
				//consider it in the case that its import
				//is nested in another statement
				//also, consider it in the case that it is assigned/bound to the module's export object
				let importedElementNodes = accessedElement.importedElementNodes;

				importedElementNodes = importedElementNodes.filter(elNode => {

					return elNode.parentPath.value.type !== 'AssignmentExpression' &&
						   elNode.parentPath.value.type !== 'VariableDeclarator';
				});

				if(importedElementNodes.length === 0) {

					return;
				}

			}

			if(accessedElement instanceof ImportedNamespace.ImportedNamespace === true) {

				// console.log(accessedElement.elementName);
				let accessedProps = accessedElement.accessedProperties;

				//remove duplicates (each accessed property contains the property's usage
				//within the module that imports it)
				let accessedProperties = accessedProps.filter((element, position) => {

					let firstOccurenceIndex = accessedProps.findIndex(el => {

						return el.propertyName === element.propertyName;
					});
					return firstOccurenceIndex === position;
				});

				//imported definition is a namespace
				//it is mapped to multiple module definitions (applies to CommonJS/AMD)
				//that are imported along with the definition
				//we count only accessed variables/functions/properties

				// form: {

				// 	exportedVariables : [variable],
				//  exportedFunctions : [functionDeclaration],
				//  exportedProperties : [exportedProperty | objectLiteral]
				// }
				let moduleDefinitions = accessedElement.moduleDefinitions;
				let exportedVariables = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedVariables : [];
				let exportedFunctions = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedFunctions : [];
				
				let exportedProperties = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedProperties : [];

				//imported namespace mapped to exported variables/functions
				//imported namespace contains multiple variables/functions
				//assigned to the export object (e.g. export upon condition)
				let variablesAssignedToExportObject = exportedVariables.filter(exportedVariable => {

					return exportedVariable.exportedThroughModuleExports === true;
				});
	
				let functionsAssignedToExportObject = exportedFunctions.filter(exportedFunction => {
	
					return exportedFunction.exportedThroughModuleExports === true;
				});
	
				//in the case that multiple variables are assigned to the export object,
				//multiple variables exported upon condition (process the first variable only)
				//in other cases, process all exported variables
				for(let varIndex = 0; varIndex < exportedVariables.length; varIndex++) {

					// console.log(variablesAssignedToExportObject.length);
					
					if(variablesAssignedToExportObject.length > 1 && varIndex === 1) {

						//multiple variables assigned to the export object
						//variables exported upon condition
						break;
					}

					let exportedVariable = exportedVariables[varIndex];

					// console.log(exportedVariable.initializationValueNode.type);

					//do not consider variables not initialized with function expressions
					if(exportedVariable.initializationValueNode === null ||
						exportedVariable.initializationValueNode.type !== 'FunctionExpression') {

						continue;
					}

					let variableName = exportedVariable.variableName;
					let elementProperties = exportedVariable.objectProperties;

					//retrieve the exportedVariable's properties that are accessed (exported)
					let referencedProperties = accessedProperties.filter(accessedProperty => {

						let elementProps = elementProperties.filter(elementProp => {
	
							return elementProp.propertyName === accessedProperty.propertyName;
						});
	
						if(elementProps.length > 0) {
	
							return true;
						}
	
						return false;
					});

					// console.log(exportedVariable.hasBoundPropertiesInitializedWithImportDefs);

					if(exportedVariable.isObjectReferenced === true ||
					   exportedVariable.hasBoundPropertiesInitializedWithImportDefs === true ||
					   accessedElement.isNested === true) {

						//object is iterated or has bound properties initialized with the result of require() 
						//(insert object, along with its bound properties
						//regardless of its referenced properties)
						numOfImportedDefsAfterRefactoring += 1 + elementProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedVariable.isInitializedWithFunctionConstructor === true) {

						//object is a constructor function (insert object if it is used outside member expressions or it's bound to the export object, 
						//along with its bound properties that are accessed)
						let variableRefs = elementUsages.filter(elementRef => {

							return elementRef.parentPath.value.type !== 'MemberExpression';
						});

						// console.log(accessedElement.boundToExportedDefinition);
						numOfImportedDefsAfterRefactoring += (variableRefs.length > 0 || accessedElement.boundToExportedDefinition === true) ? 1 : 0;

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//procced to the next definition
						continue;
					}

					if(exportedVariable.objectProperties.length > 0) {

						//non-cohesive object that is not iterated
						//import the accessed properties of object
						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					//otherwise, consider exportedVariable in statistics
					//in the case there exists a reference to it (either direct
					//through referencing it, or indirect, through the imported namespace)
					let variableRefs = elementUsages.filter(elementRef => {

						if(variableName === accessedElement.elementName) {

							//exportedVariable has the same name with imported namespace
							//search by its name
							return elementRef.value.name === variableName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName);
						}
						else {

							//exportedVariable has not the same name with imported namespace
							//search by its alias
							return elementRef.parentPath.value.type !== 'MemberExpression' || 
							elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName;
						}

					});

					numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;
					// numOfImportedDefsAfterRefactoring += (elementUsages.length > 0) ? 1 : 0;

					//proceed to the next definition
					continue;
				}

				// console.log(functionsAssignedToExportObject.length);

				//in the case that multiple functions are assigned to the export object,
				//multiple functions exported upon condition (process the first function only)
				//in other cases, process all exported functions
				for(let funcIndex = 0; funcIndex < exportedFunctions.length; funcIndex++) {

					if(functionsAssignedToExportObject.length > 1 && funcIndex === 1) {

						break;
					}

					let exportedFunction = exportedFunctions[funcIndex];
					let functionName = exportedFunction.functionName;
					let elementProperties = exportedFunction.functionProperties;

					// console.log(exportedFunction);

					let referencedProperties = accessedProperties.filter(accessedProperty => {

						let elementProps = elementProperties.filter(elementProp => {
	
							return elementProp.propertyName === accessedProperty.propertyName;
						});
	
						if(elementProps.length > 0) {
	
							return true;
						}
	
						return false;
					});

					if(exportedFunction.isObjectReferenced === true ||
						accessedElement.isNested === true) {

						//function is iterated (import function along with its bound properties)
						numOfImportedDefsAfterRefactoring += 1 + elementProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedFunction.isConstructor === true) {

						//constructor function (import function in the case it is used, along with its accessed bound properties)

						//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
						let functionRefs = elementUsages.filter(elementRef => {

							return elementRef.parentPath.value.type !== 'MemberExpression';
						});

						numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedFunction.functionProperties.length > 0) {

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					//otherwise, consider exportedFunction in statistics
					//in the case there exists a reference to it (either direct
					//through referencing it, or indirect, through the imported namespace)
					let functionRefs = elementUsages.filter(elementRef => {

						if(functionName === accessedElement.elementName) {

							//exportedFunction has the same name with imported namespace
							//search by its name
							return elementRef.value.name === functionName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName);
						}
						else {

							//exportedFunction has not the same name with imported namespace
							//search by its alias
							return elementRef.parentPath.value.type !== 'MemberExpression' || 
							elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName;
						}

					});

					// console.log(functionName);
					// console.log(functionRefs);

					numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

					//proceed to the next definition
					continue;
				}

				//consider the properties that are initialized with objects with properties
				//or initialized with non-objects
				let exportedObjProperties = exportedProperties.filter(exportedProperty => {

					if(exportedProperty instanceof ExportedProperty.ExportedProperty === true) {

						return exportedProperty.exportedPropertyASTNode.type !== 'ObjectExpression' ||
						   		exportedProperty.objectProperties.length > 0;
					}
					
					if(exportedProperty instanceof ObjectLiteral.ObjectLiteral === true) {

						return exportedProperty.objectExpressionASTNode.type !== 'ObjectExpression' ||
								exportedProperty.objectProperties.length > 0;
					}

					return false;
				});

				// console.log(exportedProperties);

				//CommonJS exportedProperties: variables/functions/object literals bound to the export object,
				//object literals assigned to the export object (none of these objects are destructured)

				//AMD exportedProperties: object literals returned from the callback function
				//(these objects will be destructured)
				if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
					
					if(exportedObjProperties.length > 0) {

						numOfImportedDefsAfterRefactoring += exportedObjProperties.length;
					}
				}
				else {

					exportedObjProperties.forEach(exportedObjProp => {

						if(exportedObjProp.objectProperties.length === 0) {

							numOfImportedDefsAfterRefactoring += 1;
							return;
						}

						let referencedProps = exportedObjProp.objectProperties.filter(objectProp => {

							return objectProp.isExported === true;
						});

						numOfImportedDefsAfterRefactoring += referencedProps.length;
					});
				}
				if(exportedObjProperties.length === 0) {

					//module export values through binding to the export object
					// numOfImportedDefsAfterRefactoring += accessedProperties.length;
					
					// return;
				}

				// console.log(exportedFunctions.length);
				// console.log(exportedVariables.length);
				// console.log(exportedProperties.length);

				

				//proceed to the next namespace
				return;
			}
			
			//imported definition not a namespace (variable/function)
			//(applies to each module system)
			//it is mapped to 1 definition
			let moduleDefinition = accessedElement.moduleDefinition;

			let accessedProps = accessedElement.accessedProperties;

			// console.log(accessedElement);

			//remove duplicates (each accessed property contains the property's usage
			//within the module that imports it)
			let accessedProperties = accessedProps === undefined ? [] : accessedProps.filter((element, position) => {

				let firstOccurenceIndex = accessedProps.findIndex(el => {

					return el.propertyName === element.propertyName;
				});

				return firstOccurenceIndex === position;
			});

			if(moduleDefinition instanceof Variable.Variable === true) {

				//do not consider variables not initialized with function expressions
				if(moduleDefinition.initializationValueNode === null ||
					moduleDefinition.initializationValueNode.type !== 'FunctionExpression') {

					return;
				}

				let variableName = moduleDefinition.variableName;

				//retrieve the exportedVariable's properties that are accessed through accessedElement
				let referencedProperties = accessedProperties.filter(accessedProperty => {

					let elementProps = elementProperties.filter(elementProp => {

						return elementProp.propertyName === accessedProperty.propertyName;
					});

					if(elementProps.length > 0) {

						return true;
					}

					return false;
				});

				if(moduleDefinition.isObjectReferenced === true) {

					//object is iterated (import definition, along with its bound properties)
					numOfImportedDefsAfterRefactoring += 1 + moduleDefinition.objectProperties.length;
					return;
				}

				if(moduleDefinition.isInitializedWithFunctionConstructor === true) {

					//constructor function (import definition in the case it is used, along with its accessed bound properties)
					//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
					let variableRefs = elementUsages.filter(elementRef => {

						return elementRef.parentPath.value.type !== 'MemberExpression';
					});

					numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;

					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				if(moduleDefinition.objectProperties.length > 0) {

					//non-cohesive object (import the definition's accessed properties)
					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				//otherwise, consider exportedVariable in statistics
				//in the case there exists a reference to it (either direct
				//through referencing it, or indirect, through the imported namespace)
				let variableRefs = elementUsages.filter(elementRef => {

					return elementRef.value.name === variableName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName);
					});

				numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;
				return;
			}

			if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

				// console.log(exportedFunction);
				let functionName = moduleDefinition.functionName;
				let elementProperties = moduleDefinition.functionProperties;

				let referencedProperties = accessedProperties.filter(accessedProperty => {

					let elementProps = elementProperties.filter(elementProp => {

						return elementProp.propertyName === accessedProperty.propertyName;
					});

					if(elementProps.length > 0) {

						return true;
					}

					return false;
				});

				if(moduleDefinition.isObjectReferenced === true) {

					//object is iterated (import object along with its bound properties)
					numOfImportedDefsAfterRefactoring += 1 + moduleDefinition.functionProperties.length;
					return;
				}

				if(moduleDefinition.isConstructor === true) {

					//constructor function (import function in the case it is used, along with its accessed bound properties)

					//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
					let functionRefs = elementUsages.filter(elementRef => {

						return elementRef.parentPath.value.type !== 'MemberExpression';
					});

					numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				if(moduleDefinition.functionProperties.length > 0) {

					//non-cohesive function (import the object's accessed bound properties)
					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				//otherwise, consider exportedFunction in statistics
				//in the case there exists a reference to it (either direct
				//through referencing it, or indirect, through the imported namespace)
				let functionRefs = elementUsages.filter(elementRef => {

					return elementRef.value.name === functionName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName);
					});

				numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;
				return;
			}
		});
		 
		// console.log(numOfImportedDefsAfterRefactoring);
		return numOfImportedDefsAfterRefactoring;
	};

	this.retrieveModuleFeaturesOfSourceFileReferencingModuleFeaturesOfModule = function(externalModule) {

		//(a)
		if(externalModule === this) {

			return [];
		}

		//(b)
		let extModImpEls = externalModule.importedElements;
		
		//from extModImpEls exclude:
		//(1) imported modules for side effects or libraries (they are not mapped to module features)
		//(2) imported elements that are not defined in sourceFile
		let extModImpElsReferencingThis = extModImpEls.filter(extModImpEl => {

			//(1)
			if(extModImpEl instanceof ImportedModule.ImportedModule === true) {

				return false;
			}

			//(2)
			let absolutePath = path.resolve(path.dirname(externalModule.fileName) + path.sep + extModImpEl.declaredSource);
			absolutePath = absolutePath.endsWith('.js') === true ? absolutePath : absolutePath + '.js';
			// console.log(absolutePath + '\n' + this.fileName + '\n' + (absolutePath !== this.fileName));
			if(absolutePath !== this.fileName) {

				return false;
			}

			return true;
		});

		// console.log(externalModule.fileName + ' ' + extModImpElsReferencingThis.length);

		//externalModule's features (functions) referencing features in 'this'
		let moduleFeaturesReferencingImpEls = [];

		//extModImpElsReferencingThis: the externalModule's imported elements
		//that are mapped to module features of 'this' (sourceFile)
		extModImpElsReferencingThis.forEach(extModImpEl => {

			//retrieve the number of externalModule's features
			//that reference extModImpEl
			let elUsages = extModImpEl.elementUsages;

			// console.log('el: ' + elUsages.length)

			//find the surrounding scope of each element reference
			elUsages.forEach(elUsage => {

				//closestScope() returns a path from the AST root (program)
				//to elUsage (always returns Program AST node (?))
				// let surrScopes = jscodeshift(elUsage).closestScope();

				//traverse the AST upwards to find the closest 
				//function definition/function expression (in ES5, these form scopes)
				let surrScopes = jscodeshift(elUsage).closest(jscodeshift.FunctionDeclaration);

				//elUsage surrounded by a function declaration
				if(surrScopes.length > 0) {

					moduleFeaturesReferencingImpEls.push(surrScopes.at(0).get());
					return;
				}

				//elUsage not surrounded by a function declaration
				//maybe surrounded by a function expression
				surrScopes = jscodeshift(elUsage).closest(jscodeshift.FunctionExpression);

				//elUsage surrounded by a function expression
				if(surrScopes.length > 0) {

					moduleFeaturesReferencingImpEls.push(surrScopes.at(0).get());
					return;
				}

				//elUsage not surrounded by a function declaration or function expression
				//assume that elUsage located in the module's scope,
				//thus all top-level features use extModImpEl
				surrScopes = jscodeshift(elUsage).closestScope();
				
				// surrScopes.forEach(surrScope => console.log(surrScope))
				// console.log(surrScopes.length);

				if(surrScopes.length === 0) {

					return;
				}

				moduleFeaturesReferencingImpEls.push(surrScopes.at(0).get());
			});
		});

		//remove duplicates
		//1 module feature might reference 1..n importedElements of externalModule
		//we're interested in 1
		moduleFeaturesReferencingImpEls.filter((element, position) => {

			let firstOccurenceIndex = moduleFeaturesReferencingImpEls.findIndex(el => {

				return el.value === element.value;
			});

			return firstOccurenceIndex === position;
		});

		// console.log(moduleFeaturesReferencingImpEls.length)

		return moduleFeaturesReferencingImpEls;
	}

	this.calculateAfferentCouplingOfInitialModule = function(inputFiles) {

		//Martin 2018 (p. 122): afferent coupling identical to fan in
		//#classes outside package that depend on classes (>=1) in this package
		//class <-> module feature (imported element is mapped to 0..n module features)
		//package <-> module (sourceFile)

		//determined statically (i.e. referencing a feature in the top-level scope
		//is identical to referencing it in all the module's features)
		let res = 0;

		//(a) exclude input file whose afferent coupling is assessed
		//from the list of the modules importing it
		let inputFileList = inputFiles.convertHashMapToArray();

		//consider only production modules
		let productionModules = inputFileList.filter(inputFile => {

			return inputFile.moduleType === enums.ModuleType.componentFile;
		});

		// console.log('i: ' + this.fileName + ' ' + inputFileList.length);

		//(b) also, exclude the files that do not import input file
		productionModules.forEach(externalModule => {

			let featuresReferencingImpEls = this.retrieveModuleFeaturesOfSourceFileReferencingModuleFeaturesOfModule(externalModule);

			//sourceFile's module features are used in the top-level scope of externalModule (?)
			let programFeatures = featuresReferencingImpEls.filter(moduleFeature => {

				return moduleFeature.value.type === 'Program';
			});

			// console.log(featuresReferencingImpEls.length)
			// console.log(programFeatures.length)
			if(programFeatures.length > 0) {

				//module features are used at the top-level scope of externalModule
				//exclude topLevelScope (artificial node)

				// res += externalModule.definedFunctions.length-1;

				//consider only the functions defined in the top-level scope of the module
				let topLevelFunctions = externalModule.definedFunctions.filter(defFunc => {

					return defFunc.functionName !== 'topLevelScope' &&
							defFunc.functionScope === null;
				});

				// console.log(topLevelFunctions.length)
				res += topLevelFunctions.length;
				return;
			}

			// console.log(featuresReferencingImpEls.length)

			//sourceFile's module features not used in the top-level scope of externalModule
			//consider the externalModule's MODULE features that use module features of sourceFile
			//map each scope (FunctionDeclaration/FunctionExpression) to a defined function defined in the module's scope
			let moduleFeaturesReferecingImpEls = featuresReferencingImpEls.map(featRefImpEl => {

				// console.log(featRefImpEl.scope);
				// console.log(featRefImpEl.value.loc);

				let surrFuncDefs = jscodeshift(featRefImpEl).
									closest(jscodeshift.FunctionDeclaration);

				// console.log(surrFuncDefs.length);

				surrFuncDefs = jscodeshift(featRefImpEl).
						closest(jscodeshift.FunctionExpression);

				// console.log(surrFuncDefs.length);

				//find the closest module function surrounding featRefImpEl
				let surrFuncDef = featRefImpEl;
				while(surrFuncDef !== null) {

					//function is defined in the top-level scope
					//return the function itself
					if(surrFuncDef.scope.isGlobal === true) {

						break;
					}

					//function is not defined in the top-level scope
					//return the closest function definition that is defined in the top-level scope
					let surrFuncDefs = jscodeshift(surrFuncDef).
									closest(jscodeshift.FunctionDeclaration);
					
					// console.log('s: ' + surrFuncDefs.length);

					//featRefImpEl surrounded by a function declaration
					if(surrFuncDefs.length > 0) {

						let surrFuncDec = surrFuncDefs.at(0).get();
						if(surrFuncDec.scope.isGlobal === true) {

							surrFuncDef = surrFuncDec;
							break;
							// return surrFuncDec;
						}

						// return null;
						
						// return surrFuncDefs.at(0).get();
					}
					else {

						//featRefImpEl not surrounded by a function declaration
						surrFuncDefs = jscodeshift(surrFuncDef).
						closest(jscodeshift.FunctionExpression);

						// console.log('s: ' + surrFuncDefs.length);

						//featRefImpEl surrounded by a function expression
						if(surrFuncDefs.length > 0) {

							let surrFuncDec = surrFuncDefs.at(0).get();
							// console.log(surrFuncDec.value.loc);
							// console.log(surrFuncDec.parentPath.value.loc);
							// console.log(surrFuncDec.parentPath.scope);
							// console.log(surrFuncDec.scope);

							//AMD: is surrFuncDec the callback of define()/require()/requirejs()?
							//if yes, there is a top-level scope function that is accessing
							//module features of sourceFile
							// if(surrFuncDec.scope.isGlobal === true ||
							// 	(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true &&
							// 	 this.isFunctionDefinitionACallbackOfBuiltinFunctionInvocation(surrFuncDec) === true)) {

							// 	return surrFuncDec;
							// }

							//surrounding function either
							//(a) defined in the top-level scope or
							//(b) a callback of define()/require()/requirejs() (applies to AMD)
							if(surrFuncDec.scope.isGlobal === true ||
								(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true &&
								this.isFunctionDefinitionACallbackOfBuiltinFunctionInvocation(surrFuncDec) === true)) {

								surrFuncDef = surrFuncDec;
								break;
								// return surrFuncDec;
							}

							//surrounding function neither
							//(a) defined in the top-level scope nor
							//(b) callback of AMD builtin function
							//find the MODULE feature that contains surrounding function


							// return null;

							// return surrFuncDefs.at(0).get();
						}
					}

					surrFuncDef = surrFuncDef.parentPath;
				}

				// console.log(surrFuncDef.value.loc);
				return surrFuncDef;

				// return null;
			});

			//remove null features
			moduleFeaturesReferecingImpEls = moduleFeaturesReferecingImpEls.filter(modFeatRefImpEl => {

				return modFeatRefImpEl !== null;
			});

			//remove duplicates
			//(in the case that imported element is used in a top-level function and its nested functions,
			//we assume that 1 module feature (the top-level function) depends on imported element)
			moduleFeaturesReferecingImpEls = moduleFeaturesReferecingImpEls.filter((element, position) => {

				let firstOccurenceIndex = moduleFeaturesReferecingImpEls.findIndex(el => {
	
					return el.value === element.value;
				});
				return firstOccurenceIndex === position;
			});

			// console.log('m: ' + moduleFeaturesReferecingImpEls.length);
			res += moduleFeaturesReferecingImpEls.length;

			// res += featuresReferencingImpEls.length;
		});

		return res;
	};

	this.calculateAfferentCouplingOfRefactoredModule = function(inputFiles) {

		//Martin 2018 (p. 122): afferent coupling identical to fan in
		//#classes outside package that depend on classes (>=1) in this package
		//class <-> module feature (imported element is mapped to 0..n module features)
		//package <-> module (sourceFile)

		//afferent coupling before and after the refactoring is not changed
		//(it talks about module features and their references)
		return this.calculateAfferentCouplingOfInitialModule(inputFiles);
	};

	// this.calculateAfferentCouplingOfRefactoredModule = function(inputFiles) {

	// 	//Martin 2018 (p. 122): afferent coupling identical to fan in
	// 	//#classes outside package that depend on classes (>=1) in this package
	// 	//class <-> module feature (imported element is mapped to 0..n module features)
	// 	//package <-> module (sourceFile)

	// 	//determined statically (i.e. referencing a feature in the top-level scope
	// 	//is identical to referencing it in all the module's features)
	// 	let res = 0;

	// 	//(a) exclude input file whose afferent coupling is assessed
	// 	//from the list of the modules importing it
	// 	let inputFileList = inputFiles.convertHashMapToArray();

	// 	// console.log('i: ' + this.fileName + ' ' + inputFileList.length);

	// 	//(b) also, exclude the files that do not import input file
	// 	inputFileList.forEach(externalModule => {

	// 		let moduleFeaturesReferencingImpEls = this.retrieveModuleFeaturesOfSourceFileReferencingModuleFeaturesOfModule(externalModule);

	// 		let programFeatures = moduleFeaturesReferencingImpEls.filter(moduleFeature => {

	// 			return moduleFeature.value.type === 'Program';
	// 		});

	// 		if(programFeatures.length > 0) {

	// 			//module features are used at the top-level scope of externalModule
	// 			res += 1;
	// 			return;
	// 		}

	// 		res += moduleFeaturesReferencingImpEls.length;
	// 	});

	// 	return res;
	// };

	/**
	 * Is function modelled by surrFuncDec AST node a callback of a built-in function invocation?
	 * Applies to AMD.
	 * @param {*} surrFuncDec 
	 */
	this.isFunctionDefinitionACallbackOfBuiltinFunctionInvocation = function(surrFuncDec) {

		//a callback is a function passed as a parameter in a function invocation
		//find the closest call expression that surrounds surrFuncDec
		let surrCallExps = jscodeshift(surrFuncDec).closest(jscodeshift.CallExpression);

		if(surrCallExps.length === 0) {

			return false;
		}

		let surrCallExp = surrCallExps.at(0).get();

		if(surrCallExp.value.callee.type !== 'Identifier') {

			return false;
		}

		let callExpCallee = surrCallExp.value.callee;
		if(callExpCallee.name === 'define' ||
			callExpCallee.name === 'require' ||
			callExpCallee.name === 'requirejs') {

			return true;
		}

		return false;
	}

	/**
	 * Counts the definitions (variables/functions/object literals) the
	 * module depends on before refactoring.
	*/
	this.countInitialImportedDefinitions = function() {

		/**
		 * Imported definitions before refactoring are assessed through the analysis
		 * 	1. variable/function that is not an object: 1/definition

			2. object (variable/function): 
				a. Non-cohesive: 1/property
				b. Cohesive: 1/definition (+ 1/property, in the case that there are properties bound to the object instead of the object instances)

		 */

		// console.log(this.fileName);

		//consider imported definitions that are actually imported
		//do not consider imported definitions from require() invokations whose results are stored nowhere
		//(modules imported for side-effects)
		let importedVariables = this.importedVariables.filter(importedVariable => {

			return importedVariable.declaredSource.startsWith('.') && 
					this.isModuleImportedForSideEffects(importedVariable) === false;
		});

		//remove duplicates (implied globals - the definition module of an implied global
		//is not resolved in the analysis phase)
		importedVariables = importedVariables.filter((element, position) => {

			let firstOccurenceIndex = importedVariables.findIndex(el => {

				return el.elementName === element.elementName;
			});
			return firstOccurenceIndex === position;
		});
		
		let importedFunctions = this.importedFunctions.filter(importedFunction => {

			return importedFunction.declaredSource.startsWith('.') &&
					this.isModuleImportedForSideEffects(importedFunction) === false;
		});

		let importedNamespaces = this.importedNamespaces.filter(importedNamespace => {

			return importedNamespace.declaredSource.startsWith('.') &&
					this.isModuleImportedForSideEffects(importedNamespace) === false;
		});

		//modules imported for their side-effects (not considered in imported definitions, since file does not import anything)
		let importedModules = this.importedModules;

		let numOfImportedDefs = 0;

		importedVariables.forEach(importedVariable => {

			// console.log(importedVariable)
			numOfImportedDefs += importedVariable.moduleDefinition.numberDefinitionsExportedFromVariable();
		});

		importedFunctions.forEach(importedFunction => {

			numOfImportedDefs += importedFunction.moduleDefinition.numberDefinitionsExportedFromFunction();
		});

		//consider only imported namespaces having > 0 exported properties;
		importedNamespaces = importedNamespaces.filter(importedNamespace => {

			return Object.getOwnPropertyNames(importedNamespace.moduleDefinitions).length > 0;
		});

		// console.log(importedNamespaces.length)
		importedNamespaces.forEach(importedNamespace => {

			let moduleDefinitions = importedNamespace.moduleDefinitions;

			let exportedVariables = moduleDefinitions.exportedVariables;
			let exportedFunctions = moduleDefinitions.exportedFunctions;

			//objects assigned/bound to the export object
			let exportedProperties = moduleDefinitions.exportedProperties;

			let variablesAssignedToExportObject = exportedVariables.filter(exportedVariable => {

				return exportedVariable.exportedThroughModuleExports === true;
			});

			let functionsAssignedToExportObject = exportedFunctions.filter(exportedFunction => {

				return exportedFunction.exportedThroughModuleExports === true;
			});

			// console.log(variablesAssignedToExportObject.length);
			if(variablesAssignedToExportObject.length > 1) {

				//multiple variables are assigned to the export object
				//definitions exported upon condition
				numOfImportedDefs += variablesAssignedToExportObject[0].numberDefinitionsExportedFromVariable();
				return;
			}

			// console.log(functionsAssignedToExportObject.length);
			if(functionsAssignedToExportObject.length > 1) {

				//multiple functions are assigned to the export object
				//definitions exported upon condition
				numOfImportedDefs += functionsAssignedToExportObject[0].numberDefinitionsExportedFromFunction();
				return;
			}

			//maximum 1 variable/function assigned to the export object
			exportedVariables.forEach(exportedVariable => {

				numOfImportedDefs += exportedVariable.numberDefinitionsExportedFromVariable();
			});

			exportedFunctions.forEach(exportedFunction => {

				numOfImportedDefs += exportedFunction.numberDefinitionsExportedFromFunction();
			});

			//exported properties: 
			//(a) CommonJS: objects bound/assigned to the export object (count as 1)
			//(b) AMD: objects returned from the callback function (count as 1 if cohesive, count depending on properties if non-cohesive)
			if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {

				numOfImportedDefs += exportedProperties.length;
			}
			else {

				exportedProperties.forEach(exportedProperty => {

					if(exportedProperty.isCohesive === false) {

						numOfImportedDefs += exportedProperty.objectProperties.length;
					}
					else {

						numOfImportedDefs += 1;
					}
				});
			}

		});

		return numOfImportedDefs;
	};

	/**
	 * Is exported definition returned from a definedFunction?
	 * Applies to AMD modules.
	 */
	this.isDefinitionReturnedFromFunction = function(exportedDef) {

		let functionsReturningDef = this.definedFunctions.filter(definedFunc => {

			return definedFunc.returnedElementDeclaration !== null &&
					definedFunc.returnedElementDeclaration === exportedDef;
		});

		return (functionsReturningDef.length === 0 ? false : true);
	};

	/**
	 * Determines whether the module is imported in sourceFile
	 * only for its side-effects. Applies to CJS modules.
	 */
	this.isModuleImportedForSideEffects = function(importedElement) {

		if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === false) {

			return false;
		}

		let importedElementNodes = importedElement.importedElementNodes;
		for(let importNodeIndex = 0; importNodeIndex < importedElementNodes.length; importNodeIndex++) {

			let importedElementNode = importedElementNodes[importNodeIndex];
			let importedElementNodeLoc = importedElementNode.value.loc;
			let requireCalls = this.astRootCollection.find(jscodeshift.CallExpression).filter(callExp => {

				let callExpLoc = callExp.value.loc;
				return callExpLoc.start.line === importedElementNodeLoc.start.line && callExpLoc.start.column === importedElementNodeLoc.start.column &&
					   callExpLoc.end.line === importedElementNodeLoc.end.line && callExpLoc.end.column === importedElementNodeLoc.end.column;
			});

			if(requireCalls.length === 0) {

				//no import nodes found
				//proceed to the next import
				continue;
			}

			let requireCall = requireCalls.at(0).get();
			if(requireCall.parentPath.value.type === 'ExpressionStatement') {

				//parent node of require() invokation is an expression statement
				//(the result of require() is not assigned anywhere or not used - 
				//module is imported for its side-effects, no exported definition is imported)
				return true;
			}
		}

		return false;
	};

	/**
	 * Counts the definitions (variables/functions/object literals) the
	 * module depends on after refactoring.
	*/
	this.countRefactoredImportedDefinitions = function() {

		/**
		 * Imported definitions after refactoring are assessed after the traversal of the MDG
		 *  1. variable/function that is not an object: 1/used definition

			2. object (variable/function): 
				a. Non-cohesive: 1/used property
				b. Cohesive: 1/used definition (+ 1/used property, in the case that there are properties bound to the object instead of the object instances)
		 */

		let numOfImportedDefsAfterRefactoring = 0;

		// console.log(this.fileName);

		//only analyse import dependencies with respect to locally-defined modules
		//(not external modules, e.g. npm packages)
		//also do not consider module imports 
		//(the module is imported for its side-effects, no definition is imported)
		let moduleImportDependencies = this.moduleDependencyList.filter(moduleDependency => {

			// if(moduleDependency.type === 'import' && moduleDependency.dependency.edgeType !== 'ModuleImport') {

			// 	console.log(moduleDependency.dependency.accessedElement);
			// }
			
			return moduleDependency.type === 'import' && moduleDependency.dependency.edgeType !== 'ModuleImport' &&
				   moduleDependency.dependency.accessedElement.declaredSource !== undefined &&
				   moduleDependency.dependency.accessedElement.declaredSource.startsWith('.') === true;
		});

		// console.log(this.fileName);
		// console.log(moduleImportDependencies);
		moduleImportDependencies.forEach(importDep => {

			// console.log(importDep);

			let accessedElement = importDep.dependency.accessedElement;
			let elementUsages = accessedElement.elementUsages;
			// console.log(accessedElement);

			//imported element with no usages
			//consider it in the case that it is assigned/bound to the module's export object
			if(elementUsages.length === 0 && accessedElement.boundToExportedDefinition === false) {

				//imported element with no usages
				//consider it in the case that its import
				//is nested in another statement
				//also, consider it in the case that it is assigned/bound to the module's export object
				let importedElementNodes = accessedElement.importedElementNodes;

				importedElementNodes = importedElementNodes.filter(elNode => {

					return elNode.parentPath.value.type !== 'AssignmentExpression' &&
						   elNode.parentPath.value.type !== 'VariableDeclarator';
				});

				if(importedElementNodes.length === 0) {

					return;
				}

			}

			if(accessedElement instanceof ImportedNamespace.ImportedNamespace === true) {

				// console.log(accessedElement);
				let accessedProps = accessedElement.accessedProperties;

				//remove duplicates (each accessed property contains the property's usage
				//within the module that imports it)
				let accessedProperties = accessedProps.filter((element, position) => {

					let firstOccurenceIndex = accessedProps.findIndex(el => {

						return el.propertyName === element.propertyName;
					});
					return firstOccurenceIndex === position;
				});

				//imported definition is a namespace
				//it is mapped to multiple module definitions (applies to CommonJS/AMD)
				//that are imported along with the definition
				//we count only accessed variables/functions/properties

				// form: {

				// 	exportedVariables : [variable],
				//  exportedFunctions : [functionDeclaration],
				//  exportedProperties : [exportedProperty | objectLiteral]
				// }
				let moduleDefinitions = accessedElement.moduleDefinitions;
				let exportedVariables = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedVariables : [];
				let exportedFunctions = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedFunctions : [];
				
				let exportedProperties = Object.keys(moduleDefinitions).length > 0 ? moduleDefinitions.exportedProperties : [];

				//imported namespace mapped to exported variables/functions
				//imported namespace contains multiple variables/functions
				//assigned to the export object (e.g. export upon condition)
				let variablesAssignedToExportObject = exportedVariables.filter(exportedVariable => {

					return exportedVariable.exportedThroughModuleExports === true;
				});
	
				let functionsAssignedToExportObject = exportedFunctions.filter(exportedFunction => {
	
					return exportedFunction.exportedThroughModuleExports === true;
				});
	
				//in the case that multiple variables are assigned to the export object,
				//multiple variables exported upon condition (process the first variable only)
				//in other cases, process all exported variables
				for(let varIndex = 0; varIndex < exportedVariables.length; varIndex++) {

					if(variablesAssignedToExportObject.length > 1 && varIndex === 1) {

						//multiple variables assigned to the export object
						//variables exported upon condition
						break;
					}

					let exportedVariable = exportedVariables[varIndex];
					let variableName = exportedVariable.variableName;
					let elementProperties = exportedVariable.objectProperties;

					//retrieve the exportedVariable's properties that are accessed (exported)
					let referencedProperties = accessedProperties.filter(accessedProperty => {

						let elementProps = elementProperties.filter(elementProp => {
	
							return elementProp.propertyName === accessedProperty.propertyName;
						});
	
						if(elementProps.length > 0) {
	
							return true;
						}
	
						return false;
					});

					if(exportedVariable.isObjectReferenced === true ||
					   exportedVariable.hasBoundPropertiesInitializedWithImportDefs === true) {

						//object is iterated or has bound properties initialized with the result of require() 
						//(insert object, along with its bound properties
						//regardless of its referenced properties)
						numOfImportedDefsAfterRefactoring += 1 + elementProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedVariable.isInitializedWithFunctionConstructor === true) {

						//object is a constructor function (insert object if it is used outside member expressions or it's bound to the export object, 
						//along with its bound properties that are accessed)
						let variableRefs = elementUsages.filter(elementRef => {

							return elementRef.parentPath.value.type !== 'MemberExpression';
						});

						// console.log(accessedElement.boundToExportedDefinition);
						numOfImportedDefsAfterRefactoring += (variableRefs.length > 0 || accessedElement.boundToExportedDefinition === true) ? 1 : 0;

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//procced to the next definition
						continue;
					}

					if(exportedVariable.objectProperties.length > 0) {

						//non-cohesive object that is not iterated
						//import the accessed properties of object
						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					//otherwise, consider exportedVariable in statistics
					//in the case there exists a reference to it (either direct
					//through referencing it, or indirect, through the imported namespace)
					let variableRefs = elementUsages.filter(elementRef => {

						if(variableName === accessedElement.elementName) {

							//exportedVariable has the same name with imported namespace
							//search by its name
							return elementRef.value.name === variableName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName);
						}
						else {

							//exportedVariable has not the same name with imported namespace
							//search by its alias
							return elementRef.parentPath.value.type !== 'MemberExpression' || 
							elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName;
						}

					});

					numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;
					// numOfImportedDefsAfterRefactoring += (elementUsages.length > 0) ? 1 : 0;

					//proceed to the next definition
					continue;
				}

				// console.log(functionsAssignedToExportObject.length);

				//in the case that multiple functions are assigned to the export object,
				//multiple functions exported upon condition (process the first function only)
				//in other cases, process all exported functions
				for(let funcIndex = 0; funcIndex < exportedFunctions.length; funcIndex++) {

					if(functionsAssignedToExportObject.length > 1 && funcIndex === 1) {

						break;
					}

					let exportedFunction = exportedFunctions[funcIndex];
					let functionName = exportedFunction.functionName;
					let elementProperties = exportedFunction.functionProperties;

					let referencedProperties = accessedProperties.filter(accessedProperty => {

						let elementProps = elementProperties.filter(elementProp => {
	
							return elementProp.propertyName === accessedProperty.propertyName;
						});
	
						if(elementProps.length > 0) {
	
							return true;
						}
	
						return false;
					});

					if(exportedFunction.isObjectReferenced === true) {

						//function is iterated (import function along with its bound properties)
						numOfImportedDefsAfterRefactoring += 1 + elementProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedFunction.isConstructor === true) {

						//constructor function (import function in the case it is used, along with its accessed bound properties)

						//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
						let functionRefs = elementUsages.filter(elementRef => {

							return elementRef.parentPath.value.type !== 'MemberExpression';
						});

						numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					if(exportedFunction.functionProperties.length > 0) {

						numOfImportedDefsAfterRefactoring += referencedProperties.length;

						//proceed to the next definition
						continue;
					}

					//otherwise, consider exportedFunction in statistics
					//in the case there exists a reference to it (either direct
					//through referencing it, or indirect, through the imported namespace)
					let functionRefs = elementUsages.filter(elementRef => {

						if(functionName === accessedElement.elementName) {

							//exportedFunction has the same name with imported namespace
							//search by its name
							return elementRef.value.name === functionName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName);
						}
						else {

							//exportedFunction has not the same name with imported namespace
							//search by its alias
							return elementRef.parentPath.value.type !== 'MemberExpression' || 
							elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName;
						}

					});

					// console.log(functionName);
					// console.log(functionRefs);

					numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

					//proceed to the next definition
					continue;
				}

				//consider the properties that are initialized with objects with properties
				//or initialized with non-objects
				let exportedObjProperties = exportedProperties.filter(exportedProperty => {

					if(exportedProperty instanceof ExportedProperty.ExportedProperty === true) {

						return exportedProperty.exportedPropertyASTNode.type !== 'ObjectExpression' ||
						   		exportedProperty.objectProperties.length > 0;
					}
					
					if(exportedProperty instanceof ObjectLiteral.ObjectLiteral === true) {

						return exportedProperty.objectExpressionASTNode.type !== 'ObjectExpression' ||
								exportedProperty.objectProperties.length > 0;
					}

					return false;
				});

				// console.log(exportedProperties);

				//CommonJS exportedProperties: variables/functions/object literals bound to the export object,
				//object literals assigned to the export object (none of these objects are destructured)

				//AMD exportedProperties: object literals returned from the callback function
				//(these objects will be destructured)
				if(this.moduleFramework.includes(enums.ModuleFramework.CommonJS) === true) {
					
					if(exportedObjProperties.length > 0) {

						numOfImportedDefsAfterRefactoring += exportedObjProperties.length;
					}
				}
				else {

					exportedObjProperties.forEach(exportedObjProp => {

						if(exportedObjProp.objectProperties.length === 0) {

							numOfImportedDefsAfterRefactoring += 1;
							return;
						}

						let referencedProps = exportedObjProp.objectProperties.filter(objectProp => {

							return objectProp.isExported === true;
						});

						numOfImportedDefsAfterRefactoring += referencedProps.length;
					});
				}
				if(exportedObjProperties.length === 0) {

					//module export values through binding to the export object
					// numOfImportedDefsAfterRefactoring += accessedProperties.length;
					
					// return;
				}

				// console.log(exportedFunctions.length);
				// console.log(exportedVariables.length);
				// console.log(exportedProperties.length);

				

				//proceed to the next namespace
				return;
			}
			
			//imported definition not a namespace (variable/function)
			//(applies to each module system)
			//it is mapped to 1 definition
			let moduleDefinition = accessedElement.moduleDefinition;

			let accessedProps = accessedElement.accessedProperties;

			// console.log(accessedElement);

			//remove duplicates (each accessed property contains the property's usage
			//within the module that imports it)
			let accessedProperties = accessedProps === undefined ? [] : accessedProps.filter((element, position) => {

				let firstOccurenceIndex = accessedProps.findIndex(el => {

					return el.propertyName === element.propertyName;
				});

				return firstOccurenceIndex === position;
			});

			if(moduleDefinition instanceof Variable.Variable === true) {

				let variableName = moduleDefinition.variableName;

				//retrieve the exportedVariable's properties that are accessed through accessedElement
				let referencedProperties = accessedProperties.filter(accessedProperty => {

					let elementProps = elementProperties.filter(elementProp => {

						return elementProp.propertyName === accessedProperty.propertyName;
					});

					if(elementProps.length > 0) {

						return true;
					}

					return false;
				});

				if(moduleDefinition.isObjectReferenced === true) {

					//object is iterated (import definition, along with its bound properties)
					numOfImportedDefsAfterRefactoring += 1 + moduleDefinition.objectProperties.length;
					return;
				}

				if(moduleDefinition.isInitializedWithFunctionConstructor === true) {

					//constructor function (import definition in the case it is used, along with its accessed bound properties)
					//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
					let variableRefs = elementUsages.filter(elementRef => {

						return elementRef.parentPath.value.type !== 'MemberExpression';
					});

					numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;

					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				if(moduleDefinition.objectProperties.length > 0) {

					//non-cohesive object (import the definition's accessed properties)
					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				//otherwise, consider exportedVariable in statistics
				//in the case there exists a reference to it (either direct
				//through referencing it, or indirect, through the imported namespace)
				let variableRefs = elementUsages.filter(elementRef => {

					return elementRef.value.name === variableName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === variableName);
					});

				numOfImportedDefsAfterRefactoring += (variableRefs.length > 0) ? 1 : 0;
				return;
			}

			if(moduleDefinition instanceof FunctionDeclaration.FunctionDeclaration === true) {

				// console.log(exportedFunction);
				let functionName = moduleDefinition.functionName;
				let elementProperties = moduleDefinition.functionProperties;

				let referencedProperties = accessedProperties.filter(accessedProperty => {

					let elementProps = elementProperties.filter(elementProp => {

						return elementProp.propertyName === accessedProperty.propertyName;
					});

					if(elementProps.length > 0) {

						return true;
					}

					return false;
				});

				if(moduleDefinition.isObjectReferenced === true) {

					//object is iterated (import object along with its bound properties)
					numOfImportedDefsAfterRefactoring += 1 + moduleDefinition.functionProperties.length;
					return;
				}

				if(moduleDefinition.isConstructor === true) {

					//constructor function (import function in the case it is used, along with its accessed bound properties)

					//object is a constructor function (insert object if it is used outside member expressions, along with its bound properties that are accessed)
					let functionRefs = elementUsages.filter(elementRef => {

						return elementRef.parentPath.value.type !== 'MemberExpression';
					});

					numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;

					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				if(moduleDefinition.functionProperties.length > 0) {

					//non-cohesive function (import the object's accessed bound properties)
					numOfImportedDefsAfterRefactoring += referencedProperties.length;
					return;
				}

				//otherwise, consider exportedFunction in statistics
				//in the case there exists a reference to it (either direct
				//through referencing it, or indirect, through the imported namespace)
				let functionRefs = elementUsages.filter(elementRef => {

					return elementRef.value.name === functionName || 
							(elementRef.parentPath.value.type === 'MemberExpression' && 
							elementRef.parentPath.value.property.type === 'Identifier' &&
							elementRef.parentPath.value.property.name === functionName);
					});

				numOfImportedDefsAfterRefactoring += (functionRefs.length > 0) ? 1 : 0;
				return;
			}
		});
		 
		// console.log(numOfImportedDefsAfterRefactoring);
		return numOfImportedDefsAfterRefactoring;
	};


	/**
	 * Writes the imported definitions (variables/functions/namespaces) of sourceFile
	 * to a JSON file. Used for debugging purposes.
	 * @param inputFiles the input file hashmap
	 */
	this.dumpImportedDefinitionsOfSourceFileToFile = function(inputFiles) {

		let importedVariables = this.importedVariables;
		let importedFunctions = this.importedFunctions;
		let importedNamespaces = this.importedNamespaces;

		//modules imported for their side-effects (they do not import anything)
		let importedModules = this.importedModules;

		let jsonObj = {};
		jsonObj.file = this.fileName;
		jsonObj.importedVariables = [];
		jsonObj.importedFunctions = [];
		jsonObj.importedNamespaces = [];
		jsonObj.importedModules = [];

		let relativeFilePath = `./resultFiles/${this.fileName.replace(/\\/g, '_')}`;
		let jsonFileName = `${relativeFilePath.replace(/:/g, '')}_importDefinitions.json`;

		//ImportedElement
		importedVariables.forEach(importedVariable => {

			let specifiedModulePath = path.resolve(path.dirname(this.fileName) + 
													path.sep + 
													importedVariable.declaredSource);

			let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
			if(importFile == null) {

				return;
			}

			jsonObj.importedVariables.push(importedVariable.getImportedElementObject(this, importFile));
		});

		//ImportedElement
		importedFunctions.forEach(importedFunction => {

			let specifiedModulePath = path.resolve(path.dirname(this.fileName) + 
													path.sep + 
													importedFunction.declaredSource);

			let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
			if(importFile == null) {

				return;
			}

			jsonObj.importedFunctions.push(importedFunction.getImportedElementObject(this, importFile));
		});

		//ImportedNamespace
		importedNamespaces.forEach(importedNamespace => {

			let specifiedModulePath = path.resolve(path.dirname(this.fileName) + 
													path.sep + 
													importedNamespace.declaredSource);
			
			let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
			if(importFile == null) {

				return;
			}

			jsonObj.importedNamespaces.push(importedNamespace.getImportedNamespaceObject(this, importFile));
		});

		//ImportedModule
		importedModules.forEach(importedModule => {

			jsonObj.importedModules.push(importedModule.getImportedModuleObject());
		});

		//write (minimized) JSON object synchronously
		fs.writeFileSync(jsonFileName, JSON.stringify(jsonObj, null, 4), 'utf-8');

		// //write large JSON object to file asyncrhonously
		// fileUtilities.writeJSONObjectToFile(jsonFileName, jsonObj);
		console.log('Generated ' + jsonFileName);
	};

	// /**
	//  * Writes the imported definitions (variables/functions/namespaces) of sourceFile
	//  * to a JSON file. Used for debugging purposes.
	//  * @param inputFiles the input file hashmap
	//  */
	// this.dumpImportedDefinitionsOfSourceFileToFile = function(inputFiles) {

	// 	let importedVariables = this.importedVariables;
	// 	let importedFunctions = this.importedFunctions;
	// 	let importedNamespaces = this.importedNamespaces;

	// 	//modules imported for their side-effects (they do not import anything)
	// 	let importedModules = this.importedModules;

	// 	let jsonObj = {};
	// 	jsonObj.file = this.fileName;
	// 	jsonObj.importedVariables = [];
	// 	jsonObj.importedFunctions = [];
	// 	jsonObj.importedNamespaces = [];
	// 	jsonObj.importedModules = [];

	// 	let relativeFilePath = './resultFiles/' + this.fileName.replace(/\\/g, '_');
	// 	let jsonFileName = relativeFilePath.replace(/:/g, '') + 'importDefinitions.json';

	// 	importedVariables.forEach(importedVariable => {

	// 		let specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedVariable.declaredSource);
	// 		let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
	// 		if(importFile == null) {

	// 			return;
	// 		}

	// 		jsonObj.importedVariables.push(importedVariable.getImportedElementObject(this, importFile));
	// 	});

	// 	importedFunctions.forEach(importedFunction => {

	// 		let specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedFunction.declaredSource);
	// 		let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
	// 		if(importFile == null) {

	// 			return;
	// 		}

	// 		jsonObj.importedFunctions.push(importedFunction.getImportedElementObject(this, importFile));
	// 	});

	// 	importedNamespaces.forEach(importedNamespace => {

	// 		let specifiedModulePath = path.resolve(path.dirname(inputFile.fileName) + path.sep + importedNamespace.declaredSource);
	// 		let importFile = fileUtilities.retrieveModuleInList(inputFiles, specifiedModulePath);
	// 		if(importFile == null) {

	// 			return;
	// 		}

	// 		jsonObj.importedNamespaces.push(importedNamespace.getImportedNamespaceObject(this, importFile));
	// 	});

	// 	importedModules.forEach(importedModule => {

	// 		jsonObj.importedModules.push(importedModule.getImportedModuleObject());
	// 	});

	// 	// fs.writeFileSync(jsonFileName, JSON.stringify(jsonObj, null, 4), 'utf-8');

	// 	//write large JSON object to file asyncrhonously
	// 	fileUtilities.writeJSONObjectToFile(jsonFileName, jsonObj);
	// 	console.log('Generated ' + jsonFileName);
	// };

	this.dumpExportedDefinitionsOfSourceFile = function() {

		console.log(this.fileName);
		if(this.moduleFramework.includes(enums.ModuleFramework.AMD) === true) {

			console.log(this.explicitGlobals.
				filter(explicitGlobal => explicitGlobal.isExported === true).
				map(exportedVar => exportedVar.variableName));

			console.log(this.definedFunctions.
					filter(definedFunction => definedFunction.isExported === true).
					map(exportedFunc => exportedFunc.functionName));

			console.log(this.definedFunctions.filter(definedFunction => {

				return definedFunction.returnedElementDeclaration !== null &&
						definedFunction.returnedElementDeclaration.isExported === true
			}).map(definedFunction => {

				let returnedElementDeclaration = definedFunction.returnedElementDeclaration;
				if(returnedElementDeclaration === null) {

					return;
				}

				//returnedElementDeclaration:
				//(a) Variable Declaration
				//(b) Function Declaration/Expression
				//(c) ObjectExpression (attached to return statement)
				if(returnedElementDeclaration instanceof Variable.Variable === true) {

					return returnedElementDeclaration.variableDeclarationNode.value.loc;
				}

				if(returnedElementDeclaration instanceof FunctionDeclaration.FunctionDeclaration === true) {

					return returnedElementDeclaration.functionNode.value.loc;
				}

				return returnedElementDeclaration.objectExpressionASTNode.loc;
			}));
		}
	}
}

exports.SourceFile = SourceFile;