/**
 * 
 */

const fs = require('fs');
const path = require('path');

const jscodeshift = require('../../../node_modules/jscodeshift');
const mkdirp = require('../../../node_modules/mkdirp');

const util = require('../ast/util/util.js');

//codemods relevant to implied globals (independent to module system)
const export_implied_global = require('../../refactoring/modules/generic/export_implied_global.js');
const introduce_implied_global = require('../../refactoring/modules/generic/introduce_implied_global_definition.js');

//codemods relevant to global object properties (independent to module system)
const introduce_global_property_definition = require('../../refactoring/modules/generic/introduce_global_object_property_definition.js');
const introduce_global_property_getter_call = require('../../refactoring/modules/generic/introduce_global_property_getter_call.js');
const introduce_global_property_setter_function = require('../../refactoring/modules/generic/introduce_global_property_setter_function.js');
const introduce_global_property_setter_call = require('../../refactoring/modules/generic/introduce_global_property_setter_call.js');

//codemods specific to CommonJS modules
const insert_import = require('../../refactoring/modules/commonJS/insert_import.js');
const export_function = require('../../refactoring/modules/commonJS/export_function.js');
const export_variable = require('../../refactoring/modules/commonJS/export_variable.js');
const export_object_with_properties = require('../../refactoring/modules/commonJS/export_object_with_properties.js');

const encapsulate_exported_definition = require('../../refactoring/modules/commonJS/encapsulate_exported_definition.js');
const remove_redundant_import = require('../../refactoring/modules/commonJS/remove_redundant_import.js');

//codemods specific to CommonJS modules included in library systems
//deprecated
const lib_insert_import = require('../../refactoring/modules/commonJS/library/insert_import.js');
const lib_export_function = require('../../refactoring/modules/commonJS/library/export_function.js');
const lib_export_variable = require('../../refactoring/modules/commonJS/library/export_variable.js');
const lib_export_object_with_properties = require('../../refactoring/modules/commonJS/library/export_object_with_properties.js');

function transformCommonJSModule(fileInfo, transformationList) {

	let initialDefaultImports = 0;
	let initialNamedImports = 0;
	let initialImports = 0;

	let es6DefaultImports = 0;
	let es6NamedImports = 0;

	let destructuredObjects = 0;
	let exportedProperties = 0;

	let isUtilityModule;

	//#declarations exported after refactoring
	let exportedDeclarations = 0;
	
	//#ES6 import statements
	let refactoredImportStatements = 0;

	let filePath = fileInfo.fileName;
	let isEntryFile = fileInfo.isEntryFile;
	let isIncludedInLibrary = fileInfo.isIncludedInLibrary;

	let astRootCollection = util.createASTOfModule(filePath);

	let numOfNestedStatements = 0;

	//do not transform configuration files
	let resultObject;
		
	//determine the order of the codemods that are applied
	//apply codemods that introduce imports first
	//(a) when exporting an object which is assigned with the result of require()
	//exporting removes the export statement (and thus the object's initialization value) 
	//(b) when exporting an object assigned with the result of require(),
	//exporting generates an object name that is not consistent with the object's name in the import
	let importTransformations = transformationList.filter(transformation => {

		return transformation.type === 'insert_import';
	});

	let exportTransformations = transformationList.filter(transformation => {

		return transformation.type.startsWith('export') === true;
	});

	let encapsulationRedundancyTransformations = transformationList.filter(transformation => {

		return importTransformations.indexOf(transformation) === -1 &&
			   exportTransformations.indexOf(transformation) === -1;
	});

	let transformationArray = importTransformations;
	transformationArray = transformationArray.concat(exportTransformations);
	transformationArray = transformationArray.concat(encapsulationRedundancyTransformations);
	
	//apply each transformation to AST of sourceFile
	transformationArray.forEach(transformation => {
		
		console.log('transforming ' + filePath + '...');
		
		//retrieve script of corresponding transformation
		let transformationType = transformation['type'];

		console.log(transformationType);
		
		//retrieve data needed to apply the transformation
		let transformationInfo = transformation['transformationInfo'];

		transformationInfo.filePath = filePath;
		transformationInfo.isEntryFile = isEntryFile;
		
		if(transformationType === 'insert_import') {

			// if(isIncludedInLibrary === true) {

			// 	lib_insert_import.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// 	return;
			// }
			
			// remove_commonJS_import.refactoring(jscodeshift, astRootCollection, transformationInfo);
			let result = insert_import.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// console.log(result.isInitialImportADefault === true);
			if(Object.keys(result).length === 0) {

				//empty result object - proceed to the next transformation in module
				return;
			}
			
			if(result.isInitialImportADefault === true) {

				initialDefaultImports++;
			}
			else {

				initialNamedImports++;
			}
			initialImports++;

			if(result.isNamedImportIntroduced === true) {

				es6NamedImports++;
			}
			else {

				es6DefaultImports++;
			}
			refactoredImportStatements++;

			if(result.isImportStatementNested === true) {

				numOfNestedStatements++;
			}
		}
		else if(transformationType === 'export_function') {
			
			// if(isIncludedInLibrary === true) {

			// 	lib_export_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// 	return;
			// }

			resultObject = export_function.refactoring(jscodeshift, astRootCollection, transformationInfo);

			if(resultObject !== undefined && resultObject.isFunctionConstructor === false && resultObject.arePropertiesBoundOnFunction === true) {

				//function is not used as a constructor or properties are not bound to it (it is destructured)
				//this module is a utility module (it exposes multiple declarations through named exports)
				destructuredObjects++;
				exportedProperties += resultObject.exportedProperties;
			}
			
			if(resultObject !== undefined && resultObject.isFunctionConstructor === true) {

				//exported function is a function constructor (used to create instances)
				//this is a class module (function constructors emulate classes)
				isUtilityModule = false;
			}
			else {

				isUtilityModule = true;
			}

			exportedDeclarations++;
		}
		else if(transformationType === 'export_variable') {
			
			// if(isIncludedInLibrary === true) {

			// 	lib_export_variable.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// 	return;
			// }

			resultObject = export_variable.refactoring(jscodeshift, astRootCollection, transformationInfo);
			if(resultObject.isVariableInitializedWithAnObject === true) {

				//variable is initialized with an object (it is destructured)
				//this is a utility module (exposes multiple declarations with named exports)
				destructuredObjects++;
				exportedProperties += resultObject.exportedProperties;
				isUtilityModule = true;
			}
			else {

				isUtilityModule = false;
			}

			exportedDeclarations++;
		}
		else if(transformationType === 'export_object_with_properties') {

			// if(isIncludedInLibrary === true) {

			// 	lib_export_object_with_properties.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// 	return;
			// }

			exportedProperties += export_object_with_properties.refactoring(jscodeshift, astRootCollection, transformationInfo);
			destructuredObjects++;
			isUtilityModule = true;

			exportedDeclarations++;
		}
		else if(transformationType === 'export_implied_global') {

			//transform implied global into an explicit global and mark it as exported
			//(an implied global is visible in all js scripts, due to its assignment in the global namespace)
			export_implied_global.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_implied_global_definition') {

			//transform implied global into a defined variable
			introduce_implied_global.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_definition') {

			introduce_global_property_definition.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_getter_call') {

			//GOPU dependency establishment
			introduce_global_property_getter_call.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_setter_call') {

			//GOPM dependency establishment in a module that modifies a global oblect property
			introduce_global_property_setter_call.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_setter_function') {

			//GOPM dependency establishment in a module that defines a global object property
			//that is modified in other modules
			introduce_global_property_setter_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'encapsulate_exported_definition') {

			encapsulate_exported_definition.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'remove_redundant_import') {

			remove_redundant_import.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
	});

	// console.log(filePath + " " + initialDefaultImports + " " + initialNamedImports);
	return {

		"filePath" : filePath,
		"astRootCollection": astRootCollection,
		"initialNamedImports": initialNamedImports,
		"initialDefaultImports": initialDefaultImports,
		"initialImports": initialImports,
		"es6NamedImports" : es6NamedImports,
		"es6DefaultImports": es6DefaultImports,
		"refactoredImportStatements": refactoredImportStatements,
		"destructuredObjects": destructuredObjects,
		"exportedProperties": exportedProperties,
		"isUtilityModule": isUtilityModule,
		"exportedDeclarations": exportedDeclarations,
		"numOfNestedStatements": numOfNestedStatements
	};
	
}

exports.transformCommonJSModule = transformCommonJSModule;